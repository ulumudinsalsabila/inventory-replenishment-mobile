import { useEffect, useMemo, useState } from 'react';
import { AdminOnly } from '../auth/admin-only';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MoneyInput } from './money-input';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Minus, Plus, Trash2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useAuth } from '../auth/auth-provider';
import { defaultRefundMethod, formatStatus, refundMethodsFor, refundPaymentMethods } from '../lib/display';
import type { PosProduct } from './pos-flow';
import { PreviewImage } from './image-viewer';

export type ExchangeOrder = {
  id: string;
  orderNumber: string;
  warehouseId?: string;
  subtotal: string;
  grandTotal: string;
  items?: { id: string; productNameSnapshot: string; variantNameSnapshot?: string | null; quantity: string; totalPrice: string }[];
  payments?: { method: string; status: string }[];
  refunds?: { status: string; amount: string; items?: { orderItemId: string; quantity: string }[] }[];
};
export type ExchangeResult = { exchange: { exchangeNumber: string; differenceAmount: string }; newOrder: { id: string; orderNumber: string } };
type NewLine = { key: string; product: PosProduct; unitId: string; variantId: string; addonIds: string[]; quantity: number };

const money = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const cents = (value: number) => Math.round(value * 100) / 100;

export function ExchangeSheet({ visible, order, onClose, onDone }: { visible: boolean; order: ExchangeOrder; onClose: () => void; onDone: (result: ExchangeResult) => void }) {
  const { authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<PosProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(Boolean(order.warehouseId));
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<NewLine[]>([]);
  const [payMethod, setPayMethod] = useState('CASH');
  const [received, setReceived] = useState('');
  const [discount, setDiscount] = useState('');
  // Defaults to how the customer originally paid; any method can be chosen.
  const [refundMethod, setRefundMethod] = useState(defaultRefundMethod(order.payments));
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // The parent mounts the sheet only while it is open, so every opening starts from a clean form.
  useEffect(() => {
    if (!order.warehouseId) return;
    void authorizedRequest<PosProduct[]>(`pos/catalog?warehouseId=${encodeURIComponent(order.warehouseId)}`)
      .then(setCatalog)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Katalog produk gagal dimuat.'))
      .finally(() => setCatalogLoading(false));
  }, [authorizedRequest, order.warehouseId]);

  const completedRefunds = (order.refunds ?? []).filter((refund) => refund.status === 'COMPLETED');
  const alreadyReturned = (lineId: string) => completedRefunds.flatMap((refund) => refund.items ?? []).filter((item) => item.orderItemId === lineId).reduce((total, item) => total + Number(item.quantity), 0);
  const remainingRefundable = Number(order.grandTotal) - completedRefunds.reduce((total, refund) => total + Number(refund.amount), 0);

  // Mirrors the server: returned goods are worth what the customer actually paid, discounts and tax included.
  const credit = useMemo(() => {
    const items = order.items ?? [];
    const subtotal = Number(order.subtotal);
    if (subtotal <= 0) return 0;
    const value = items.reduce((total, item) => total + cents((Number(order.grandTotal) * Number(item.totalPrice) / subtotal) * (returnQuantities[item.id] ?? 0) / Number(item.quantity)), 0);
    const everything = items.every((item) => alreadyReturned(item.id) + (returnQuantities[item.id] ?? 0) === Number(item.quantity));
    return everything ? remainingRefundable : value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, returnQuantities]);

  // Same pricing as the POS: selling unit price + variant delta + one of each chosen add-on per item.
  const priceFor = (line: NewLine) => Number(line.product.sellingUnits.find((unit) => unit.unitId === line.unitId)?.sellingPrice ?? line.product.basePrice)
    + Number(line.product.variants?.find((variant) => variant.id === line.variantId)?.priceDelta ?? 0)
    + line.addonIds.reduce((sum, id) => sum + Number(line.product.addons?.find((addon) => addon.id === id)?.basePrice ?? 0), 0);
  const newSubtotal = lines.reduce((total, line) => total + cents(priceFor(line) * line.quantity), 0);
  const discountAmount = Math.min(Math.max(Number(discount) || 0, 0), newSubtotal);
  const newTotal = cents(newSubtotal - discountAmount);
  const difference = cents(newTotal - credit);
  const results = search.trim() ? catalog.filter((product) => `${product.name} ${product.sku} ${product.barcode ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8) : [];

  function changeReturn(lineId: string, delta: number) {
    const item = order.items?.find((entry) => entry.id === lineId);
    if (!item) return;
    const max = Math.max(0, Number(item.quantity) - alreadyReturned(lineId));
    setReturnQuantities((current) => ({ ...current, [lineId]: Math.min(max, Math.max(0, (current[lineId] ?? 0) + delta)) }));
  }

  function addProduct(product: PosProduct) {
    const unitId = product.sellingUnits[0]?.unitId ?? product.unit?.id ?? '';
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id && line.unitId === unitId && !line.variantId && !line.addonIds.length);
      if (existing) return current.map((line) => line === existing ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { key: `${product.id}-${Date.now()}`, product, unitId, variantId: '', addonIds: [], quantity: 1 }];
    });
    setSearch('');
  }

  const updateLine = (key: string, patch: Partial<NewLine>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line).filter((line) => line.quantity > 0));

  async function pickEvidence(useCamera: boolean) {
    if (evidence.length >= 8) { setError('Maksimal 8 foto bukti.'); return; }
    const permission = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(useCamera ? 'Izin kamera diperlukan untuk mengambil foto.' : 'Izin galeri diperlukan untuk memilih foto.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75, cameraType: ImagePicker.CameraType.back })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 8 - evidence.length, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    if (result.assets.some((asset) => Number(asset.fileSize ?? 0) > 5 * 1024 * 1024)) { setError('Ukuran setiap foto bukti maksimal 5 MB.'); return; }
    setEvidence((current) => [...current, ...result.assets].slice(0, 8));
    setError('');
  }

  async function submit() {
    setError('');
    const returnItems = Object.entries(returnQuantities).filter(([, quantity]) => quantity > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity: String(quantity) }));
    if (!returnItems.length) { setError('Pilih minimal satu barang yang dikembalikan.'); return; }
    if (!lines.length) { setError('Pilih minimal satu barang pengganti.'); return; }
    if (!reason.trim()) { setError('Alasan tukar barang wajib diisi.'); return; }
    if (difference > 0 && payMethod === 'CASH' && !(Number(received) >= difference)) { setError(`Uang diterima minimal ${money(difference)}.`); return; }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('reason', reason.trim());
      form.append('returnItems', JSON.stringify(returnItems));
      form.append('items', JSON.stringify(lines.map((line) => ({ productId: line.product.id, unitId: line.unitId || undefined, variantId: line.variantId || undefined, quantity: String(line.quantity), addons: line.addonIds.map((addonId) => ({ addonId, quantity: '1' })) }))));
      if (discountAmount > 0) form.append('discountAmount', discountAmount.toFixed(2));
      // The server settles a single payment at its own computed difference.
      if (difference > 0) form.append('payments', JSON.stringify([{ method: payMethod, amount: difference.toFixed(2), ...(payMethod === 'CASH' ? { receivedAmount: Number(received).toFixed(2) } : {}) }]));
      if (difference < 0) form.append('refundMethod', refundMethod);
      evidence.forEach((asset, index) => {
        const name = asset.fileName ?? asset.uri.split('/').pop() ?? `exchange-${index}.jpg`;
        if (Platform.OS === 'web') {
          if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
          form.append('images', asset.file, name);
        } else form.append('images', new File(asset.uri), name);
      });
      onDone(await authorizedRequest<ExchangeResult>(`orders/${order.id}/exchange`, { method: 'POST', body: form }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Tukar barang gagal diproses.'); }
    finally { setSubmitting(false); }
  }

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!submitting) onClose(); }}><View style={styles.backdrop}><View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 8, 16) }]}>
    <View style={styles.header}><View style={styles.flex}><Text style={styles.title}>Tukar barang</Text><Text style={styles.muted}>{order.orderNumber}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup form tukar barang" disabled={submitting} onPress={onClose} style={styles.close}><X size={18} color="#53677e" /></Pressable></View>
    <KeyboardAwareScrollView bottomOffset={24} style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.section}>1. Barang dikembalikan</Text>
      {(order.items ?? []).map((item) => {
        const max = Math.max(0, Number(item.quantity) - alreadyReturned(item.id));
        const quantity = returnQuantities[item.id] ?? 0;
        return <View key={item.id} style={styles.line}><View style={styles.flex}><Text style={styles.value}>{item.productNameSnapshot}{item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ''}</Text><Text style={styles.muted}>Sisa bisa ditukar {max}</Text></View><Stepper value={quantity} disabledMinus={quantity <= 0} disabledPlus={quantity >= max} onChange={(delta) => changeReturn(item.id, delta)} label={item.productNameSnapshot} /></View>;
      })}

      <Text style={styles.section}>2. Barang pengganti</Text>
      <TextInput accessibilityLabel="Cari barang pengganti" style={styles.input} value={search} onChangeText={setSearch} placeholder={catalogLoading ? 'Memuat katalog…' : 'Cari nama, SKU, atau barcode'} placeholderTextColor="#87948c" />
      {results.map((product) => <Pressable key={product.id} accessibilityRole="button" onPress={() => addProduct(product)} style={styles.result}><View style={styles.flex}><Text style={styles.value}>{product.name}</Text><Text style={styles.muted}>{product.sku} · stok {Number(product.available)}</Text></View><Text style={styles.price}>{money(Number(product.sellingUnits[0]?.sellingPrice ?? product.basePrice))}</Text></Pressable>)}
      {lines.map((line) => <View key={line.key} style={styles.newLine}>
        <View style={styles.row}><View style={styles.flex}><Text style={styles.value}>{line.product.name}</Text><Text style={styles.muted}>{money(priceFor(line))} / item</Text></View><Stepper value={line.quantity} disabledMinus={false} disabledPlus={false} onChange={(delta) => updateLine(line.key, { quantity: line.quantity + delta })} label={line.product.name} /><Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${line.product.name}`} onPress={() => updateLine(line.key, { quantity: 0 })} style={styles.remove}><Trash2 size={15} color="#b42318" /></Pressable></View>
        {line.product.sellingUnits.length > 1 ? <View style={styles.chips}>{line.product.sellingUnits.map((unit) => <Chip key={unit.unitId} label={unit.unit.code} active={line.unitId === unit.unitId} onPress={() => updateLine(line.key, { unitId: unit.unitId })} />)}</View> : null}
        {line.product.variants?.length ? <View style={styles.chips}><Chip label="Standar" active={!line.variantId} onPress={() => updateLine(line.key, { variantId: '' })} />{line.product.variants.map((variant) => <Chip key={variant.id} label={variant.name} active={line.variantId === variant.id} onPress={() => updateLine(line.key, { variantId: variant.id })} />)}</View> : null}
        {line.product.addons?.length ? <View style={styles.chips}>{line.product.addons.map((addon) => { const active = line.addonIds.includes(addon.id); return <Chip key={addon.id} label={`+ ${addon.name} ${money(Number(addon.basePrice))}`} active={active} onPress={() => updateLine(line.key, { addonIds: active ? line.addonIds.filter((id) => id !== addon.id) : [...line.addonIds, addon.id] })} />; })}</View> : null}
      </View>)}
      {lines.length ? <><Text style={styles.fieldLabel}>Diskon barang pengganti</Text><MoneyInput accessibilityLabel="Diskon barang pengganti" style={styles.input} value={discount} onChangeText={setDiscount} placeholder="0" placeholderTextColor="#87948c" /></> : null}

      <Text style={styles.section}>3. Selisih</Text>
      <View style={styles.summary}>
        <View style={styles.row}><Text style={styles.muted}>Nilai barang dikembalikan</Text><Text style={styles.value}>{money(credit)}</Text></View>
        <View style={styles.row}><Text style={styles.muted}>Total barang pengganti</Text><Text style={styles.value}>{money(newTotal)}</Text></View>
        <View style={[styles.row, styles.summaryTotal]}><Text style={styles.value}>{difference > 0 ? 'Pelanggan bayar' : difference < 0 ? 'Toko kembalikan' : 'Selisih'}</Text><Text style={[styles.total, difference < 0 && styles.totalRefund]}>{difference === 0 ? 'Pas' : money(Math.abs(difference))}</Text></View>
      </View>
      {difference > 0 ? <>
        <Text style={styles.fieldLabel}>Metode bayar selisih</Text><View style={styles.chips}>{refundPaymentMethods.map((method) => <Chip key={method} label={formatStatus(method)} active={payMethod === method} onPress={() => setPayMethod(method)} />)}</View>
        {payMethod === 'CASH' ? <><Text style={styles.fieldLabel}>Uang diterima *</Text><MoneyInput accessibilityLabel="Uang diterima" style={styles.input} value={received} onChangeText={setReceived} placeholder={String(Math.ceil(difference))} placeholderTextColor="#87948c" />{Number(received) > difference ? <Text style={styles.muted}>Kembalian {money(Number(received) - difference)}</Text> : null}</> : null}
      </> : null}
      {difference < 0 ? <><Text style={styles.fieldLabel}>Selisih dikembalikan lewat</Text><View style={styles.chips}>{refundMethodsFor(order.payments).map((method) => <Chip key={method} label={formatStatus(method)} active={refundMethod === method} onPress={() => setRefundMethod(method)} />)}</View></> : null}

      <Text style={styles.fieldLabel}>Alasan *</Text><TextInput accessibilityLabel="Alasan tukar barang" style={[styles.input, styles.multiline]} value={reason} onChangeText={setReason} placeholder="Wajib diisi, contoh: salah ukuran" placeholderTextColor="#87948c" multiline />
      <Text style={styles.fieldLabel}>Bukti barang dikembalikan (opsional)</Text><Text style={styles.muted}>Maksimal 8 foto.</Text>
      <View style={styles.evidenceActions}><Pressable onPress={() => void pickEvidence(true)} style={styles.evidenceButton}><Text style={styles.evidenceButtonText}>Ambil foto</Text></Pressable><AdminOnly><Pressable onPress={() => void pickEvidence(false)} style={styles.evidenceButton}><Text style={styles.evidenceButtonText}>Pilih galeri</Text></Pressable></AdminOnly></View>
      {evidence.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.evidenceRow}>{evidence.map((asset, index) => <View key={`${asset.assetId ?? asset.uri}-${index}`}><PreviewImage uri={asset.uri} images={evidence.map((entry) => entry.uri)} index={index} style={styles.evidenceImage} /><Pressable accessibilityLabel={`Hapus foto ${index + 1}`} onPress={() => setEvidence((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeEvidence}><Text style={styles.removeEvidenceText}>×</Text></Pressable></View>)}</ScrollView> : null}
    </KeyboardAwareScrollView>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void submit()} style={[styles.submit, submitting && styles.disabled]}>{submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Proses tukar barang</Text>}</Pressable>
  </View></View></Modal>;
}

function Stepper({ value, onChange, disabledMinus, disabledPlus, label }: { value: number; onChange: (delta: number) => void; disabledMinus: boolean; disabledPlus: boolean; label: string }) {
  return <View style={styles.stepper}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${label}`} disabled={disabledMinus} onPress={() => onChange(-1)} style={[styles.stepButton, disabledMinus && styles.disabled]}><Minus size={14} color="#087f5b" /></Pressable>
    <Text style={styles.stepValue}>{value}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${label}`} disabled={disabledPlus} onPress={() => onChange(1)} style={[styles.stepButton, disabledPlus && styles.disabled]}><Plus size={14} color="#087f5b" /></Pressable>
  </View>;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, sheet: { maxHeight: '92%', paddingTop: 14, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#edf1ee' }, title: { color: '#172820', fontSize: 15, fontWeight: '900' }, close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' },
  body: { flexGrow: 0 }, content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }, flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  section: { marginTop: 16, marginBottom: 6, color: '#172820', fontSize: 13, fontWeight: '900' }, fieldLabel: { marginTop: 13, marginBottom: 6, color: '#34453b', fontSize: 11, fontWeight: '800' },
  muted: { marginTop: 3, color: '#84918b', fontSize: 10 }, value: { color: '#34453b', fontSize: 12, fontWeight: '700' }, price: { color: '#087f5b', fontSize: 11, fontWeight: '900' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#edf1ee' },
  input: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, color: '#172820', backgroundColor: '#fff' }, multiline: { minHeight: 76, paddingTop: 11, textAlignVertical: 'top' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: '#f5f9f7' },
  newLine: { marginTop: 8, padding: 10, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12 }, remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#fff4f2' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 }, chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f1f5f2' }, chipActive: { backgroundColor: '#e7f5ee' }, chipText: { color: '#718078', fontSize: 9, fontWeight: '800' }, chipTextActive: { color: '#087f5b' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 }, stepButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e7f5ee' }, stepValue: { minWidth: 22, textAlign: 'center', color: '#172820', fontSize: 13, fontWeight: '900' },
  summary: { padding: 12, borderRadius: 12, backgroundColor: '#f5f9f7', gap: 6 }, summaryTotal: { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#dceee5' }, total: { color: '#087f5b', fontSize: 15, fontWeight: '900' }, totalRefund: { color: '#b42318' },
  evidenceActions: { flexDirection: 'row', gap: 8, marginTop: 8 }, evidenceButton: { flex: 1, alignItems: 'center', padding: 11, borderRadius: 10, backgroundColor: '#e7f5ee' }, evidenceButtonText: { color: '#087f5b', fontSize: 11, fontWeight: '800' },
  evidenceRow: { gap: 8, paddingVertical: 9 }, evidenceImage: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#edf1ee' }, removeEvidence: { position: 'absolute', top: 3, right: 3, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#a3332a' }, removeEvidenceText: { color: '#fff', fontSize: 16, fontWeight: '900', lineHeight: 18 },
  error: { marginHorizontal: 16, marginTop: 8, color: '#a3332a', fontSize: 11 }, submit: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 13, marginHorizontal: 16, borderRadius: 12, backgroundColor: '#087f5b' }, submitText: { color: '#fff', fontSize: 12, fontWeight: '900' }, disabled: { opacity: 0.4 },
});
