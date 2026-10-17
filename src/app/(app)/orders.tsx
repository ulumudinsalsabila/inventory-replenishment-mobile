import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from 'expo-router';
import { Bluetooth, ChevronLeft, Printer, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/auth-provider';
import { getRange, rangeLabel, rangeOptions, type RangePreset } from '../../lib/date-range';
import { formatDate, formatStatus } from '../../lib/display';
import { formatOrderReceipt, getPairedPrinters, getSavedPrinter, openAndroidBluetoothSettings, printThermalReceipt, savePrinter, type PairedPrinter, type ReceiptOrder } from '../../lib/receipt-printer';
import { ThermalPreview } from '../../components/thermal-preview';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type OrderLine = NonNullable<ReceiptOrder['items']>[number] & { id: string };
type PaymentLine = NonNullable<ReceiptOrder['payments']>[number] & { status: string };
type RefundEvidence = { id: string; url: string; fileName: string; createdAt: string };
type Order = Omit<ReceiptOrder, 'items' | 'payments' | 'createdAt'> & { createdAt: string; items?: OrderLine[]; payments?: PaymentLine[]; refunds?: { refundNumber?: string; status: string; amount: string; reason: string; createdAt: string; items?: { orderItemId: string; quantity: string }[]; evidenceImages?: RefundEvidence[] }[] };
type PageResult = { data: Order[]; meta: { page: number; perPage: number; total: number; totalPages: number } };
const money = (value: string) => `Rp ${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const printStyles = StyleSheet.create({
  printCard: { marginBottom: 12, padding: 12, borderWidth: 1, borderColor: '#dceee5', borderRadius: 13, backgroundColor: '#fff' },
  printerInfo: { flexDirection: 'row', alignItems: 'center', gap: 9 }, printerLabels: { flex: 1, minWidth: 0 }, printTitle: { color: '#26384a', fontSize: 11, fontWeight: '900' }, printerLabel: { marginTop: 3, color: '#7b8b9b', fontSize: 9 },
  printButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, borderRadius: 10, backgroundColor: '#07885b' }, printButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' }, printError: { marginTop: 8, color: '#a3332a', fontSize: 10, lineHeight: 15 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, printerSheet: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 25, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }, modalTitle: { color: '#172338', fontSize: 14, fontWeight: '900' }, closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' },
  printerLoader: { padding: 16 }, printerEmpty: { paddingVertical: 14, color: '#75869a', fontSize: 10, textAlign: 'center' }, printerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#edf1f3' }, settingsButton: { alignItems: 'center', marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: '#edf7f2' }, settingsText: { color: '#087f5b', fontSize: 10, fontWeight: '800' }, changePrinterButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: '#edf7f2' }, changePrinterText: { color: '#087f5b', fontSize: 9, fontWeight: '900' },
});
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

function receiptHtml(order: ReceiptOrder) {
  const itemRows = (order.items ?? []).map((item) => `<div class="item"><div class="row"><span>${escapeHtml(item.productNameSnapshot)}${item.variantNameSnapshot ? ` (${escapeHtml(item.variantNameSnapshot)})` : ''}</span><strong>${money(item.totalPrice)}</strong></div><div class="muted">${Number(item.inputQuantity ?? item.quantity)} ${escapeHtml(item.unit?.code ?? '')} × ${money(item.unitPrice)}</div>${(item.addons ?? []).map((addon) => `<div class="muted">+ ${escapeHtml(addon.addonNameSnapshot)} × ${addon.quantity} · ${money(addon.totalPrice)}</div>`).join('')}</div>`).join('');
  const paymentRows = (order.payments ?? []).map((payment) => `<div class="row"><span>${escapeHtml(formatStatus(payment.method))}</span><span>${money(payment.amount)}</span></div>${payment.receivedAmount ? `<div class="row muted"><span>Diterima</span><span>${money(payment.receivedAmount)}</span></div>` : ''}${Number(payment.changeAmount ?? 0) > 0 ? `<div class="row muted"><span>Kembalian</span><span>${money(payment.changeAmount!)}</span></div>` : ''}`).join('');
  const date = order.completedAt ?? order.createdAt;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page{margin:8mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#18212b;max-width:360px;margin:0 auto}.center{text-align:center}.store{font-size:18px;font-weight:bold}.muted{color:#687483;font-size:10px;margin-top:4px}.rule{border-top:1px dashed #9aa4af;margin:10px 0}.row{display:flex;justify-content:space-between;gap:12px;margin:6px 0}.item{margin:10px 0}.total{font-size:16px;font-weight:bold;color:#087f5b}</style></head><body><div class="center"><div class="store">${escapeHtml(order.branch?.name ?? 'Toko')}</div><div>${escapeHtml(order.orderNumber)}</div><div class="muted">${date ? formatDate(date) : ''}</div>${order.customerName ? `<div class="muted">Pelanggan: ${escapeHtml(order.customerName)}</div>` : ''}</div><div class="rule"></div>${itemRows}<div class="rule"></div><div class="row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div><div class="row"><span>Diskon</span><span>-${money(order.discountAmount)}</span></div>${Number(order.taxAmount ?? 0) ? `<div class="row"><span>Pajak</span><span>${money(order.taxAmount!)}</span></div>` : ''}${Number(order.serviceCharge ?? 0) ? `<div class="row"><span>Layanan</span><span>${money(order.serviceCharge!)}</span></div>` : ''}<div class="rule"></div><div class="row total"><span>TOTAL</span><span>${money(order.grandTotal)}</span></div>${paymentRows}<div class="rule"></div><div class="center">Terima kasih</div></body></html>`;
}

export default function OrdersScreen() {
  const { authorizedRequest, user } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [result, setResult] = useState<PageResult | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [search, setSearch] = useState('');
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [returnToStock, setReturnToStock] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState('');
  const [refundEvidence, setRefundEvidence] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [printer, setPrinter] = useState<PairedPrinter | null>(null);
  const [printerPickerVisible, setPrinterPickerVisible] = useState(false);
  const [printerDevices, setPrinterDevices] = useState<PairedPrinter[]>([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: selected ? 'Detail Pesanan' : 'Pesanan',
      headerLeft: selected ? () => <Pressable accessibilityRole="button" accessibilityLabel="Kembali ke daftar pesanan" hitSlop={8} onPress={() => { setSelected(null); setPrintError(''); }}><ChevronLeft size={22} color="#172338" /></Pressable> : undefined,
    });
  }, [navigation, selected]);

  useEffect(() => { void getSavedPrinter().then(setPrinter).catch(() => setPrinter(null)); }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { from, to } = getRange(rangePreset);
      const params = new URLSearchParams({ page: String(page), perPage: '20', sortBy: 'createdAt', sortOrder: 'desc', from, to });
      if (search.trim()) params.set('search', search.trim());
      setResult(await authorizedRequest<PageResult>(`orders?${params.toString()}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat pesanan.'); }
    finally { setLoading(false); }
  }, [authorizedRequest, page, rangePreset, search]);

  // Fetching is intentionally started when the query parameters change.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadOrders(); }, [loadOrders]);

  async function openOrder(order: Order) {
    setRefundAmount(''); setRefundReason(''); setReturnToStock(false); setReturnQuantities({}); setRefundEvidence([]); setRefundError('');
    setSelected(order); setDetailLoading(true); setPrintError('');
    try { const detail = await authorizedRequest<Order>(`orders/${order.id}`); setSelected(detail); setRefundMethod(detail.payments?.find((payment) => payment.status === 'COMPLETED')?.method ?? 'CASH'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat detail pesanan.'); }
    finally { setDetailLoading(false); }
  }

  async function showPrinterPicker() {
    setPrinterPickerVisible(true); setPrinterLoading(true); setPrintError('');
    try { setPrinterDevices(await getPairedPrinters()); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Perangkat printer tidak dapat dimuat.'); }
    finally { setPrinterLoading(false); }
  }

  async function sendBluetoothReceipt(target: PairedPrinter) {
    if (!selected) return;
    setPrinting(true); setPrintError('');
    try { await printThermalReceipt(selected, target); setPreviewVisible(false); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Nota gagal dicetak.'); }
    finally { setPrinting(false); }
  }

  async function choosePrinter(target: PairedPrinter) {
    setPrinterLoading(true); setPrintError('');
    // After choosing a printer the user reviews the receipt before it is sent.
    try { await savePrinter(target); setPrinter(target); setPrinterPickerVisible(false); setPreviewVisible(true); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Printer gagal disimpan.'); }
    finally { setPrinterLoading(false); }
  }

  async function reprintOrder() {
    if (!selected || detailLoading) return;
    setPrintError('');
    if (Platform.OS === 'android') {
      if (!printer) { await showPrinterPicker(); return; }
      setPreviewVisible(true);
      return;
    }
    setPrinting(true);
    try { await Print.printAsync({ html: receiptHtml(selected) }); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Nota gagal dicetak.'); }
    finally { setPrinting(false); }
  }

  const refundedAmount = (selected?.refunds ?? []).filter((refund) => refund.status === 'COMPLETED').reduce((total, refund) => total + Number(refund.amount), 0);
  const refundableAmount = Math.max(0, Number(selected?.grandTotal ?? 0) - refundedAmount);
  const canRefund = Boolean(user?.permissions.includes('order.refund') && selected && ['COMPLETED', 'PARTIALLY_REFUNDED'].includes(selected.status) && refundableAmount > 0);
  const alreadyReturned = (lineId: string) => (selected?.refunds ?? []).filter((refund) => refund.status === 'COMPLETED').flatMap((refund) => refund.items ?? []).filter((item) => item.orderItemId === lineId).reduce((total, item) => total + Number(item.quantity), 0);
  const paymentMethods = [...new Set((selected?.payments ?? []).filter((payment) => payment.status === 'COMPLETED').map((payment) => payment.method))];
  const canReprint = Boolean(selected && ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(selected.status) && selected.items?.length);

  async function selectRefundEvidence(useCamera: boolean) {
    if (refundEvidence.length >= 8) { setRefundError('Maksimal 8 foto bukti untuk satu refund.'); return; }
    const permission = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setRefundError(useCamera ? 'Izin kamera diperlukan untuk mengambil foto.' : 'Izin galeri diperlukan untuk memilih foto.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 8 - refundEvidence.length, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    if (result.assets.some((asset) => Number(asset.fileSize ?? 0) > 5 * 1024 * 1024)) { setRefundError('Ukuran setiap foto bukti maksimal 5 MB.'); return; }
    setRefundEvidence((current) => [...current, ...result.assets].slice(0, 8));
    setRefundError('');
  }

  async function submitRefund() {
    if (!selected) return;
    setRefundError('');
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > refundableAmount) { setRefundError(`Nominal harus lebih dari 0 dan maksimal ${money(String(refundableAmount))}.`); return; }
    if (!refundReason.trim()) { setRefundError('Alasan pengembalian wajib diisi.'); return; }
    if (!refundEvidence.length) { setRefundError('Minimal satu foto bukti refund wajib dipilih.'); return; }
    const items = Object.entries(returnQuantities).filter(([, quantity]) => Number(quantity) > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (returnToStock && !items.length) { setRefundError('Isi jumlah item yang dikembalikan ke stok.'); return; }
    setRefunding(true);
    try {
      const form = new FormData();
      form.append('method', refundMethod); form.append('amount', amount.toFixed(2)); form.append('reason', refundReason.trim()); form.append('returnToStock', String(returnToStock));
      if (returnToStock) form.append('items', JSON.stringify(items));
      refundEvidence.forEach((asset, index) => {
        const name = asset.fileName ?? asset.uri.split('/').pop() ?? `refund-${index}.jpg`;
        if (Platform.OS === 'web') {
          if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
          form.append('images', asset.file, name);
        } else form.append('images', new File(asset.uri), name);
      });
      await authorizedRequest(`orders/${selected.id}/refund`, { method: 'POST', body: form });
      setRefundAmount(''); setRefundReason(''); setReturnToStock(false); setReturnQuantities({}); setRefundEvidence([]);
      setSelected(await authorizedRequest<Order>(`orders/${selected.id}`));
      await loadOrders();
    } catch (e) { setRefundError(e instanceof Error ? e.message : 'Pengembalian gagal diproses.'); }
    finally { setRefunding(false); }
  }

  if (selected) return <View style={styles.screen}><KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.page}>
    <View style={printStyles.printCard}>
          <View style={printStyles.printerInfo}><Printer size={19} color="#087f5b" /><View style={printStyles.printerLabels}><Text style={printStyles.printTitle}>Nota pembayaran</Text><Text style={printStyles.printerLabel}>{Platform.OS === 'android' ? printer?.name ?? 'Printer Bluetooth belum dipilih' : 'Cetak atau simpan melalui dialog sistem'}</Text></View>{Platform.OS === 'android' ? <Pressable accessibilityRole="button" onPress={() => void showPrinterPicker()} style={printStyles.changePrinterButton}><Text style={printStyles.changePrinterText}>{printer ? 'Ganti' : 'Pilih'}</Text></Pressable> : null}</View>
          <Pressable accessibilityRole="button" disabled={detailLoading || printing || !canReprint} onPress={() => void reprintOrder()} style={[printStyles.printButton, (detailLoading || printing || !canReprint) && styles.disabled]}>{printing ? <ActivityIndicator color="#fff" /> : <><Printer size={16} color="#fff" /><Text style={printStyles.printButtonText}>Cetak ulang nota</Text></>}</Pressable>
      {printError ? <Text style={printStyles.printError}>{printError}</Text> : null}
    </View>
      <View style={styles.card}><View style={styles.row}><Text style={styles.muted}>Status</Text><Text style={styles.status}>{formatStatus(selected.status)}</Text></View><View style={styles.row}><Text style={styles.muted}>Cabang</Text><Text style={styles.value}>{selected.branch?.name ?? '—'}</Text></View><View style={styles.row}><Text style={styles.muted}>Tanggal</Text><Text style={styles.value}>{formatDate(selected.createdAt)}</Text></View><View style={styles.row}><Text style={styles.muted}>Total</Text><Text style={styles.total}>{money(selected.grandTotal)}</Text></View></View>
    <Text style={styles.sectionTitle}>Item pesanan</Text>
    {(selected.items ?? []).map((item) => <View key={item.id} style={styles.line}><View style={styles.flex}><Text style={styles.value}>{item.productNameSnapshot}{item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ''}</Text><Text style={styles.muted}>{item.quantity} item</Text>{item.addons?.map((addon, i) => <Text key={`${item.id}-${i}`} style={styles.muted}>+ {addon.addonNameSnapshot} × {addon.quantity}</Text>)}</View><Text style={styles.value}>{money(item.totalPrice)}</Text></View>)}
    <Text style={styles.sectionTitle}>Pembayaran</Text>
      {(selected.payments ?? []).map((payment, i) => <View key={`${payment.method}-${i}`} style={styles.line}><Text style={styles.value}>{formatStatus(payment.method)} · {formatStatus(payment.status)}</Text><Text style={styles.value}>{money(payment.amount)}</Text></View>)}
    {(selected.refunds?.length ?? 0) > 0 ? <><Text style={styles.sectionTitle}>Pengembalian</Text>{selected.refunds?.map((refund, i) => <View key={`${refund.refundNumber ?? i}`} style={styles.refundHistory}><View style={styles.line}><View style={styles.flex}><Text style={styles.value}>{refund.refundNumber ?? 'Refund'}</Text><Text style={styles.muted}>{refund.reason}</Text></View><Text style={styles.value}>{money(refund.amount)}</Text></View>{(refund.evidenceImages?.length ?? 0) > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.evidenceRow}>{refund.evidenceImages?.map((image) => <Image key={image.id} source={{ uri: image.url }} style={styles.evidenceImage} />)}</ScrollView> : null}</View>)}</> : null}
    {canRefund ? <View style={styles.refundCard}>
      <Text style={styles.sectionTitle}>Proses pengembalian</Text><Text style={styles.muted}>Sisa yang dapat dikembalikan: {money(String(refundableAmount))}</Text>
      <Text style={styles.fieldLabel}>Nominal</Text><TextInput accessibilityLabel="Nominal pengembalian" keyboardType="decimal-pad" style={styles.input} value={refundAmount} onChangeText={setRefundAmount} placeholder={String(refundableAmount)} placeholderTextColor="#87948c" />
      <Text style={styles.fieldLabel}>Metode pengembalian</Text><View style={styles.methodRow}>{paymentMethods.map((method) => <Pressable key={method} onPress={() => setRefundMethod(method)} style={[styles.method, refundMethod === method && styles.methodSelected]}><Text style={[styles.methodText, refundMethod === method && styles.methodTextSelected]}>{formatStatus(method)}</Text></Pressable>)}</View>
      <Text style={styles.fieldLabel}>Alasan</Text><TextInput accessibilityLabel="Alasan pengembalian" style={[styles.input, styles.multiline]} value={refundReason} onChangeText={setRefundReason} placeholder="Tuliskan alasan" placeholderTextColor="#87948c" multiline />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: returnToStock }} onPress={() => setReturnToStock((value) => !value)} style={styles.checkRow}><View style={[styles.checkbox, returnToStock && styles.checkboxChecked]}><Text style={styles.checkMark}>{returnToStock ? '✓' : ''}</Text></View><Text style={styles.value}>Kembalikan item ke stok</Text></Pressable>
      {returnToStock ? (selected.items ?? []).map((item) => { const max = Math.max(0, Number(item.quantity) - alreadyReturned(item.id)); return <View key={item.id} style={styles.returnLine}><Text style={[styles.value, styles.flex]}>{item.productNameSnapshot} (sisa {max})</Text><TextInput accessibilityLabel={`Jumlah retur ${item.productNameSnapshot}`} keyboardType="decimal-pad" style={styles.quantityInput} value={returnQuantities[item.id] ?? ''} onChangeText={(value) => setReturnQuantities((current) => ({ ...current, [item.id]: value }))} placeholder="0" placeholderTextColor="#87948c" /></View>; }) : null}
      <Text style={styles.fieldLabel}>Bukti refund *</Text><Text style={styles.muted}>Minimal 1 dan maksimal 8 foto.</Text><View style={styles.evidenceActions}><Pressable onPress={() => void selectRefundEvidence(true)} style={styles.evidenceButton}><Text style={styles.evidenceButtonText}>Ambil foto</Text></Pressable><Pressable onPress={() => void selectRefundEvidence(false)} style={styles.evidenceButton}><Text style={styles.evidenceButtonText}>Pilih galeri</Text></Pressable></View>
      {refundEvidence.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.evidenceRow}>{refundEvidence.map((asset, index) => <View key={`${asset.assetId ?? asset.uri}-${index}`}><Image source={{ uri: asset.uri }} style={styles.evidenceImage} /><Pressable accessibilityLabel={`Hapus foto ${index + 1}`} onPress={() => setRefundEvidence((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeEvidence}><Text style={styles.removeEvidenceText}>×</Text></Pressable></View>)}</ScrollView> : null}
      {refundError ? <Text style={styles.errorText}>{refundError}</Text> : null}
      <Pressable accessibilityRole="button" disabled={refunding} onPress={() => void submitRefund()} style={[styles.refundButton, refunding && styles.disabled]}>{refunding ? <ActivityIndicator color="#fff" /> : <Text style={styles.refundButtonText}>Simpan pengembalian</Text>}</Pressable>
    </View> : null}
  </KeyboardAwareScrollView>
  <ThermalPreview
    visible={previewVisible}
    title={`Nota ${selected.orderNumber}`}
    text={formatOrderReceipt(selected)}
    printer={printer}
    printing={printing}
    error={printError}
    onPrint={() => { if (printer) void sendBluetoothReceipt(printer); }}
    onChangePrinter={() => { setPreviewVisible(false); void showPrinterPicker(); }}
    onClose={() => { setPreviewVisible(false); setPrintError(''); }}
  />
  <Modal visible={printerPickerVisible} transparent animationType="slide" onRequestClose={() => setPrinterPickerVisible(false)}>
    <View style={printStyles.modalBackdrop}><View style={[printStyles.printerSheet, { paddingBottom: Math.max(insets.bottom + 8, 25) }]}>
      <View style={printStyles.modalHeader}><Text style={printStyles.modalTitle}>Pilih printer Bluetooth</Text><Pressable accessibilityRole="button" accessibilityLabel="Tutup pemilih printer" onPress={() => setPrinterPickerVisible(false)} style={printStyles.closeButton}><X size={19} color="#526276" /></Pressable></View>
      {printerLoading ? <ActivityIndicator style={printStyles.printerLoader} color="#087f5b" /> : null}
      {!printerLoading && !printerDevices.length ? <Text style={printStyles.printerEmpty}>Tidak ada printer yang dipasangkan.</Text> : null}
      {printerDevices.map((device) => <Pressable key={device.address} accessibilityRole="button" onPress={() => void choosePrinter(device)} style={printStyles.printerRow}><Bluetooth size={18} color="#087f5b" /><View style={printStyles.printerLabels}><Text style={printStyles.printTitle}>{device.name}</Text><Text style={printStyles.printerLabel}>{device.address}</Text></View></Pressable>)}
      {printError ? <Text style={printStyles.printError}>{printError}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => { openAndroidBluetoothSettings(); setPrinterPickerVisible(false); }} style={printStyles.settingsButton}><Text style={printStyles.settingsText}>Pengaturan Bluetooth</Text></Pressable>
    </View></View>
  </Modal></View>;

  return <View style={styles.screen}><KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.page}>
    <Text style={styles.subtitle}>Riwayat transaksi dan rincian pembayaran.</Text>
    <View style={styles.rangeControl}>{rangeOptions.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: rangePreset === item.id }} onPress={() => { setRangePreset(item.id); setPage(1); }} style={[styles.rangeButton, rangePreset === item.id && styles.rangeButtonActive]}><Text style={[styles.rangeText, rangePreset === item.id && styles.rangeTextActive]}>{item.label}</Text></Pressable>)}</View>
    <TextInput style={styles.search} value={search} onChangeText={(value) => { setSearch(value); setPage(1); }} placeholder="Cari nomor pesanan" placeholderTextColor="#87948c" autoCapitalize="characters" />
    {loading ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : null}
    {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void loadOrders()}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
      {(result?.data ?? []).map((order) => <Pressable key={order.id} onPress={() => void openOrder(order)} style={({ pressed }) => [styles.orderCard, pressed && styles.pressed]}><View style={styles.row}><Text style={styles.orderNumber}>{order.orderNumber}</Text><Text style={styles.status}>{formatStatus(order.status)}</Text></View><Text style={styles.muted}>{order.branch?.name ?? 'Cabang'} · {formatDate(order.createdAt)}</Text><View style={[styles.row, styles.orderFooter]}><Text style={styles.total}>{money(order.grandTotal)}</Text><Text style={styles.detailLink}>Lihat detail  ›</Text></View></Pressable>)}
    {!loading && !error && !result?.data.length ? <View style={styles.empty}><Text style={styles.value}>Belum ada pesanan</Text><Text style={styles.muted}>Tidak ada transaksi untuk periode {rangeLabel(rangePreset).toLowerCase()}.</Text></View> : null}
    <View style={styles.pagination}><Pressable disabled={page <= 1 || loading} onPress={() => setPage((p) => Math.max(1, p - 1))} style={[styles.pageButton, (page <= 1 || loading) && styles.disabled]}><Text style={styles.pageButtonText}>‹ Sebelumnya</Text></Pressable><Text style={styles.muted}>Halaman {result?.meta.page ?? page} dari {result?.meta.totalPages ?? 1}</Text><Pressable disabled={page >= (result?.meta.totalPages ?? 1) || loading} onPress={() => setPage((p) => p + 1)} style={[styles.pageButton, (page >= (result?.meta.totalPages ?? 1) || loading) && styles.disabled]}><Text style={styles.pageButtonText}>Berikutnya ›</Text></Pressable></View>
  </KeyboardAwareScrollView></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#f5f7f6' }, rangeControl: { flexDirection: 'row', gap: 4, marginBottom: 10, padding: 4, borderRadius: 11, backgroundColor: '#e9eef1' }, rangeButton: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }, rangeButtonActive: { backgroundColor: '#07885f' }, rangeText: { color: '#63758b', fontSize: 9, fontWeight: '800' }, rangeTextActive: { color: '#fff' },page: { padding: 18, paddingBottom: 35 }, eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '900' }, subtitle: { marginTop: 5, marginBottom: 14, color: '#718078', fontSize: 12 }, search: { height: 46, marginBottom: 12, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff', color: '#172820' }, loader: { margin: 18 }, orderCard: { marginBottom: 9, padding: 14, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 15, backgroundColor: '#fff' }, pressed: { borderColor: '#a8d7c2', backgroundColor: '#f7fcf9' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, orderNumber: { color: '#172820', fontSize: 14, fontWeight: '900' }, status: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#e7f5ee', color: '#087f5b', fontSize: 9, fontWeight: '900' }, muted: { marginTop: 5, color: '#84918b', fontSize: 10 }, value: { color: '#34453b', fontSize: 12, fontWeight: '700' }, total: { color: '#087f5b', fontSize: 15, fontWeight: '900' }, orderFooter: { marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#edf1ee' }, detailLink: { color: '#087f5b', fontSize: 11, fontWeight: '800' }, empty: { alignItems: 'center', marginTop: 14, padding: 22, borderRadius: 15, backgroundColor: '#fff' }, pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, pageButton: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: '#e7f5ee' }, pageButtonText: { color: '#087f5b', fontSize: 10, fontWeight: '800' }, disabled: { opacity: 0.4 }, errorBox: { padding: 13, borderRadius: 13, backgroundColor: '#fff1f0' }, errorText: { color: '#a3332a', fontSize: 11 }, retry: { marginTop: 8, color: '#087f5b', fontSize: 11, fontWeight: '900' }, card: { marginTop: 16, padding: 14, borderRadius: 15, backgroundColor: '#fff' }, sectionTitle: { marginTop: 19, marginBottom: 7, color: '#172820', fontSize: 14, fontWeight: '900' }, line: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#e8eeea' }, flex: { flex: 1 }, back: { marginBottom: 18 }, backText: { color: '#087f5b', fontSize: 12, fontWeight: '800' }, refundCard: { marginTop: 20, padding: 14, borderRadius: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6ece8' }, fieldLabel: { marginTop: 13, marginBottom: 6, color: '#34453b', fontSize: 11, fontWeight: '800' }, input: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, color: '#172820', backgroundColor: '#fff' }, multiline: { minHeight: 76, paddingTop: 11, textAlignVertical: 'top' }, methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, method: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f1f5f2' }, methodSelected: { backgroundColor: '#e7f5ee' }, methodText: { color: '#718078', fontSize: 9, fontWeight: '800' }, methodTextSelected: { color: '#087f5b' }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16, minHeight: 44 }, checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#b8c8bf', borderRadius: 6 }, checkboxChecked: { borderColor: '#087f5b', backgroundColor: '#087f5b' }, checkMark: { color: '#fff', fontWeight: '900' }, returnLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }, quantityInput: { width: 74, height: 40, textAlign: 'center', borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, color: '#172820' }, refundHistory: { borderBottomWidth: 1, borderBottomColor: '#e8eeea', paddingBottom: 8 }, evidenceActions: { flexDirection: 'row', gap: 8, marginTop: 8 }, evidenceButton: { flex: 1, alignItems: 'center', padding: 11, borderRadius: 10, backgroundColor: '#e7f5ee' }, evidenceButtonText: { color: '#087f5b', fontSize: 11, fontWeight: '800' }, evidenceRow: { gap: 8, paddingVertical: 9 }, evidenceImage: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#edf1ee' }, removeEvidence: { position: 'absolute', top: 3, right: 3, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#a3332a' }, removeEvidenceText: { color: '#fff', fontSize: 16, fontWeight: '900', lineHeight: 18 }, refundButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 13, borderRadius: 12, backgroundColor: '#087f5b' }, refundButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' } });
