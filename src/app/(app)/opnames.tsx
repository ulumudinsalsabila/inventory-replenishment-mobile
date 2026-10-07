import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatDate, formatStatus } from '../../lib/display';

type Warehouse = { id: string; name: string; code: string };
type WarehousePage = { data: Warehouse[] };
type InventoryRow = { id: string; onHand: string; product: { id: string; sku: string; name: string; unit: { code: string } }; warehouse: Warehouse };
type InventoryPage = { data: InventoryRow[]; meta: { page: number; totalPages: number } };
type OpnameItem = { id: string; systemQtySnapshot: string; physicalQty: string; differenceQty: string; product: { id: string; sku: string; name: string; unit?: { code: string } } };
type Opname = { id: string; opnameNumber: string; status: string; createdAt: string; warehouse: Warehouse; items: OpnameItem[] };
type OpnamePage = { data: Opname[]; meta: { page: number; totalPages: number } };

const statusLabels: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Diajukan', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan' };
const qty = (value: string | number) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 4 });

export default function OpnamesScreen() {
  const { user, authorizedRequest } = useAuth();
  const canCreate = user?.permissions.includes('inventory.opname') ?? false;
  const [rows, setRows] = useState<Opname[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryTotalPages, setInventoryTotalPages] = useState(1);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Opname | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [opnamePage, warehousePage] = await Promise.all([
        authorizedRequest<OpnamePage>('inventory/opnames?page=1&perPage=50&sortBy=createdAt&sortOrder=desc'),
        authorizedRequest<WarehousePage>('catalog/warehouses?page=1&perPage=100&sortBy=name&sortOrder=asc'),
      ]);
      setRows(opnamePage.data);
      setWarehouses(warehousePage.data);
      setWarehouseId((current) => current || warehousePage.data[0]?.id || '');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Data opname belum dapat dimuat.'); }
    finally { setLoading(false); }
  }, [authorizedRequest]);

  // Refresh the list when the screen opens or a mutation completes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load, reload]);

  useEffect(() => {
    if (!creating || !warehouseId) return;
    const params = new URLSearchParams({ page: String(inventoryPage), perPage: '100', warehouseId, sortBy: 'updatedAt', sortOrder: 'asc' });
    if (search.trim()) params.set('search', search.trim());
    let active = true;
    void authorizedRequest<InventoryPage>(`inventory?${params.toString()}`).then((result) => {
      if (active) { setInventory(result.data); setInventoryTotalPages(Math.max(1, result.meta.totalPages)); }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Stok gudang belum dapat dimuat.'); });
    return () => { active = false; };
  }, [authorizedRequest, creating, warehouseId, search, inventoryPage]);

  async function openOpname(id: string) {
    setLoading(true); setError('');
    try { setSelected(await authorizedRequest<Opname>(`inventory/opnames/${id}`)); setCreating(false); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Detail opname belum dapat dimuat.'); }
    finally { setLoading(false); }
  }

  async function createOpname() {
    if (!warehouseId) { setError('Pilih gudang terlebih dahulu.'); return; }
    const items = Object.entries(counts).filter(([, value]) => value.trim() !== '').map(([productId, physicalQty]) => ({ productId, physicalQty: physicalQty.replace(',', '.') }));
    if (!items.length) { setError('Masukkan jumlah fisik setidaknya untuk satu produk.'); return; }
    if (items.some((item) => !Number.isFinite(Number(item.physicalQty)) || Number(item.physicalQty) < 0)) { setError('Jumlah fisik harus berupa angka nol atau lebih.'); return; }
    setSaving(true); setError('');
    try {
      const created = await authorizedRequest<Opname>('inventory/opnames', { method: 'POST', body: JSON.stringify({ warehouseId, items }) });
      setCreating(false); setCounts({}); setSelected(await authorizedRequest<Opname>(`inventory/opnames/${created.id}`)); setReload((value) => value + 1);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Draft opname belum dapat disimpan.'); }
    finally { setSaving(false); }
  }

  async function runAction(action: 'submit' | 'complete' | 'cancel') {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await authorizedRequest(`inventory/opnames/${selected.id}/${action}`, { method: 'POST' });
      setSelected(await authorizedRequest<Opname>(`inventory/opnames/${selected.id}`)); setReload((value) => value + 1);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Aksi opname belum dapat diproses.'); }
    finally { setSaving(false); }
  }

  return <View style={styles.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={loading && !creating && !selected} onRefresh={() => setReload((value) => value + 1)} tintColor="#087f5b" />}>
    <Pressable accessibilityRole="button" onPress={() => { setSelected(null); setCreating(false); router.back(); }} style={styles.back}><Text style={styles.backText}>‹  Operasional</Text></Pressable>
    <Text style={styles.eyebrow}>PERSEDIAAN</Text><Text style={styles.title}>Stock opname</Text><Text style={styles.subtitle}>Catat jumlah fisik dan sesuaikan stok setelah pemeriksaan.</Text>
    {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => setReload((value) => value + 1)}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
    {loading && !selected && !creating ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : null}
    {selected ? <>
      <Pressable onPress={() => setSelected(null)} style={styles.back}><Text style={styles.backText}>‹  Daftar opname</Text></Pressable>
      <View style={styles.summary}><Text style={styles.number}>{selected.opnameNumber}</Text><Text style={styles.status}>{statusLabels[selected.status] ?? formatStatus(selected.status)}</Text><Text style={styles.muted}>{selected.warehouse.name} · {formatDate(selected.createdAt)}</Text></View>
      <Text style={styles.sectionTitle}>Hasil hitung</Text>
      {selected.items.map((item) => <View key={item.id} style={styles.itemCard}><Text style={styles.product}>{item.product.name}</Text><Text style={styles.muted}>{item.product.sku}{item.product.unit?.code ? ` · ${item.product.unit.code}` : ''}</Text><View style={styles.qtyRow}><Text style={styles.muted}>Sistem {qty(item.systemQtySnapshot)} · Fisik {qty(item.physicalQty)}</Text><Text style={[styles.diff, Number(item.differenceQty) !== 0 && styles.diffChanged]}>{Number(item.differenceQty) > 0 ? '+' : ''}{qty(item.differenceQty)}</Text></View></View>)}
      {canCreate && selected.status === 'DRAFT' ? <><Pressable disabled={saving} onPress={() => void runAction('submit')} style={[styles.primary, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Ajukan opname</Text>}</Pressable><Pressable disabled={saving} onPress={() => void runAction('cancel')} style={styles.secondary}><Text style={styles.secondaryText}>Batalkan draft</Text></Pressable></> : null}
      {canCreate && selected.status === 'SUBMITTED' ? <><Pressable disabled={saving} onPress={() => void runAction('complete')} style={[styles.primary, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Selesaikan dan sesuaikan stok</Text>}</Pressable><Pressable disabled={saving} onPress={() => void runAction('cancel')} style={styles.secondary}><Text style={styles.secondaryText}>Batalkan opname</Text></Pressable></> : null}
    </> : creating ? <>
      <Pressable onPress={() => setCreating(false)} style={styles.back}><Text style={styles.backText}>‹  Daftar opname</Text></Pressable>
      <Text style={styles.sectionTitle}>Gudang</Text>
      <View style={styles.warehouseRow}>{warehouses.map((warehouse) => <Pressable key={warehouse.id} onPress={() => { setWarehouseId(warehouse.id); setInventoryPage(1); }} style={[styles.warehouse, warehouseId === warehouse.id && styles.warehouseSelected]}><Text style={[styles.warehouseText, warehouseId === warehouse.id && styles.warehouseTextSelected]}>{warehouse.name}</Text></Pressable>)}</View>
      <Text style={styles.sectionTitle}>Hitung barang</Text><TextInput accessibilityLabel="Cari produk atau SKU" value={search} onChangeText={(value) => { setSearch(value); setInventoryPage(1); }} placeholder="Cari produk atau SKU" placeholderTextColor="#87948c" style={styles.search} />
      {!inventory.length ? <Text style={styles.muted}>Tidak ada stok produk pada hasil pencarian ini.</Text> : inventory.map((item) => <View key={item.id} style={styles.itemCard}><View style={styles.row}><View style={styles.flex}><Text style={styles.product}>{item.product.name}</Text><Text style={styles.muted}>{item.product.sku} · Sistem {qty(item.onHand)} {item.product.unit.code}</Text></View><TextInput accessibilityLabel={`Jumlah fisik ${item.product.name}`} keyboardType="decimal-pad" value={counts[item.product.id] ?? ''} onChangeText={(value) => setCounts((current) => ({ ...current, [item.product.id]: value }))} placeholder="Fisik" placeholderTextColor="#87948c" style={styles.countInput} /></View></View>)}
      {inventoryTotalPages > 1 ? <View style={styles.pagination}><Pressable disabled={inventoryPage <= 1} onPress={() => setInventoryPage((page) => Math.max(1, page - 1))} style={[styles.pageButton, inventoryPage <= 1 && styles.disabled]}><Text style={styles.pageText}>‹ Sebelumnya</Text></Pressable><Text style={styles.pageText}>{inventoryPage} / {inventoryTotalPages}</Text><Pressable disabled={inventoryPage >= inventoryTotalPages} onPress={() => setInventoryPage((page) => Math.min(inventoryTotalPages, page + 1))} style={[styles.pageButton, inventoryPage >= inventoryTotalPages && styles.disabled]}><Text style={styles.pageText}>Berikutnya ›</Text></Pressable></View> : null}
      <Pressable disabled={saving || !canCreate} onPress={() => void createOpname()} style={[styles.primary, (saving || !canCreate) && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Simpan draft ({Object.values(counts).filter((value) => value.trim() !== '').length} produk)</Text>}</Pressable>
    </> : <>
      {canCreate ? <Pressable accessibilityRole="button" onPress={() => { setSearch(''); setCreating(true); }} style={styles.primary}><Text style={styles.primaryText}>+ Buat stock opname</Text></Pressable> : null}
      {rows.map((row) => <Pressable accessibilityRole="button" key={row.id} onPress={() => void openOpname(row.id)} style={styles.itemCard}><View style={styles.row}><View style={styles.flex}><Text style={styles.number}>{row.opnameNumber}</Text><Text style={styles.muted}>{row.warehouse.name} · {row.items.length} produk · {formatDate(row.createdAt)}</Text></View><Text style={styles.status}>{statusLabels[row.status] ?? formatStatus(row.status)}</Text></View></Pressable>)}
      {!loading && !rows.length ? <View style={styles.empty}><Text style={styles.product}>Belum ada stock opname</Text><Text style={styles.muted}>Opname yang dibuat akan tampil di sini.</Text></View> : null}
    </>}
  </ScrollView></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 20, paddingBottom: 36 }, back: { alignSelf: 'flex-start', marginBottom: 15, paddingVertical: 4 }, backText: { color: '#087f5b', fontSize: 13, fontWeight: '800' }, eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 26, fontWeight: '900' }, subtitle: { marginTop: 5, color: '#718078', fontSize: 12, lineHeight: 18 }, loader: { padding: 24 }, sectionTitle: { marginTop: 20, marginBottom: 9, color: '#26372e', fontSize: 15, fontWeight: '900' }, itemCard: { marginTop: 8, padding: 13, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 14, backgroundColor: '#fff' }, summary: { marginTop: 8, padding: 15, borderRadius: 15, backgroundColor: '#fff' }, number: { color: '#26372e', fontSize: 14, fontWeight: '900' }, status: { color: '#087f5b', fontSize: 10, fontWeight: '900' }, muted: { marginTop: 4, color: '#84918b', fontSize: 11 }, product: { color: '#26372e', fontSize: 13, fontWeight: '800' }, qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#edf1ee' }, diff: { color: '#718078', fontSize: 12, fontWeight: '900' }, diffChanged: { color: '#087f5b' }, primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingHorizontal: 14, borderRadius: 13, backgroundColor: '#087f5b' }, primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' }, secondary: { minHeight: 45, alignItems: 'center', justifyContent: 'center', marginTop: 8, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff' }, secondaryText: { color: '#68766e', fontSize: 12, fontWeight: '800' }, disabled: { opacity: 0.5 }, errorCard: { marginTop: 14, padding: 13, borderRadius: 14, backgroundColor: '#fff1f0' }, errorText: { color: '#a3332a', fontSize: 12 }, retry: { marginTop: 7, color: '#087f5b', fontSize: 12, fontWeight: '900' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, flex: { flex: 1 }, warehouseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, warehouse: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: '#fff' }, warehouseSelected: { backgroundColor: '#e7f5ee' }, warehouseText: { color: '#718078', fontSize: 11, fontWeight: '700' }, warehouseTextSelected: { color: '#087f5b' }, search: { height: 45, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, backgroundColor: '#fff', color: '#172820' }, countInput: { width: 92, height: 42, paddingHorizontal: 8, borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, color: '#172820', textAlign: 'center' }, pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, pageButton: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, backgroundColor: '#e7f5ee' }, pageText: { color: '#087f5b', fontSize: 10, fontWeight: '800' }, empty: { alignItems: 'center', marginTop: 15, padding: 22, borderRadius: 15, backgroundColor: '#fff' } });
