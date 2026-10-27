import { useEffect, useState } from 'react';
import { AdminOnly } from '../../auth/admin-only';
import { ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MoneyInput } from '../../components/money-input';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Camera, Check, ChevronRight, ImagePlus, Paperclip, Plus, Search, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatDate } from '../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { PreviewImage } from '../../components/image-viewer';

type Branch = { id: string; name: string; code: string };
type Page<T> = { data: T[]; meta?: { totalPages: number } };
type CashAttachment = { id: string; url: string; fileName: string; mimeType: string };
type CashRow = { id: string; amount?: string; type?: string; category?: string; reason?: string; createdAt?: string; branch?: Branch; attachments?: CashAttachment[]; _count?: { attachments: number } };
type CashDetail = CashRow & { note?: string | null; attachments?: CashAttachment[] };
type ReasonOption = { label: string; category: string };
const reasonOptions: Record<'CASH_IN' | 'CASH_OUT', ReasonOption[]> = {
  CASH_IN: [{ label: 'Setoran modal', category: 'Modal' }, { label: 'Pendapatan lain', category: 'Pendapatan lain' }, { label: 'Koreksi kas', category: 'Koreksi kas' }, { label: 'Lainnya', category: 'Lainnya' }],
  CASH_OUT: [{ label: 'Pembelian operasional', category: 'Operasional' }, { label: 'Pengembalian dana', category: 'Pengembalian dana' }, { label: 'Koreksi kas', category: 'Koreksi kas' }, { label: 'Lainnya', category: 'Lainnya' }],
};
const money = (value?: string | number | null) => `Rp ${Number(value ?? 0).toLocaleString('id-ID')}`;

export default function CashScreen() {
  const { user, authorizedRequest } = useAuth();
  const canRead = user?.permissions.includes('cash_closing.read') ?? false;
  const canTransact = user?.permissions.includes('cash_transaction.create') ?? false;
  const assignedBranchId = user?.branchId ?? null;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(user?.branchId ?? '');
  const [type, setType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
  const [reasonChoice, setReasonChoice] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CASH_IN' | 'CASH_OUT'>('ALL');
  const [formVisible, setFormVisible] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [evidence, setEvidence] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [selected, setSelected] = useState<CashDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The API filters by search (category/reason); the type filter has no query parameter, so it
  // filters the loaded rows and the list keeps paging while the result is short.
  const params = new URLSearchParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  if (search) params.set('search', search);
  if (typeFilter !== 'ALL') params.set('type', typeFilter);
  const list = useInfiniteList<CashRow>(authorizedRequest, canRead ? `cash-transactions?${params.toString()}` : null);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);

  useEffect(() => {
    if (assignedBranchId) return;
    let active = true;
    void authorizedRequest<Page<Branch>>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc')
      .then((result) => { if (active) setBranches(result.data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Data kas belum dapat dimuat.'); });
    return () => { active = false; };
  }, [assignedBranchId, authorizedRequest]);

  async function selectEvidence(useCamera: boolean) {
    if (evidence.length >= 5) { setError('Maksimal 5 foto bukti.'); return; }
    if (useCamera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setError('Izin kamera diperlukan untuk mengambil foto.'); return; }
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5 - evidence.length, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    if (result.assets.length + evidence.length > 5 || result.assets.some((asset) => Number(asset.fileSize ?? 0) > 5 * 1024 * 1024)) { setError('Maksimal 5 foto dan ukuran tiap file 5 MB.'); return; }
    setEvidence((current) => [...current, ...result.assets].slice(0, 5));
    setError('');
  }

  const submitTransaction = async () => {
    const selectedReason = reasonOptions[type].find((option) => option.label === reasonChoice);
    if (!branchId || !selectedReason || !(Number(amount) > 0)) return setError('Pilih cabang, alasan, dan jumlah positif.');
    setSaving(true); setError('');
    try {
      const reasonText = reason.trim() ? `${selectedReason.label}: ${reason.trim()}` : selectedReason.label;
      const form = new FormData();
      form.append('branchId', branchId); form.append('type', type); form.append('category', selectedReason.category); form.append('amount', amount.replace(',', '.')); form.append('reason', reasonText);
      evidence.forEach((asset, index) => {
        const fileName = asset.fileName ?? asset.uri.split('/').pop() ?? `cash-${index + 1}.jpg`;
        if (Platform.OS === 'web') {
          if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
          form.append('attachments', asset.file, fileName);
        } else form.append('attachments', new File(asset.uri), fileName);
      });
      await authorizedRequest('cash-transactions', { method: 'POST', body: form });
      setReasonChoice(''); setAmount(''); setReason(''); setEvidence([]); setFormStep(0); setFormVisible(false); void list.reload();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Transaksi kas gagal disimpan.'); }
    finally { setSaving(false); }
  };

  async function openDetail(row: CashRow) {
    setSelected(row as CashDetail);
    setDetailLoading(true);
    try { setSelected(await authorizedRequest<CashDetail>(`cash-transactions/${row.id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Detail transaksi belum dapat dimuat.'); }
    finally { setDetailLoading(false); }
  }

  const currentReason = reasonOptions[type].find((option) => option.label === reasonChoice);
  const visibleTransactions = list.items;
  const listError = list.items.length ? '' : list.error;

  return <View style={styles.screen}>
    <KeyboardAwareScrollView {...(formVisible ? {} : scrollProps)} bottomOffset={24} contentContainerStyle={[styles.page, { paddingBottom: 18 }]} keyboardShouldPersistTaps="handled" refreshControl={!formVisible ? <RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor="#087f5b" /> : undefined}>
      {!formVisible ? <>
        <Text style={styles.subtitle}>Pencatatan kas masuk dan keluar.</Text>
        {branches.length ? <View style={styles.card}><Text style={styles.label}>Cabang</Text><View style={styles.chips}>{branches.map((branch) => <Pressable key={branch.id} onPress={() => setBranchId(branch.id)} style={[styles.chip, branchId === branch.id && styles.chipActive]}><Text style={[styles.chipText, branchId === branch.id && styles.chipTextActive]}>{branch.name} ({branch.code})</Text></Pressable>)}</View></View> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}><View style={[styles.input, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 0 }]}><Search size={16} color="#71839a" /><TextInput accessibilityLabel="Cari kas masuk atau keluar" value={searchInput} onChangeText={setSearchInput} placeholder="Cari kategori atau alasan..." placeholderTextColor="#8290a2" style={{ flex: 1, color: '#26372e', fontSize: 12 }} /></View><Pressable accessibilityRole="button" accessibilityLabel="Filter kas masuk" onPress={() => setTypeFilter((current) => current === 'CASH_IN' ? 'ALL' : 'CASH_IN')} style={[styles.chip, typeFilter === 'CASH_IN' && styles.chipActive]}><Text style={[styles.chipText, typeFilter === 'CASH_IN' && styles.chipTextActive]}>Masuk</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Filter kas keluar" onPress={() => setTypeFilter((current) => current === 'CASH_OUT' ? 'ALL' : 'CASH_OUT')} style={[styles.chip, typeFilter === 'CASH_OUT' && styles.chipActive]}><Text style={[styles.chipText, typeFilter === 'CASH_OUT' && styles.chipTextActive]}>Keluar</Text></Pressable></View>
        <View style={styles.chips}><Pressable onPress={() => setTypeFilter('ALL')} style={[styles.chip, typeFilter === 'ALL' && styles.chipActive]}><Text style={[styles.chipText, typeFilter === 'ALL' && styles.chipTextActive]}>Semua</Text></Pressable><Pressable onPress={() => setTypeFilter('CASH_IN')} style={[styles.chip, typeFilter === 'CASH_IN' && styles.chipActive]}><Text style={[styles.chipText, typeFilter === 'CASH_IN' && styles.chipTextActive]}>Kas masuk</Text></Pressable><Pressable onPress={() => setTypeFilter('CASH_OUT')} style={[styles.chip, typeFilter === 'CASH_OUT' && styles.chipActive]}><Text style={[styles.chipText, typeFilter === 'CASH_OUT' && styles.chipTextActive]}>Kas keluar</Text></Pressable></View>
        {error || listError ? <View style={styles.error}><Text style={styles.errorText}>{error || listError}</Text></View> : null}
        {list.loading ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : null}
        {canRead ? visibleTransactions.map((row) => <Pressable key={row.id} accessibilityRole="button" onPress={() => void openDetail(row)} style={styles.transactionCard}><View style={[styles.transactionIcon, { backgroundColor: row.type === 'CASH_IN' ? '#e4f7ee' : '#fff0ed' }]}>{row.type === 'CASH_IN' ? <ArrowDownLeft size={18} color="#07885b" /> : <ArrowUpRight size={18} color="#c23a36" />}</View><View style={styles.rowText}><Text numberOfLines={1} style={styles.rowTitle}>{row.reason}</Text><Text style={styles.detail}>{row.type === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'} · {row.category}</Text><Text style={styles.transactionDate}>{formatDate(row.createdAt ?? '')}{row.branch?.name ? ` · ${row.branch.name}` : ''}</Text></View><Text style={[styles.rowAmount, { color: row.type === 'CASH_IN' ? '#087f5b' : '#c23a36' }]}>{row.type === 'CASH_IN' ? '+' : '-'}{money(row.amount)}</Text><ChevronRight size={16} color="#94a2af" /></Pressable>) : null}
        {canRead ? <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={visibleTransactions.length} error={list.error} onRetry={list.loadMore} /> : null}
        {!list.loading && !listError && canRead && !visibleTransactions.length ? <Text style={styles.empty}>Belum ada transaksi kas.</Text> : null}
        {!canRead && !canTransact ? <View style={styles.card}><Text style={styles.section}>Akses tidak tersedia</Text><Text style={styles.detail}>Akun ini belum memiliki izin untuk kas.</Text></View> : null}
      </> : <>
        <View style={styles.formHeader}><Pressable accessibilityRole="button" accessibilityLabel="Kembali ke daftar kas" onPress={() => { if (formStep) setFormStep((stepValue) => stepValue - 1); else { setFormVisible(false); setError(''); } }}><ArrowLeft size={21} color="#24364a" /></Pressable><Text style={styles.formTitle}>Catat kas masuk / keluar</Text></View>
        <View style={styles.stepRow}>{['Detail', 'Lampiran', 'Konfirmasi'].map((label, index) => <Pressable key={label} onPress={() => index < formStep && setFormStep(index)} style={styles.stepItem}><View style={[styles.stepCircle, index <= formStep && styles.stepCircleActive]}>{index < formStep ? <Check size={12} color="#fff" /> : <Text style={[styles.stepNumber, index === formStep && styles.stepNumberActive]}>{index + 1}</Text>}</View><Text style={[styles.stepLabel, index === formStep && styles.stepLabelActive]}>{label}</Text></Pressable>)}</View>
        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
        {formStep === 0 ? <View style={styles.card}><Text style={styles.section}>Jenis transaksi *</Text><View style={styles.chips}>{(['CASH_IN', 'CASH_OUT'] as const).map((value) => <Pressable key={value} onPress={() => { setType(value); setReasonChoice(''); }} style={[styles.typeChoice, type === value && (value === 'CASH_IN' ? styles.inChoiceActive : styles.outChoiceActive)]}><Text style={[styles.chipText, type === value && styles.whiteText]}>{value === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'}</Text></Pressable>)}</View>
          {branches.length ? <><Text style={styles.label}>Cabang</Text><View style={styles.chips}>{branches.map((branch) => <Pressable key={branch.id} onPress={() => setBranchId(branch.id)} style={[styles.chip, branchId === branch.id && styles.chipActive]}><Text style={[styles.chipText, branchId === branch.id && styles.chipTextActive]}>{branch.name} ({branch.code})</Text></Pressable>)}</View></> : null}
          <Text style={styles.label}>Jumlah *</Text><View style={styles.amountInput}><Text style={styles.currency}>Rp</Text><MoneyInput accessibilityLabel="Jumlah kas" value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor="#8290a2" style={styles.amountTextInput} /></View>
          <Text style={styles.label}>Alasan *</Text><View style={styles.reasonGrid}>{reasonOptions[type].map((option) => <Pressable key={option.label} accessibilityRole="checkbox" accessibilityState={{ checked: reasonChoice === option.label }} onPress={() => setReasonChoice(option.label)} style={[styles.reasonChoice, reasonChoice === option.label && styles.reasonChoiceActive]}><View style={[styles.checkbox, reasonChoice === option.label && styles.checkboxActive]}>{reasonChoice === option.label ? <Check size={12} color="#fff" /> : null}</View><Text style={styles.reasonText}>{option.label}</Text></Pressable>)}</View>
          <Text style={styles.label}>Catatan (opsional)</Text><TextInput accessibilityLabel="Catatan transaksi kas" value={reason} onChangeText={setReason} placeholder="Tambahkan catatan..." placeholderTextColor="#8290a2" maxLength={200} multiline style={[styles.input, styles.multiline]} />
        </View> : null}
        {formStep === 1 ? <View style={styles.card}><View style={styles.attachmentHeading}><View><Text style={styles.section}>Foto bukti (opsional)</Text><Text style={styles.detail}>Maksimal 5 foto, 5 MB per file.</Text></View><Paperclip size={18} color="#667c92" /></View><View style={styles.evidenceGrid}>{evidence.map((asset, index) => <View key={`${asset.assetId ?? asset.uri}-${index}`} style={styles.evidenceWrap}><PreviewImage uri={asset.uri} images={evidence.map((entry) => entry.uri)} index={index} style={styles.evidenceImage} /><Pressable accessibilityRole="button" accessibilityLabel={`Hapus foto ${index + 1}`} onPress={() => setEvidence((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeEvidence}><X size={12} color="#fff" /></Pressable></View>)}</View>{evidence.length < 5 ? <View style={styles.evidenceActions}><Pressable accessibilityRole="button" onPress={() => void selectEvidence(true)} style={styles.evidenceButton}><Camera size={16} color="#087f5b" /><Text style={styles.evidenceButtonText}>Ambil foto</Text></Pressable><AdminOnly><Pressable accessibilityRole="button" onPress={() => void selectEvidence(false)} style={styles.evidenceButton}><ImagePlus size={16} color="#087f5b" /><Text style={styles.evidenceButtonText}>Pilih galeri</Text></Pressable></AdminOnly></View> : null}</View> : null}
        {formStep === 2 ? <View style={styles.card}><Text style={styles.section}>Konfirmasi transaksi</Text><Text style={styles.detail}>Jenis transaksi</Text><Text style={styles.rowTitle}>{type === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'}</Text><View style={styles.detailRow}><Text style={styles.detailLabel}>Jumlah</Text><Text style={styles.detailValue}>{money(amount)}</Text></View><View style={styles.detailRow}><Text style={styles.detailLabel}>Alasan</Text><Text style={styles.detailValue}>{currentReason?.label ?? '—'}</Text></View>{reason.trim() ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Catatan</Text><Text style={styles.detailValue}>{reason}</Text></View> : null}<View style={styles.detailRow}><Text style={styles.detailLabel}>Foto bukti</Text><Text style={styles.detailValue}>{evidence.length} foto</Text></View></View> : null}
      </>}
    </KeyboardAwareScrollView>
    {formVisible ? <View style={styles.formFooter}><Pressable accessibilityRole="button" disabled={saving} onPress={() => { if (formStep) setFormStep((value) => value - 1); else { setFormVisible(false); setError(''); } }} style={styles.secondaryButton}><Text style={styles.secondaryText}>{formStep ? 'Kembali' : 'Batal'}</Text></Pressable><Pressable accessibilityRole="button" disabled={saving || (formStep === 0 && (!branchId || !reasonChoice || !(Number(amount) > 0)))} onPress={() => { if (formStep < 2) { setError(''); setFormStep((value) => value + 1); } else void submitTransaction(); }} style={[styles.primary, styles.formPrimary, saving && styles.dim]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{formStep < 2 ? 'Lanjut' : 'Simpan transaksi'}</Text>}{formStep < 2 ? <ChevronRight size={16} color="#fff" /> : null}</Pressable></View> : <View style={styles.listFooter}>{canRead && user?.permissions.includes('cash_closing.create') ? <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/(tabs)/cash')} style={styles.closingLink}><Text style={styles.closingLinkText}>Cash closing</Text><ChevronRight size={16} color="#07885b" /></Pressable> : null}{canTransact ? <Pressable accessibilityRole="button" onPress={() => { setFormVisible(true); setFormStep(0); setError(''); }} style={styles.primary}><Plus size={17} color="#fff" /><Text style={styles.primaryText}>Catat kas masuk / keluar</Text></Pressable> : null}</View>}
    <Modal visible={detailLoading || Boolean(selected)} transparent animationType="slide" onRequestClose={() => setSelected(null)}><View style={styles.modalBackdrop}><View style={styles.detailSheet}><View style={styles.detailHeader}><View><Text style={styles.section}>Detail transaksi</Text><Text style={styles.detail}>{selected?.createdAt ? formatDate(selected.createdAt) : ''}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup detail" onPress={() => setSelected(null)} style={styles.closeButton}><X size={19} color="#526276" /></Pressable></View>{detailLoading ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : selected ? <ScrollView style={styles.detailContent}><View style={[styles.detailBanner, { backgroundColor: selected.type === 'CASH_IN' ? '#e6f7ef' : '#fff0ed' }]}>{selected.type === 'CASH_IN' ? <ArrowDownLeft size={20} color="#07885b" /> : <ArrowUpRight size={20} color="#c23a36" />}<View style={styles.rowText}><Text style={styles.rowTitle}>{selected.type === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'}</Text><Text style={styles.detail}>{formatDate(selected.createdAt ?? '')}</Text></View><Text style={[styles.rowAmount, { color: selected.type === 'CASH_IN' ? '#07885b' : '#c23a36' }]}>{money(selected.amount)}</Text></View><View style={styles.detailRow}><Text style={styles.detailLabel}>Kategori</Text><Text style={styles.detailValue}>{selected.category ?? '—'}</Text></View><View style={styles.detailRow}><Text style={styles.detailLabel}>Alasan</Text><Text style={styles.detailValue}>{selected.reason ?? '—'}</Text></View><View style={styles.detailRow}><Text style={styles.detailLabel}>Cabang</Text><Text style={styles.detailValue}>{selected.branch?.name ?? '—'}</Text></View>{selected.note ? <><Text style={styles.sectionTitle}>Catatan</Text><Text style={styles.detail}>{selected.note}</Text></> : null}<Text style={styles.sectionTitle}>Foto bukti</Text><View style={styles.evidenceGrid}>{selected.attachments?.map((attachment, index, all) => <PreviewImage key={attachment.id} uri={attachment.url} images={all.map((entry) => entry.url)} index={index} accessibilityLabel={attachment.fileName} style={styles.evidenceImage} />)}</View></ScrollView> : null}</View></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f6' },
  page: { padding: 20, paddingTop: 18, paddingBottom: 36 },
  back: { alignSelf: 'flex-start', marginBottom: 20 },
  backText: { color: '#087f5b', fontSize: 12, fontWeight: '800' },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '800' },
  subtitle: { marginTop: 5, color: '#718078', fontSize: 12 },
  card: { marginTop: 16, padding: 15, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 16, backgroundColor: '#fff' },
  section: { marginBottom: 11, color: '#26372e', fontSize: 15, fontWeight: '900' },
  label: { marginBottom: 8, color: '#718078', fontSize: 11, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11, backgroundColor: '#f1f4f2' },
  chipActive: { backgroundColor: '#e7f5ee' },
  chipText: { color: '#68766e', fontSize: 12, fontWeight: '800' },
  chipTextActive: { color: '#087f5b' },
  input: { minHeight: 45, marginTop: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, backgroundColor: '#fff', color: '#26372e', fontSize: 12 },
  multiline: { minHeight: 72, paddingTop: 12, textAlignVertical: 'top' },
  primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 11, borderRadius: 12, backgroundColor: '#087f5b' },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  dim: { opacity: 0.55 },
  expected: { color: '#087f5b', fontSize: 15, fontWeight: '900' },
  detail: { marginTop: 5, color: '#79867f', fontSize: 12, lineHeight: 17 },
  sectionTitle: { marginTop: 23, marginBottom: 8, color: '#26372e', fontSize: 15, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, padding: 13, borderRadius: 13, backgroundColor: '#fff' },
  rowText: { flex: 1, paddingRight: 8 },
  rowTitle: { color: '#26372e', fontSize: 12, fontWeight: '800' },
  rowAmount: { color: '#26372e', fontSize: 12, fontWeight: '900' },
  empty: { padding: 16, borderRadius: 13, backgroundColor: '#fff', color: '#84918b', fontSize: 12 },
  error: { marginTop: 13, padding: 12, borderRadius: 12, backgroundColor: '#fff1ef' },
  errorText: { color: '#a3332a', fontSize: 12 },
  loader: { padding: 14 },
  formHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  formTitle: { color: '#26372e', fontSize: 15, fontWeight: '900' },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  stepItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  stepCircle: { width: 23, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#edf2f5' },
  stepCircleActive: { backgroundColor: '#087f5b' },
  stepNumber: { color: '#718078', fontSize: 11, fontWeight: '900' },
  stepNumberActive: { color: '#fff' },
  stepLabel: { color: '#8191a3', fontSize: 11 },
  stepLabelActive: { color: '#087f5b', fontWeight: '900' },
  typeChoice: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#f1f4f2' },
  inChoiceActive: { backgroundColor: '#087f5b' },
  outChoiceActive: { backgroundColor: '#c23a36' },
  whiteText: { color: '#fff' },
  amountInput: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, backgroundColor: '#fff' },
  currency: { color: '#718078', fontSize: 12, fontWeight: '700' },
  amountTextInput: { flex: 1, height: 44, color: '#26372e', fontSize: 14, fontWeight: '800' },
  reasonGrid: { gap: 7 },
  reasonChoice: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 10, backgroundColor: '#fff' },
  reasonChoiceActive: { borderColor: '#087f5b', backgroundColor: '#e7f5ee' },
  checkbox: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbd7d0', borderRadius: 5 },
  checkboxActive: { borderColor: '#087f5b', backgroundColor: '#087f5b' },
  reasonText: { color: '#26372e', fontSize: 12, fontWeight: '700' },
  attachmentHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  evidenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  evidenceWrap: { position: 'relative' },
  evidenceImage: { width: 68, height: 68, borderRadius: 8, backgroundColor: '#edf2f4' },
  removeEvidence: { position: 'absolute', top: -4, right: -4, width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#b8322d' },
  evidenceActions: { flexDirection: 'row', gap: 7, marginTop: 8 },
  evidenceButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: '#dce5eb', borderStyle: 'dashed', borderRadius: 9, backgroundColor: '#fff' },
  evidenceButtonText: { color: '#53677e', fontSize: 12, fontWeight: '800' },
  formFooter: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e8edf0', backgroundColor: '#fff' },
  formPrimary: { flex: 1, flexDirection: 'row', gap: 7, marginTop: 0, paddingHorizontal: 10 },
  secondaryButton: { minHeight: 46, minWidth: 82, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 10, backgroundColor: '#fff' },
  secondaryText: { color: '#53677e', fontSize: 12, fontWeight: '800' },
  listFooter: { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#e8edf0', backgroundColor: '#fff' },
  closingLink: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3 },
  closingLinkText: { color: '#087f5b', fontSize: 12, fontWeight: '800' },
  transactionCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8, padding: 11, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' },
  transactionIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  transactionDate: { marginTop: 4, color: '#87938c', fontSize: 11 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  detailSheet: { maxHeight: '86%', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 24, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: '#f7f9fa' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eaf0f3' },
  detailContent: { flexGrow: 0 },
  detailBanner: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8, padding: 10, borderRadius: 10 },
  detailRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderBottomColor: '#e8edf1' },
  detailLabel: { color: '#71839a', fontSize: 12 },
  detailValue: { maxWidth: '68%', color: '#25364a', fontSize: 12, fontWeight: '800', textAlign: 'right' },
});
