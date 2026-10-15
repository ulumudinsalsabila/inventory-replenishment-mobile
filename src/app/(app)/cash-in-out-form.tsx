import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Camera, Check, ChevronDown, ChevronRight, ImagePlus, Paperclip, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';

type Branch = { id: string; name: string; code: string };
type Page<T> = { data: T[] };
type CashType = 'CASH_IN' | 'CASH_OUT';
type Evidence = ImagePicker.ImagePickerAsset;

const categories = ['Modal', 'Operasional', 'Pendapatan lain', 'Pengembalian dana', 'Koreksi kas', 'Lainnya'];
const reasons: Record<CashType, string[]> = {
  CASH_IN: ['Setoran modal', 'Pengembalian dana', 'Pendapatan lain', 'Koreksi kas', 'Lainnya'],
  CASH_OUT: ['Operasional toko', 'Pembelian kebutuhan toko', 'Transportasi', 'Pengembalian dana', 'Lainnya'],
};
const money = (value: string | number) => `Rp ${Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

export default function CashInOutFormScreen() {
  const { user, authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const assignedBranchId = user?.branchId ?? null;
  const canCreate = user?.permissions.includes('cash_transaction.create') ?? false;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(assignedBranchId ?? '');
  const [type, setType] = useState<CashType>('CASH_IN');
  const [category, setCategory] = useState('');
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [amount, setAmount] = useState('');
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [otherReason, setOtherReason] = useState('');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [step, setStep] = useState(0);
  const [loadingBranches, setLoadingBranches] = useState(!assignedBranchId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (assignedBranchId) return;
    let active = true;
    void authorizedRequest<Page<Branch>>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc')
      .then((result) => {
        if (!active) return;
        setBranches(result.data);
        setBranchId((current) => current || result.data[0]?.id || '');
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Daftar cabang belum dapat dimuat.'); })
      .finally(() => { if (active) setLoadingBranches(false); });
    return () => { active = false; };
  }, [assignedBranchId, authorizedRequest]);

  async function selectEvidence(useCamera: boolean) {
    if (evidence.length >= 5) { setError('Maksimal 5 foto bukti.'); return; }
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(useCamera ? 'Izin kamera diperlukan untuk mengambil foto.' : 'Izin galeri diperlukan untuk memilih foto.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5 - evidence.length, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    if (result.assets.length + evidence.length > 5 || result.assets.some((asset) => Number(asset.fileSize ?? 0) > 5 * 1024 * 1024)) { setError('Maksimal 5 foto dan ukuran tiap file 5 MB.'); return; }
    setEvidence((current) => [...current, ...result.assets].slice(0, 5));
    setError('');
  }

  async function submitTransaction() {
    const resolvedReasons = selectedReasons.map((item) => item === 'Lainnya' ? otherReason.trim() : item);
    if (!branchId || !category || !(Number(amount) > 0) || !selectedReasons.length || (selectedReasons.includes('Lainnya') && !otherReason.trim())) {
      setError('Lengkapi cabang, kategori, jumlah, dan alasan transaksi.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('branchId', branchId);
      form.append('type', type);
      form.append('category', category);
      form.append('amount', amount.replace(',', '.'));
      form.append('reason', `${resolvedReasons.join(', ')}${note.trim() ? `\nCatatan: ${note.trim()}` : ''}`);
      evidence.forEach((asset, index) => {
        const fileName = asset.fileName ?? asset.uri.split('/').pop() ?? `cash-${index + 1}.jpg`;
        if (Platform.OS === 'web') {
          if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
          form.append('attachments', asset.file, fileName);
        } else form.append('attachments', new File(asset.uri), fileName);
      });
      await authorizedRequest('cash-transactions', { method: 'POST', body: form });
      router.back();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Transaksi kas gagal disimpan.'); }
    finally { setSaving(false); }
  }

  const readyForAttachments = Boolean(branchId && category && Number(amount) > 0 && selectedReasons.length && (!selectedReasons.includes('Lainnya') || otherReason.trim()));

  if (!canCreate) return <View style={[styles.screen, styles.noAccess]}><Text style={styles.title}>Akses tidak tersedia</Text><Text style={styles.muted}>Akun ini belum memiliki izin mencatat kas.</Text></View>;

  return <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Kembali ke daftar kas" onPress={() => router.back()} style={styles.headerBack}><ArrowLeft size={21} color="#26372e" /></Pressable><Text style={styles.title}>Catat kas masuk / keluar</Text></View>
    <View style={styles.steps}>{['Detail', 'Lampiran', 'Konfirmasi'].map((label, index) => <Pressable key={label} accessibilityRole="button" disabled={index >= step} onPress={() => setStep(index)} style={styles.step}><View style={[styles.stepNumber, index <= step && styles.stepNumberActive]}>{index < step ? <Check size={12} color="#fff" /> : <Text style={[styles.stepNumberText, index === step && styles.stepNumberTextActive]}>{index + 1}</Text>}</View><Text style={[styles.stepLabel, index === step && styles.stepLabelActive]}>{label}</Text></Pressable>)}</View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {step === 0 ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.label}>Jenis transaksi <Text style={styles.required}>*</Text></Text>
        <View style={styles.typeChoices}>
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: type === 'CASH_IN' }} onPress={() => { setType('CASH_IN'); setSelectedReasons([]); }} style={[styles.typeChoice, type === 'CASH_IN' && styles.inChoice]}><ArrowDownToLine size={16} color={type === 'CASH_IN' ? '#fff' : '#087f5b'} /><Text style={[styles.typeText, type === 'CASH_IN' && styles.typeTextActive]}>Kas masuk</Text></Pressable>
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: type === 'CASH_OUT' }} onPress={() => { setType('CASH_OUT'); setSelectedReasons([]); }} style={[styles.typeChoice, type === 'CASH_OUT' && styles.outChoice]}><ArrowUpFromLine size={16} color={type === 'CASH_OUT' ? '#fff' : '#c23a36'} /><Text style={[styles.typeText, type === 'CASH_OUT' && styles.typeTextActive]}>Kas keluar</Text></Pressable>
        </View>
        {branches.length ? <><Text style={styles.label}>Cabang <Text style={styles.required}>*</Text></Text><View style={styles.branchList}>{branches.map((branch) => <Pressable key={branch.id} onPress={() => setBranchId(branch.id)} style={[styles.branchOption, branch.id === branchId && styles.branchOptionActive]}><Text numberOfLines={1} style={[styles.branchText, branch.id === branchId && styles.branchTextActive]}>{branch.name} ({branch.code})</Text></Pressable>)}</View></> : null}
        {loadingBranches ? <ActivityIndicator style={styles.branchLoader} color="#07885b" /> : null}
        <Text style={styles.label}>Kategori <Text style={styles.required}>*</Text></Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Pilih kategori kas" onPress={() => setCategoryPickerVisible(true)} style={styles.selectField}><Text style={[styles.selectText, !category && styles.placeholder]}>{category || 'Pilih kategori'}</Text><ChevronDown size={17} color="#7b8b9b" /></Pressable>
        <Text style={styles.label}>Jumlah <Text style={styles.required}>*</Text></Text>
        <View style={styles.amountField}><Text style={styles.currency}>Rp</Text><TextInput accessibilityLabel="Jumlah kas" value={amount} onChangeText={(value) => setAmount(value.replace(/[^\d.,]/g, '').replace(',', '.'))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#90a0ad" style={styles.amountInput} /></View>
        <Text style={styles.label}>Alasan <Text style={styles.required}>*</Text></Text>
        <View style={styles.reasonGrid}>{reasons[type].map((item) => {
          const checked = selectedReasons.includes(item);
          return <Pressable key={item} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setSelectedReasons((current) => checked ? current.filter((reasonValue) => reasonValue !== item) : [...current, item])} style={[styles.reasonOption, checked && styles.reasonOptionActive]}><View style={[styles.checkbox, checked && styles.checkboxActive]}>{checked ? <Check size={12} color="#fff" /> : null}</View><Text style={styles.reasonText}>{item}</Text></Pressable>;
        })}</View>
        {selectedReasons.includes('Lainnya') ? <TextInput accessibilityLabel="Alasan lainnya" value={otherReason} onChangeText={setOtherReason} placeholder="Tulis alasan lainnya" placeholderTextColor="#90a0ad" maxLength={200} style={styles.input} /> : null}
        <Text style={styles.label}>Catatan (opsional)</Text><TextInput accessibilityLabel="Catatan transaksi kas" value={note} onChangeText={setNote} placeholder="Tambahkan catatan..." placeholderTextColor="#90a0ad" maxLength={200} multiline style={[styles.input, styles.noteInput]} />
      </View>
    </ScrollView> : null}
    {step === 1 ? <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}><View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>Foto bukti (opsional)</Text><Text style={styles.muted}>Maksimal 5 foto, 5 MB per file.</Text></View><Paperclip size={18} color="#738497" /></View>
        <View style={styles.evidenceGrid}>{evidence.map((asset, index) => <View key={`${asset.assetId ?? asset.uri}-${index}`} style={styles.evidenceWrap}><Image source={{ uri: asset.uri }} style={styles.evidenceImage} /><Pressable accessibilityRole="button" accessibilityLabel={`Hapus foto ${index + 1}`} onPress={() => setEvidence((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeEvidence}><X size={12} color="#fff" /></Pressable></View>)}</View>
        {evidence.length < 5 ? <View style={styles.evidenceActions}><Pressable accessibilityRole="button" onPress={() => void selectEvidence(true)} style={styles.evidenceButton}><Camera size={17} color="#087f5b" /><Text style={styles.evidenceButtonText}>Ambil foto</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void selectEvidence(false)} style={styles.evidenceButton}><ImagePlus size={17} color="#087f5b" /><Text style={styles.evidenceButtonText}>Pilih galeri</Text></Pressable></View> : null}
      </View>
    </ScrollView> : null}
    {step === 2 ? <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}><Text style={styles.sectionTitle}>Konfirmasi transaksi</Text><View style={styles.detailRow}><Text style={styles.detailLabel}>Jenis</Text><Text style={styles.detailValue}>{type === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'}</Text></View><View style={styles.detailRow}><Text style={styles.detailLabel}>Kategori</Text><Text style={styles.detailValue}>{category || '-'}</Text></View><View style={styles.detailRow}><Text style={styles.detailLabel}>Jumlah</Text><Text style={styles.detailValue}>{money(amount)}</Text></View><View style={styles.detailRow}><Text style={styles.detailLabel}>Alasan</Text><Text style={styles.detailValue}>{[...selectedReasons.filter((item) => item !== 'Lainnya'), ...(selectedReasons.includes('Lainnya') && otherReason.trim() ? [otherReason.trim()] : [])].join(', ') || '-'}</Text></View>{note.trim() ? <View style={styles.detailRow}><Text style={styles.detailLabel}>Catatan</Text><Text style={styles.detailValue}>{note.trim()}</Text></View> : null}<View style={styles.detailRow}><Text style={styles.detailLabel}>Foto bukti</Text><Text style={styles.detailValue}>{evidence.length} foto</Text></View></View>
    </ScrollView> : null}
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 8, 14) }]}>
      <Pressable accessibilityRole="button" disabled={saving} onPress={() => step ? setStep((current) => current - 1) : router.back()} style={styles.secondaryButton}><Text style={styles.secondaryText}>{step ? 'Kembali' : 'Batal'}</Text></Pressable>
      {step < 2 ? <Pressable accessibilityRole="button" disabled={(step === 0 && (!readyForAttachments || loadingBranches)) || saving} onPress={() => { setError(''); setStep((current) => current + 1); }} style={[styles.primaryButton, ((step === 0 && (!readyForAttachments || loadingBranches)) || saving) && styles.disabled]}><Text style={styles.primaryText}>{step === 0 ? 'Lanjut ke lampiran' : 'Lanjut ke konfirmasi'}</Text><ChevronRight size={17} color="#fff" /></Pressable> : <Pressable accessibilityRole="button" disabled={saving} onPress={() => void submitTransaction()} style={[styles.primaryButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Simpan transaksi</Text>}</Pressable>}
    </View>
    <Modal visible={categoryPickerVisible} transparent animationType="slide" onRequestClose={() => setCategoryPickerVisible(false)}><View style={styles.modalBackdrop}><View style={[styles.categorySheet, { paddingBottom: Math.max(insets.bottom + 8, 22) }]}><View style={styles.sheetHeader}><Text style={styles.sectionTitle}>Pilih kategori</Text><Pressable accessibilityRole="button" accessibilityLabel="Tutup kategori" onPress={() => setCategoryPickerVisible(false)} style={styles.closeButton}><X size={18} color="#53677e" /></Pressable></View>{categories.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: category === item }} onPress={() => { setCategory(item); setCategoryPickerVisible(false); }} style={[styles.categoryOption, category === item && styles.categoryOptionActive]}><Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>{category === item ? <Check size={16} color="#087f5b" /> : null}</Pressable>)}</View></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' },
  noAccess: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, backgroundColor: '#fff' },
  headerBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#172338', fontSize: 15, fontWeight: '900' },
  steps: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  stepNumber: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#edf2f5' },
  stepNumberActive: { backgroundColor: '#07956f' },
  stepNumberText: { color: '#60758a', fontSize: 9, fontWeight: '900' },
  stepNumberTextActive: { color: '#fff' },
  stepLabel: { color: '#8191a3', fontSize: 9 },
  stepLabelActive: { color: '#07885b', fontWeight: '900' },
  content: { padding: 14, paddingBottom: 20 },
  card: { padding: 14, borderWidth: 1, borderColor: '#e3eaee', borderRadius: 13, backgroundColor: '#fff' },
  label: { marginTop: 14, marginBottom: 7, color: '#53677e', fontSize: 11, fontWeight: '800' },
  required: { color: '#c23a36' },
  typeChoices: { flexDirection: 'row', gap: 8 },
  typeChoice: { flex: 1, minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: '#edf2f5' },
  inChoice: { backgroundColor: '#07956f' },
  outChoice: { backgroundColor: '#c23a36' },
  typeText: { color: '#53677e', fontSize: 11, fontWeight: '800' },
  typeTextActive: { color: '#fff' },
  branchList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  branchOption: { maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#e1e8ec', borderRadius: 9, backgroundColor: '#fff' },
  branchOptionActive: { borderColor: '#07956f', backgroundColor: '#e7f7ef' },
  branchText: { color: '#60758a', fontSize: 9, fontWeight: '700' },
  branchTextActive: { color: '#087f5b' },
  branchLoader: { marginTop: 10, alignSelf: 'flex-start' },
  selectField: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 11, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 10, backgroundColor: '#fff' },
  selectText: { color: '#25364a', fontSize: 11, fontWeight: '700' },
  placeholder: { color: '#91a0ae', fontWeight: '400' },
  amountField: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 10, backgroundColor: '#fff' },
  currency: { color: '#71839a', fontSize: 11, fontWeight: '700' },
  amountInput: { flex: 1, height: 42, color: '#25364a', fontSize: 13, fontWeight: '800' },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  reasonOption: { width: '48%', minHeight: 39, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9, borderWidth: 1, borderColor: '#e4eaee', borderRadius: 9, backgroundColor: '#fff' },
  reasonOptionActive: { borderColor: '#95d9b8', backgroundColor: '#f1fbf6' },
  checkbox: { width: 17, height: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#bdcbd4', borderRadius: 4 },
  checkboxActive: { borderColor: '#07956f', backgroundColor: '#07956f' },
  reasonText: { flex: 1, color: '#53677e', fontSize: 9, fontWeight: '700' },
  input: { minHeight: 42, paddingHorizontal: 11, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 10, color: '#25364a', fontSize: 10 },
  noteInput: { minHeight: 68, paddingTop: 10, textAlignVertical: 'top' },
  sectionTitle: { color: '#25364a', fontSize: 12, fontWeight: '900' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { marginTop: 4, color: '#8191a3', fontSize: 9, lineHeight: 14 },
  evidenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  evidenceWrap: { position: 'relative' },
  evidenceImage: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#edf2f4' },
  removeEvidence: { position: 'absolute', top: -4, right: -4, width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#b8322d' },
  evidenceActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  evidenceButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: '#dce5eb', borderStyle: 'dashed', borderRadius: 9, backgroundColor: '#fff' },
  evidenceButtonText: { color: '#53677e', fontSize: 10, fontWeight: '800' },
  detailRow: { minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: '#edf1f4' },
  detailLabel: { color: '#71839a', fontSize: 10 },
  detailValue: { maxWidth: '68%', color: '#25364a', fontSize: 10, fontWeight: '800', textAlign: 'right' },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e8edf0', backgroundColor: '#fff' },
  secondaryButton: { minHeight: 44, minWidth: 78, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 10 },
  secondaryText: { color: '#53677e', fontSize: 10, fontWeight: '800' },
  primaryButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#07885b' },
  primaryText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  error: { marginHorizontal: 14, marginTop: 8, padding: 10, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  categorySheet: { paddingHorizontal: 16, paddingTop: 16, borderTopLeftRadius: 17, borderTopRightRadius: 17, backgroundColor: '#fff' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' },
  categoryOption: { minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#edf1f4' },
  categoryOptionActive: { backgroundColor: '#f1fbf6' },
  categoryText: { color: '#53677e', fontSize: 11 },
  categoryTextActive: { color: '#087f5b', fontWeight: '800' },
});