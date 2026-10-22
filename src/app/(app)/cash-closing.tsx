import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MoneyInput } from '../../components/money-input';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banknote, Bluetooth, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, ImagePlus, Paperclip, Printer, Search, ShieldCheck, X } from 'lucide-react-native';
import { useAuth } from '../../auth/auth-provider';
import { useBranchFilter } from '../../auth/branch-filter';
import { ApiError } from '../../lib/api';
import { getRange, rangeLabel, rangeOptions, type RangePreset } from '../../lib/date-range';
import { formatDateTime, formatStatus } from '../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { useBottomGap } from '../../lib/responsive';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { ThermalPreview } from '../../components/thermal-preview';
import { formatCashClosingReceipt, getPairedPrinters, getSavedPrinter, openAndroidBluetoothSettings, printThermalCashClosingReceipt, savePrinter, type CashClosingReceipt, type PairedPrinter } from '../../lib/receipt-printer';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { PreviewImage } from '../../components/image-viewer';
import { PrinterPickerSheet } from '../../components/pos-flow';


type Branch = { id: string; name: string; code: string };
type Page<T> = { data: T[]; meta?: { totalPages: number; total: number } };
type CashClosing = CashClosingReceipt & {
  id: string;
  actualCash: string;
  expectedCash: string;
  difference: string;
  totalSales: string;
  totalRefund: string;
  netTotal: string;
  cashIn: string;
  cashOut: string;
  note?: string | null;
  branch?: Branch;
  attachments?: { id: string; url: string; fileName: string; mimeType: string }[];
};
type Preview = {
  expectedCash: string;
  cashSales: string;
  qrisSales: string;
  transferSales: string;
  grabSales: string;
  gobizSales: string;
  cardSales: string;
  otherSales: string;
  totalSales: string;
  cashIn: string;
  cashOut: string;
  cashRefund: string;
  qrisRefund: string;
  transferRefund: string;
  grabRefund: string;
  gobizRefund: string;
  cardRefund: string;
  otherRefund: string;
  totalRefund: string;
  netTotal: string;
  transactionCount: number;
  periodStart: string | null;
  /** Unpaid open bills of this branch; they are not part of the closing and only trigger a warning. */
  openBills?: { count: number; total: string };
};
type Evidence = ImagePicker.ImagePickerAsset;
const money = (value?: string | number | null) => `Rp ${Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const paymentRows: [string, Exclude<keyof Preview, 'openBills'>][] = [['Cash', 'cashSales'], ['QRIS', 'qrisSales'], ['Transfer', 'transferSales'], ['Grab', 'grabSales'], ['GoBiz', 'gobizSales'], ['Kartu', 'cardSales'], ['Lainnya', 'otherSales']];
const refundRows: [string, Exclude<keyof Preview, 'openBills'>][] = [['Cash', 'cashRefund'], ['QRIS', 'qrisRefund'], ['Transfer', 'transferRefund'], ['Grab', 'grabRefund'], ['GoBiz', 'gobizRefund'], ['Kartu', 'cardRefund'], ['Lainnya', 'otherRefund']];

export default function CashClosingScreen() {
  const { user, authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomGap = useBottomGap();
  const canRead = user?.permissions.includes('cash_closing.read') ?? false;
  const canCreate = user?.permissions.includes('cash_closing.create') ?? false;
  const assignedBranchId = user?.branchId ?? null;
  const [branches, setBranches] = useState<Branch[]>([]);
  const { selectedBranchId: listBranchId, setSelectedBranchId: setListBranchId } = useBranchFilter();
  const [branchId, setBranchId] = useState(assignedBranchId ?? listBranchId);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(canCreate && Boolean(assignedBranchId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'MATCH' | 'DIFFERENCE'>('ALL');
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [formVisible, setFormVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [actualCash, setActualCash] = useState('');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [selected, setSelected] = useState<CashClosing | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [printer, setPrinter] = useState<PairedPrinter | null>(null);
  const [printerPickerVisible, setPrinterPickerVisible] = useState(false);
  const [printerDevices, setPrinterDevices] = useState<PairedPrinter[]>([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');

  useEffect(() => { void getSavedPrinter().then(setPrinter).catch(() => setPrinter(null)); }, []);

  const { from, to } = getRange(rangePreset);
  const params = new URLSearchParams({ sortBy: 'closedAt', sortOrder: 'desc', from, to });
  if (search) params.set('search', search);
  if (filter !== 'ALL') params.set('status', filter);
  if (listBranchId && !assignedBranchId) params.set('branchId', listBranchId);
  const list = useInfiniteList<CashClosing>(authorizedRequest, canRead ? `cash-closings?${params.toString()}` : null);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);

  useEffect(() => {
    if (assignedBranchId) return;
    let active = true;
    void authorizedRequest<Page<Branch>>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc')
      .then((result) => { if (!active) return; setBranches(result.data); setBranchId((current) => current || result.data[0]?.id || ''); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Data cash closing belum dapat dimuat.'); });
    return () => { active = false; };
  }, [assignedBranchId, authorizedRequest]);

  useEffect(() => {
    if (!canCreate || !branchId) return;
    let active = true;
    void authorizedRequest<Preview>(`cash-closing/preview?branchId=${encodeURIComponent(branchId)}`)
      .then((result) => { if (active) { setPreview(result); setError(''); } })
      .catch((cause: unknown) => { if (active) { setPreview(null); setError(cause instanceof ApiError ? cause.message : 'Ringkasan kas belum dapat dimuat.'); } })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [authorizedRequest, branchId, canCreate, reload]);

  const filteredRows = list.items;
  const listError = list.items.length ? '' : list.error;
  const difference = Number(actualCash || 0) - Number(preview?.expectedCash ?? 0);

  function resetForm() {
    setFormVisible(false);
    setStep(0);
    setActualCash('');
    setNote('');
    setEvidence([]);
    setError('');
  }

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

  async function submitClosing() {
    if (!branchId || !preview || !preview.transactionCount || actualCash.trim() === '' || Number(actualCash) < 0) {
      setError('Periksa cabang, transaksi yang belum ditutup, dan kas aktual.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('branchId', branchId);
      form.append('actualCash', actualCash.replace(',', '.'));
      if (note.trim()) form.append('note', note.trim());
      evidence.forEach((asset, index) => {
        const fileName = asset.fileName ?? asset.uri.split('/').pop() ?? `cash-closing-${index + 1}.jpg`;
        if (Platform.OS === 'web') {
          if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
          form.append('attachments', asset.file, fileName);
        } else form.append('attachments', new File(asset.uri), fileName);
      });
      await authorizedRequest('cash-closing', { method: 'POST', body: form });
      resetForm();
      setReload((value) => value + 1);
      void list.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cash closing gagal disimpan.'); }
    finally { setSaving(false); }
  }

  async function openDetail(row: CashClosing) {
    setSelected(row);
    setDetailLoading(true);
    setPrintError('');
    try { setSelected(await authorizedRequest<CashClosing>(`cash-closings/${row.id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Detail closing belum dapat dimuat.'); }
    finally { setDetailLoading(false); }
  }

  async function showPrinterPicker() {
    setPrinterPickerVisible(true);
    setPrinterLoading(true);
    setPrintError('');
    try { setPrinterDevices(await getPairedPrinters()); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Perangkat printer tidak dapat dimuat.'); }
    finally { setPrinterLoading(false); }
  }

  async function sendBluetoothReceipt(target: PairedPrinter) {
    if (!selected) return;
    setPrinting(true);
    setPrintError('');
    try { await printThermalCashClosingReceipt(selected, target); setPreviewVisible(false); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Nota cash closing gagal dicetak.'); }
    finally { setPrinting(false); }
  }

  async function choosePrinter(target: PairedPrinter) {
    setPrinterLoading(true);
    setPrintError('');
    try {
      await savePrinter(target);
      setPrinter(target);
      setPrinterPickerVisible(false);
      // After choosing a printer the user reviews the report before it is sent.
      setPreviewVisible(true);
    } catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Printer gagal disimpan.'); }
    finally { setPrinterLoading(false); }
  }

  async function printClosing() {
    if (!selected || detailLoading || printing) return;
    setPrintError('');
    if (Platform.OS === 'android') {
      if (!printer) { await showPrinterPicker(); return; }
      setPreviewVisible(true);
      return;
    }
    setPrinting(true);
    const receipt = formatCashClosingReceipt(selected);
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page{size:58mm auto;margin:3mm}*{box-sizing:border-box}body{width:52mm;margin:0 auto;color:#111;font:9px "Courier New",monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.35}</style></head><body><pre>${escapeHtml(receipt)}</pre></body></html>`;
    try { await Print.printAsync({ html }); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Nota cash closing gagal dicetak.'); }
    finally { setPrinting(false); }
  }

  // Open bills are not settled yet, so they never block the closing; the cashier is only reminded of them.
  const openBillWarning = preview?.openBills?.count ? <View style={styles.openBillWarning}><Text style={styles.openBillWarningText}>Masih ada {preview.openBills.count} open bill belum dibayar ({money(preview.openBills.total)}).</Text></View> : null;

  if (formVisible) return <View style={styles.screen}>
    <View style={styles.formHeader}><Pressable accessibilityRole="button" accessibilityLabel="Kembali ke daftar closing" onPress={step ? () => setStep((value) => value - 1) : resetForm} style={styles.backButton}><ChevronLeft size={21} color="#1e3444" /></Pressable><Text style={styles.formTitle}>Tutup kas baru</Text></View>
    <View style={styles.steps}>{['Input data', 'Rekonsiliasi', 'Konfirmasi'].map((label, index) => <View key={label} style={styles.step}><View style={[styles.stepNumber, index <= step && styles.stepNumberActive]}>{index < step ? <Check size={13} color="#fff" /> : <Text style={[styles.stepNumberText, index === step && styles.stepNumberTextActive]}>{index + 1}</Text>}</View><Text style={[styles.stepLabel, index === step && styles.stepLabelActive]}>{label}</Text></View>)}</View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {step === 0 ? <KeyboardAwareScrollView bottomOffset={24} style={styles.formContent} contentContainerStyle={styles.formBody} keyboardShouldPersistTaps="handled">
      <View style={styles.card}><View style={styles.cardHeading}><Banknote size={18} color="#087f5b" /><Text style={styles.cardTitle}>Informasi closing</Text></View>
        <Text style={styles.label}>Cabang</Text>{branches.length ? <View style={styles.chips}>{branches.map((branch) => <Pressable key={branch.id} onPress={() => { if (branch.id === branchId) return; setPreview(null); setError(''); setPreviewLoading(true); setBranchId(branch.id); }} style={[styles.chip, branchId === branch.id && styles.chipActive]}><Text style={[styles.chipText, branchId === branch.id && styles.chipTextActive]}>{branch.name}</Text></Pressable>)}</View> : <Text style={styles.branchName}>{user?.branchId ? 'Cabang saya' : 'Pilih cabang dari daftar'}</Text>}
        <View style={styles.infoRow}><CalendarDays size={17} color="#6380a4" /><Text style={styles.infoLabel}>Periode mulai</Text><Text style={styles.infoValue}>{preview?.periodStart ? formatDateTime(preview.periodStart) : 'Belum ada data'}</Text></View>
        <View style={styles.summaryHighlight}><Text style={styles.label}>Kas fisik diharapkan</Text><Text style={styles.expected}>{money(preview?.expectedCash)}</Text></View>
        {openBillWarning}
        <Text style={styles.label}>Kas fisik aktual *</Text><View style={styles.amountInput}><Text style={styles.currency}>Rp</Text><MoneyInput accessibilityLabel="Kas fisik aktual" value={actualCash} onChangeText={setActualCash} placeholder="0" placeholderTextColor="#8290a2" style={styles.amountTextInput} /></View>
        <Text style={styles.label}>Catatan (opsional)</Text><TextInput accessibilityLabel="Catatan penutupan" value={note} onChangeText={setNote} placeholder="Tambahkan catatan..." placeholderTextColor="#8290a2" multiline maxLength={200} style={[styles.textInput, styles.noteInput]} />
        {previewLoading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : null}
      </View>
    </KeyboardAwareScrollView> : null}
    {step === 1 ? <ScrollView style={styles.formContent} contentContainerStyle={styles.formBody}>
      {preview ? <>
        <View style={styles.summaryTiles}><View style={styles.tile}><Text style={styles.tileLabel}>Total penjualan</Text><Text style={styles.tileValue}>{money(preview.totalSales)}</Text><Text style={styles.tileMeta}>{preview.transactionCount} transaksi</Text></View><View style={[styles.tile, styles.tileRefund]}><Text style={styles.tileLabel}>Total refund</Text><Text style={styles.tileValue}>{money(preview.totalRefund)}</Text></View></View>
        <View style={styles.summaryTiles}><View style={[styles.tile, styles.tileIn]}><Text style={styles.tileLabel}>Kas masuk</Text><Text style={styles.tileValue}>{money(preview.cashIn)}</Text></View><View style={[styles.tile, styles.tileOut]}><Text style={styles.tileLabel}>Kas keluar</Text><Text style={styles.tileValue}>{money(preview.cashOut)}</Text></View></View>
        <View style={styles.card}><Text style={styles.cardTitle}>Penjualan per metode</Text>{paymentRows.map(([label, field]) => <View key={field} style={styles.methodRow}><Text style={styles.methodName}>{label}</Text><Text style={styles.methodValue}>{money(preview[field])}</Text></View>)}</View>
        <View style={styles.card}><Text style={styles.cardTitle}>Refund per metode</Text>{refundRows.map(([label, field]) => <View key={field} style={styles.methodRow}><Text style={styles.methodName}>Refund {label}</Text><Text style={styles.methodValue}>{money(preview[field])}</Text></View>)}</View>
      </> : <Text style={styles.empty}>Pilih cabang dan tunggu ringkasan dimuat.</Text>}
    </ScrollView> : null}
    {step === 2 ? <ScrollView style={styles.formContent} contentContainerStyle={styles.formBody}>
      <View style={styles.card}><View style={styles.cardHeading}><ShieldCheck size={18} color="#087f5b" /><Text style={styles.cardTitle}>Ringkasan closing</Text></View><DetailRow label="Nomor closing" value="Dibuat setelah disimpan" /><DetailRow label="Cabang" value={branches.find((branch) => branch.id === branchId)?.name ?? 'Cabang saya'} /><DetailRow label="Periode mulai" value={preview?.periodStart ? formatDateTime(preview.periodStart) : '—'} /><DetailRow label="Dibuat pada" value={formatDateTime(new Date())} /><DetailRow label="Kas seharusnya" value={money(preview?.expectedCash)} /><DetailRow label="Kas fisik aktual" value={money(actualCash)} /><View style={[styles.differenceRow, difference === 0 ? styles.differenceMatch : styles.differenceWarn]}><Text style={styles.differenceLabel}>Selisih kas</Text><Text style={styles.differenceValue}>{money(difference)}</Text></View></View>
      {openBillWarning}
      <View style={styles.card}><View style={styles.cardHeading}><Paperclip size={18} color="#6e5db5" /><Text style={styles.cardTitle}>Foto bukti (opsional)</Text></View><Text style={styles.muted}>Maksimal 5 foto, 5 MB per file.</Text><View style={styles.evidenceGrid}>{evidence.map((asset, index) => <View key={`${asset.assetId ?? asset.uri}-${index}`} style={styles.evidenceWrap}><PreviewImage uri={asset.uri} images={evidence.map((entry) => entry.uri)} index={index} style={styles.evidenceImage} /><Pressable accessibilityRole="button" accessibilityLabel={`Hapus foto ${index + 1}`} onPress={() => setEvidence((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeEvidence}><X size={13} color="#fff" /></Pressable></View>)}{evidence.length < 5 ? <View style={styles.evidenceActions}><Pressable accessibilityRole="button" onPress={() => void selectEvidence(true)} style={styles.evidenceButton}><Camera size={17} color="#087f5b" /><Text style={styles.evidenceButtonText}>Kamera</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void selectEvidence(false)} style={styles.evidenceButton}><ImagePlus size={17} color="#087f5b" /><Text style={styles.evidenceButtonText}>Galeri</Text></Pressable></View> : null}</View></View>
    </ScrollView> : null}
    <View style={[styles.footer, { paddingBottom: bottomGap }]}>{step > 0 ? <Pressable accessibilityRole="button" onPress={() => setStep((value) => value - 1)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Kembali</Text></Pressable> : <Pressable accessibilityRole="button" onPress={resetForm} style={styles.secondaryButton}><Text style={styles.secondaryText}>Batal</Text></Pressable>}{step < 2 ? <Pressable accessibilityRole="button" disabled={step === 0 && (!preview?.transactionCount || !actualCash.trim() || previewLoading)} onPress={() => { setError(''); setStep((value) => value + 1); }} style={[styles.primaryButton, step === 0 && (!preview?.transactionCount || !actualCash.trim() || previewLoading) && styles.disabled]}><Text style={styles.primaryText}>{step === 0 ? 'Lanjut ke rekonsiliasi' : 'Lanjut ke konfirmasi'}</Text><ChevronRight size={17} color="#fff" /></Pressable> : <Pressable accessibilityRole="button" disabled={saving} onPress={() => void submitClosing()} style={[styles.primaryButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Simpan closing</Text>}</Pressable>}</View>
  </View>;

  return <View style={styles.screen}><ScrollView {...scrollProps} style={styles.listContent} contentContainerStyle={styles.listBody} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => { setReload((value) => value + 1); void list.refresh(); }} tintColor="#07885b" />}>
    <Text style={styles.heading}>Cash closing</Text>
    <Text style={styles.subtitle}>Daftar closing kas dan hasil rekonsiliasi.</Text>
    <View style={styles.rangeControl}>{rangeOptions.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: rangePreset === item.id }} onPress={() => setRangePreset(item.id)} style={[styles.rangeButton, rangePreset === item.id && styles.rangeButtonActive]}><Text style={[styles.rangeText, rangePreset === item.id && styles.rangeTextActive]}>{item.label}</Text></Pressable>)}</View>
    <View style={styles.searchField}><Search size={17} color="#71839a" /><TextInput accessibilityLabel="Cari cash closing" value={searchInput} onChangeText={setSearchInput} placeholder="Cari nomor closing atau cabang..." placeholderTextColor="#90a0ad" style={styles.searchInput} returnKeyType="search" /></View>
    {branches.length ? <View style={styles.branchPicker}><Text style={styles.label}>Cabang</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{[{ id: '', name: 'Semua cabang', code: '' }, ...branches].map((branch) => <Pressable key={branch.id || 'all'} onPress={() => { if (branch.id === listBranchId) return; setListBranchId(branch.id); if (branch.id && branch.id !== branchId) { setPreview(null); setError(''); setPreviewLoading(true); setBranchId(branch.id); } }} style={[styles.chip, listBranchId === branch.id && styles.chipActive]}><Text style={[styles.chipText, listBranchId === branch.id && styles.chipTextActive]}>{branch.code ? `${branch.name} (${branch.code})` : branch.name}</Text></Pressable>)}</ScrollView></View> : null}
    <View style={styles.filters}>{[{ id: 'ALL', label: 'Semua' }, { id: 'MATCH', label: 'Sesuai' }, { id: 'DIFFERENCE', label: 'Selisih' }].map((item) => <Pressable key={item.id} onPress={() => setFilter(item.id as typeof filter)} style={[styles.filter, filter === item.id && styles.filterActive]}><Text style={[styles.filterText, filter === item.id && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View>
    {error || listError ? <Text style={styles.error}>{error || listError}</Text> : null}
    {list.loading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : null}
    {canRead ? filteredRows.map((row) => <Pressable key={row.id} accessibilityRole="button" onPress={() => void openDetail(row)} style={styles.closingCard}><View style={styles.closingTop}><View style={styles.closingIcon}><CalendarDays size={18} color="#3f79bf" /></View><View style={styles.closingLabels}><Text numberOfLines={1} style={styles.closingNumber}>{row.closingNumber}</Text><Text style={styles.muted}>{formatDateTime(row.closedAt ?? row.periodEnd ?? row.periodStart ?? '')}</Text></View><View style={[styles.statusBadge, row.status === 'MATCH' ? styles.statusMatch : styles.statusDifference]}><Text style={[styles.statusText, row.status === 'MATCH' ? styles.statusMatchText : styles.statusDifferenceText]}>{row.status === 'MATCH' ? 'SESUAI' : formatStatus(row.status)}</Text></View><ChevronRight size={17} color="#8a9aab" /></View><View style={styles.closingAmounts}><View><Text style={styles.amountLabel}>Penjualan</Text><Text style={styles.amountValue}>{money(row.totalSales)}</Text></View><View style={styles.amountEnd}><Text style={styles.amountLabel}>Selisih</Text><Text style={[styles.amountValue, Number(row.difference) === 0 ? styles.positive : styles.negative]}>{money(row.difference)}</Text></View></View></Pressable>) : <View style={styles.card}><Text style={styles.cardTitle}>Akses tidak tersedia</Text><Text style={styles.muted}>Akun ini belum memiliki izin membaca cash closing.</Text></View>}
    {canRead ? <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={filteredRows.length} error={list.error} onRetry={list.loadMore} /> : null}
    {!list.loading && !listError && canRead && !filteredRows.length ? <Text style={styles.empty}>Belum ada closing untuk periode {rangeLabel(rangePreset).toLowerCase()}.</Text> : null}
  </ScrollView>
  {canCreate ? <Pressable accessibilityRole="button" disabled={!preview?.transactionCount} onPress={() => { setFormVisible(true); setError(''); }} style={[styles.createButton, { marginBottom: bottomGap }, !preview?.transactionCount && styles.disabled]}><PlusIcon /><Text style={styles.createButtonText}>Tutup kas baru</Text></Pressable> : null}
  <Modal visible={detailLoading || Boolean(selected)} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
    <View style={styles.modalBackdrop}>
      <View style={[styles.detailSheet, { paddingBottom: Math.max(insets.bottom + 8, 24) }]}>
        <View style={styles.detailHeader}>
          <View><Text style={styles.cardTitle}>Detail cash closing</Text><Text style={styles.muted}>{selected?.closingNumber}</Text></View>
          <View style={styles.detailActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cetak nota cash closing" disabled={detailLoading || printing || !selected} onPress={() => void printClosing()} style={[styles.printAction, (detailLoading || printing || !selected) && styles.disabled]}>
              {printing ? <ActivityIndicator size="small" color="#087f5b" /> : <Printer size={18} color="#087f5b" />}
            </Pressable>
            {Platform.OS === 'android' ? <Pressable accessibilityRole="button" accessibilityLabel="Pilih printer Bluetooth" onPress={() => void showPrinterPicker()} style={styles.printAction}><Bluetooth size={18} color="#087f5b" /></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Tutup detail" onPress={() => setSelected(null)} style={styles.closeButton}><X size={19} color="#526276" /></Pressable>
          </View>
        </View>
        {printError ? <Text style={styles.printError}>{printError}</Text> : null}
        {detailLoading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : selected ? <ScrollView style={styles.detailContent}>
          <View style={styles.detailBanner}><Banknote size={19} color="#07885b" /><View style={styles.closingLabels}><Text style={styles.cardTitle}>Total penjualan</Text><Text style={styles.muted}>{selected.closedAt ? formatDateTime(selected.closedAt) : '—'}</Text></View><Text style={styles.bannerAmount}>{money(selected.totalSales)}</Text></View>
          <Text style={styles.sectionTitle}>Rincian pemasukan per metode</Text>
          <DetailRow label="Cash" value={money(selected.cashSales)} />
          <DetailRow label="QRIS" value={money(selected.qrisSales)} />
          <DetailRow label="Transfer" value={money(selected.transferSales)} />
          <DetailRow label="Grab" value={money(selected.grabSales)} />
          <DetailRow label="GoBiz" value={money(selected.gobizSales)} />
          <DetailRow label="Kartu" value={money(selected.cardSales)} />
          <DetailRow label="Lainnya" value={money(selected.otherSales)} />
          <View style={[styles.differenceRow, styles.differenceMatch]}><Text style={styles.differenceLabel}>Total penjualan</Text><Text style={styles.differenceValue}>{money(selected.totalSales)}</Text></View>
          <DetailRow label="Cabang" value={selected.branch?.name ?? '—'} />
          <DetailRow label="Periode" value={`${selected.periodStart ? formatDateTime(selected.periodStart) : '—'} - ${selected.periodEnd ? formatDateTime(selected.periodEnd) : '—'}`} />
          <DetailRow label="Total refund" value={money(selected.totalRefund)} />
          <Text style={styles.sectionTitle}>Pergerakan kas</Text>
          <DetailRow label="Kas masuk" value={money(selected.cashIn)} />
          <DetailRow label="Kas keluar" value={money(selected.cashOut)} />
          <DetailRow label="Kas seharusnya" value={money(selected.expectedCash)} />
          <DetailRow label="Kas fisik aktual" value={money(selected.actualCash)} />
          <View style={[styles.differenceRow, Number(selected.difference) === 0 ? styles.differenceMatch : styles.differenceWarn]}><Text style={styles.differenceLabel}>Selisih kas</Text><Text style={styles.differenceValue}>{money(selected.difference)}</Text></View>
          {selected.note ? <><Text style={styles.sectionTitle}>Catatan</Text><Text style={styles.muted}>{selected.note}</Text></> : null}
          <Text style={styles.sectionTitle}>Lampiran ({selected.attachments?.length ?? 0})</Text>
          <View style={styles.evidenceGrid}>{selected.attachments?.map((attachment, index, all) => <PreviewImage key={attachment.id} uri={attachment.url} images={all.map((entry) => entry.url)} index={index} accessibilityLabel={attachment.fileName} style={styles.evidenceImage} />)}</View>
        </ScrollView> : null}
      </View>
    </View>
  </Modal>
  {selected ? <ThermalPreview
    visible={previewVisible}
    title={`Cash closing ${selected.closingNumber}`}
    text={formatCashClosingReceipt(selected)}
    printer={printer}
    printing={printing}
    error={printError}
    onPrint={() => { if (printer) void sendBluetoothReceipt(printer); }}
    onChangePrinter={() => { setPreviewVisible(false); void showPrinterPicker(); }}
    onClose={() => { setPreviewVisible(false); setPrintError(''); }}
  /> : null}
  {printerPickerVisible ? <PrinterPickerSheet devices={printerDevices} loading={printerLoading} error={printError} bottomInset={insets.bottom} onChoose={(target) => void choosePrinter(target)} onClose={() => setPrinterPickerVisible(false)} onOpenBluetoothSettings={openAndroidBluetoothSettings} /> : null}
  </View>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

function PlusIcon() { return <Banknote size={17} color="#fff" />; }

const styles = StyleSheet.create({
  openBillWarning: { marginTop: 9, padding: 11, borderWidth: 1, borderColor: '#f6d79b', borderRadius: 9, backgroundColor: '#fff8e8' }, openBillWarningText: { color: '#8a5a08', fontSize: 12, lineHeight: 17 },
  screen: { flex: 1, backgroundColor: '#f5f8f7' },
  detailActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  printAction: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e6f7ef' },
  printError: { marginBottom: 8, padding: 10, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 12, lineHeight: 17 },
  printerSheet: { paddingHorizontal: 15, paddingTop: 15, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: '#fff' },
  printerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  printerTitle: { color: '#25364a', fontSize: 15, fontWeight: '900' },
  printerRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#edf1f4' },
  printerName: { color: '#25364a', fontSize: 12, fontWeight: '800' },
  printerEmpty: { paddingVertical: 14, color: '#8191a3', fontSize: 12, textAlign: 'center' },
  printerSettings: { alignItems: 'center', marginTop: 10, padding: 10, borderRadius: 9, backgroundColor: '#edf7f2' },
  printerSettingsText: { color: '#087f5b', fontSize: 12, fontWeight: '800' },
  listContent: { flex: 1 }, listBody: { padding: 16, paddingTop: 14, paddingBottom: 12 },
  heading: { color: '#172338', fontSize: 25, fontWeight: '900' },
  rangeControl: { flexDirection: 'row', gap: 4, marginTop: 14, padding: 4, borderRadius: 11, backgroundColor: '#e9eef1' },
  rangeButton: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }, rangeButtonActive: { backgroundColor: '#07885f' },
  rangeText: { color: '#63758b', fontSize: 9, fontWeight: '800' }, rangeTextActive: { color: '#fff' },
  searchField: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 11, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 10, backgroundColor: '#fff' },
  searchInput: { flex: 1, minWidth: 0, color: '#25364a', fontSize: 10 },
  formHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, backgroundColor: '#fff' },
  backButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }, formTitle: { color: '#172338', fontSize: 15, fontWeight: '900' },
  steps: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#fff' },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, stepNumber: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#edf2f5' }, stepNumberActive: { backgroundColor: '#07956f' }, stepNumberText: { color: '#60758a', fontSize: 11, fontWeight: '900' }, stepNumberTextActive: { color: '#fff' }, stepLabel: { color: '#8191a3', fontSize: 11 }, stepLabelActive: { color: '#07885b', fontWeight: '900' },
  formContent: { flex: 1 }, formBody: { padding: 14, paddingBottom: 20, gap: 10 },
  subtitle: { marginTop: 4, color: '#71839a', fontSize: 10 }, label: { marginTop: 10, marginBottom: 6, color: '#53677e', fontSize: 11, fontWeight: '800' },
  branchPicker: { marginBottom: 10 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#edf2f5' }, chipActive: { backgroundColor: '#07885b' }, chipText: { color: '#60758a', fontSize: 11, fontWeight: '800' }, chipTextActive: { color: '#fff' },
  filters: { flexDirection: 'row', gap: 7, marginTop: 11, marginBottom: 5 }, filter: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#edf2f5' }, filterActive: { backgroundColor: '#07885b' }, filterText: { color: '#60758a', fontSize: 9, fontWeight: '800' }, filterTextActive: { color: '#fff' },
  closingCard: { marginBottom: 9, padding: 13, borderWidth: 1, borderColor: '#e4eaee', borderRadius: 12, backgroundColor: '#fff' }, closingTop: { flexDirection: 'row', alignItems: 'center', gap: 8 }, closingIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#e8f2ff' }, closingLabels: { flex: 1, minWidth: 0 }, closingNumber: { color: '#25364a', fontSize: 12, fontWeight: '900' }, statusBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7 }, statusMatch: { backgroundColor: '#e4f7ee' }, statusDifference: { backgroundColor: '#fff2de' }, statusText: { fontSize: 10, fontWeight: '900' }, statusMatchText: { color: '#087c53' }, statusDifferenceText: { color: '#a65d05' }, closingAmounts: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#edf1f4' }, amountLabel: { color: '#8191a3', fontSize: 11 }, amountValue: { marginTop: 3, color: '#25364a', fontSize: 12, fontWeight: '900' }, amountEnd: { alignItems: 'flex-end' }, positive: { color: '#07885b' }, negative: { color: '#c23a36' },
  card: { padding: 13, borderWidth: 1, borderColor: '#e3eaee', borderRadius: 12, backgroundColor: '#fff' }, cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }, cardTitle: { color: '#25364a', fontSize: 14, fontWeight: '900' }, branchName: { color: '#25364a', fontSize: 12, fontWeight: '800' }, infoRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#edf1f4' }, infoLabel: { flex: 1, color: '#71839a', fontSize: 11 }, infoValue: { color: '#25364a', fontSize: 11, fontWeight: '800' }, summaryHighlight: { marginTop: 9, padding: 11, borderRadius: 9, backgroundColor: '#e6f7ef' }, expected: { color: '#07885b', fontSize: 17, fontWeight: '900' }, amountInput: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 9, backgroundColor: '#fff' }, currency: { color: '#74869a', fontSize: 12 }, amountTextInput: { flex: 1, height: 44, color: '#25364a', fontSize: 14, fontWeight: '800' }, textInput: { minHeight: 46, paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 9, color: '#25364a', fontSize: 12 }, noteInput: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
  summaryTiles: { flexDirection: 'row', gap: 8 }, tile: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#eaf3ff' }, tileRefund: { backgroundColor: '#fff0f0' }, tileIn: { backgroundColor: '#e7f7ef' }, tileOut: { backgroundColor: '#fff0ec' }, tileLabel: { color: '#71839a', fontSize: 11 }, tileValue: { marginTop: 4, color: '#25364a', fontSize: 14, fontWeight: '900' }, tileMeta: { marginTop: 2, color: '#8191a3', fontSize: 11 }, methodRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#eef2f5' }, methodName: { color: '#62768c', fontSize: 11 }, methodValue: { color: '#25364a', fontSize: 11, fontWeight: '800' },
  differenceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9, padding: 11, borderRadius: 9 }, differenceMatch: { backgroundColor: '#e6f7ef' }, differenceWarn: { backgroundColor: '#fff0ed' }, differenceLabel: { color: '#475f57', fontSize: 11, fontWeight: '800' }, differenceValue: { color: '#07885b', fontSize: 12, fontWeight: '900' },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e8edf0', backgroundColor: '#fff' }, secondaryButton: { minHeight: 46, minWidth: 82, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 10 }, secondaryText: { color: '#53677e', fontSize: 12, fontWeight: '800' }, primaryButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#07885b' }, primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' }, createButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginHorizontal: 14, marginTop: 7, marginBottom: 10, borderRadius: 10, backgroundColor: '#07885b' }, createButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' }, disabled: { opacity: 0.45 }, loader: { padding: 16 }, error: { marginBottom: 10, padding: 10, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 12, lineHeight: 17 }, muted: { marginTop: 4, color: '#8191a3', fontSize: 11, lineHeight: 16 }, empty: { marginTop: 20, color: '#7b8b9b', fontSize: 12, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, detailSheet: { maxHeight: '86%', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 24, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: '#f7f9fa' }, detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#eaf0f3' }, detailContent: { flexGrow: 0 }, detailBanner: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8, padding: 11, borderRadius: 10, backgroundColor: '#e6f7ef' }, bannerAmount: { color: '#07885b', fontSize: 14, fontWeight: '900' }, detailRow: { minHeight: 41, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderBottomColor: '#e8edf1' }, detailLabel: { color: '#71839a', fontSize: 11 }, detailValue: { maxWidth: '68%', color: '#25364a', fontSize: 11, fontWeight: '800', textAlign: 'right' }, sectionTitle: { marginTop: 14, marginBottom: 6, color: '#25364a', fontSize: 13, fontWeight: '900' },
  evidenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }, evidenceWrap: { position: 'relative' }, evidenceImage: { width: 68, height: 68, borderRadius: 8, backgroundColor: '#edf2f4' }, removeEvidence: { position: 'absolute', top: -4, right: -4, width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#b8322d' }, evidenceActions: { flexDirection: 'row', gap: 7, marginTop: 4 }, evidenceButton: { minHeight: 72, minWidth: 84, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: '#dce5eb', borderStyle: 'dashed', borderRadius: 9, backgroundColor: '#fff' }, evidenceButtonText: { color: '#53677e', fontSize: 11, fontWeight: '800' },
});
