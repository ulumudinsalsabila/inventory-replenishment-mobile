import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatDate, formatStatus } from '../../lib/display';

type Warehouse = { id: string; name: string; code: string };
type Product = { id: string; sku: string; name: string; unit: { code: string } };
type Stock = { id: string; onHand: string; product: Product; warehouse: Warehouse };
type Adjustment = { id: string; adjustmentNumber: string; reason: string; note: string; createdAt: string; warehouse: Warehouse; items: { id: string; quantityDelta: string; product: Product }[] };
type Page<T> = { data: T[]; meta: { page: number; totalPages: number } };
const reasons = ['CORRECTION', 'WASTE', 'DAMAGED', 'LOST', 'INTERNAL_USE', 'OTHER'];
const labels: Record<string, string> = { CORRECTION: 'Koreksi', WASTE: 'Terbuang', DAMAGED: 'Rusak', LOST: 'Hilang', INTERNAL_USE: 'Pemakaian internal', OTHER: 'Lainnya' };
const qty = (value: string) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 4 });

export default function AdjustmentsScreen() {
  const { user, authorizedRequest } = useAuth();
  const allowed = user?.permissions.includes('inventory.adjust') ?? false;
  const [rows, setRows] = useState<Adjustment[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('CORRECTION');
  const [note, setNote] = useState('');
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void Promise.all([
      authorizedRequest<Page<Adjustment>>('inventory/adjustments?page=1&perPage=20&sortBy=createdAt&sortOrder=desc'),
      authorizedRequest<Page<Warehouse>>('catalog/warehouses?page=1&perPage=100&sortBy=name&sortOrder=asc'),
    ]).then(([adjustmentPage, warehousePage]) => {
      if (!active) return;
      setRows(adjustmentPage.data); setWarehouses(warehousePage.data);
      setWarehouseId((current) => current || (user?.branchId ? warehousePage.data.find((item) => item.code)?.id : warehousePage.data[0]?.id) || '');
      setError('');
    }).catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Data adjustment belum dapat dimuat.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, authorizedRequest, reload, user?.branchId]);

  useEffect(() => {
    if (!warehouseId || !allowed) return;
    let active = true;
    void authorizedRequest<Page<Stock>>(`inventory?page=1&perPage=100&warehouseId=${encodeURIComponent(warehouseId)}&sortBy=updatedAt&sortOrder=desc`)
      .then((result) => { if (active) setStock(result.data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Stok gudang belum dapat dimuat.'); });
    return () => { active = false; };
  }, [authorizedRequest, allowed, warehouseId, reload]);

  async function submit() {
    const items = Object.entries(deltas).filter(([, value]) => value.trim()).map(([productId, quantityDelta]) => ({ productId, quantityDelta: quantityDelta.replace(',', '.') }));
    if (!warehouseId || !note.trim() || !items.length) { setError('Pilih gudang, isi alasan/catatan, dan masukkan perubahan untuk minimal satu produk.'); return; }
    if (items.some((item) => !Number.isFinite(Number(item.quantityDelta)) || Number(item.quantityDelta) === 0)) { setError('Perubahan stok harus berupa angka selain nol. Gunakan nilai negatif untuk mengurangi stok.'); return; }
    if (reason === 'WASTE' && items.some((item) => Number(item.quantityDelta) > 0)) { setError('Stok terbuang harus menggunakan jumlah negatif.'); return; }
    setSaving(true); setError('');
    try {
      await authorizedRequest<Adjustment>('inventory/adjustments', { method: 'POST', body: JSON.stringify({ warehouseId, reason, note: note.trim(), items }) });
      setDeltas({}); setNote(''); setReload((value) => value + 1);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Adjustment stok gagal disimpan.'); }
    finally { setSaving(false); }
  }

  return <View style={styles.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { setLoading(true); setReload((value) => value + 1); }} tintColor="#087f5b" />}>
    <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹  Operasional</Text></Pressable>
    <Text style={styles.eyebrow}>PERSEDIAAN</Text><Text style={styles.title}>Adjustment stok</Text><Text style={styles.subtitle}>Catat koreksi stok dengan jejak perubahan dan alasan.</Text>
    {!allowed ? <View style={styles.card}><Text style={styles.section}>Akses tidak tersedia</Text><Text style={styles.muted}>Fitur ini memerlukan permission inventory.adjust.</Text></View> : null}
    {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
    {loading && allowed ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : null}
    {allowed ? <>
      <View style={styles.card}><Text style={styles.section}>Buat adjustment</Text><Text style={styles.label}>Gudang</Text><View style={styles.chips}>{warehouses.map((item) => <Pressable key={item.id} onPress={() => setWarehouseId(item.id)} style={[styles.chip, warehouseId === item.id && styles.chipActive]}><Text style={[styles.chipText, warehouseId === item.id && styles.chipTextActive]}>{item.name}</Text></Pressable>)}</View>
      <Text style={styles.label}>Jenis</Text><View style={styles.chips}>{reasons.map((item) => <Pressable key={item} onPress={() => setReason(item)} style={[styles.chip, reason === item && styles.chipActive]}><Text style={[styles.chipText, reason === item && styles.chipTextActive]}>{labels[item]}</Text></Pressable>)}</View>
      <TextInput accessibilityLabel="Catatan adjustment" value={note} onChangeText={setNote} placeholder="Alasan dan catatan wajib" style={styles.input} multiline />
      <Text style={styles.label}>Perubahan per produk (negatif untuk pengurangan)</Text>
      {stock.map((item) => <View key={item.product.id} style={styles.productRow}><View style={styles.productInfo}><Text style={styles.productName}>{item.product.name}</Text><Text style={styles.muted}>{item.product.sku} · Stok {qty(item.onHand)} {item.product.unit.code}</Text></View><TextInput accessibilityLabel={`Perubahan stok ${item.product.name}`} value={deltas[item.product.id] ?? ''} onChangeText={(value) => setDeltas((current) => ({ ...current, [item.product.id]: value }))} keyboardType="numbers-and-punctuation" placeholder="± jumlah" style={styles.qtyInput} /></View>)}
      <Pressable disabled={saving} onPress={() => void submit()} style={[styles.primary, saving && styles.dim]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Simpan adjustment</Text>}</Pressable></View>
      <Text style={styles.sectionTitle}>Riwayat adjustment</Text>
      {rows.map((row) => <View key={row.id} style={styles.card}><Text style={styles.adjustmentNo}>{row.adjustmentNumber}</Text><Text style={styles.muted}>{labels[row.reason] ?? formatStatus(row.reason)} · {row.warehouse.name} · {formatDate(row.createdAt)}</Text><Text style={styles.muted}>{row.items.map((item) => `${item.product.name}: ${Number(item.quantityDelta) > 0 ? '+' : ''}${qty(item.quantityDelta)}`).join('  ·  ')}</Text><Text style={styles.muted}>{row.note}</Text></View>)}
      {!rows.length && !loading ? <Text style={styles.empty}>Belum ada adjustment.</Text> : null}
    </> : null}
  </ScrollView></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 20, paddingTop: 18, paddingBottom: 36 }, back: { alignSelf: 'flex-start', marginBottom: 20 }, backText: { color: '#087f5b', fontSize: 13, fontWeight: '800' }, eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '800' }, subtitle: { marginTop: 5, color: '#718078', fontSize: 12 }, card: { marginTop: 14, padding: 15, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 16, backgroundColor: '#fff', gap: 8 }, section: { color: '#26372e', fontSize: 15, fontWeight: '900' }, sectionTitle: { marginTop: 23, color: '#26372e', fontSize: 15, fontWeight: '900' }, label: { marginTop: 8, color: '#718078', fontSize: 11, fontWeight: '800' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f1f4f2' }, chipActive: { backgroundColor: '#e7f5ee' }, chipText: { color: '#68766e', fontSize: 10, fontWeight: '800' }, chipTextActive: { color: '#087f5b' }, input: { minHeight: 48, padding: 11, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, color: '#26372e', textAlignVertical: 'top' }, productRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#edf1ee' }, productInfo: { flex: 1 }, productName: { color: '#26372e', fontSize: 12, fontWeight: '800' }, muted: { marginTop: 4, color: '#84918b', fontSize: 10, lineHeight: 15 }, qtyInput: { width: 90, height: 42, paddingHorizontal: 7, borderWidth: 1, borderColor: '#dce4df', borderRadius: 9, textAlign: 'center', color: '#26372e' }, primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 12, backgroundColor: '#087f5b' }, primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' }, dim: { opacity: 0.5 }, adjustmentNo: { color: '#087f5b', fontSize: 13, fontWeight: '900' }, error: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#fff1ef' }, errorText: { color: '#a3332a', fontSize: 11 }, loader: { padding: 16 }, empty: { marginTop: 8, padding: 15, borderRadius: 12, backgroundColor: '#fff', color: '#84918b', fontSize: 11 } });
