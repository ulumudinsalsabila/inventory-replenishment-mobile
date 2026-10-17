import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatDate, formatStatus } from '../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type Warehouse = { id: string; name: string; code: string };
type WarehousePage = { data: Warehouse[] };
type InventoryRow = { id: string; onHand: string; product: { id: string; sku: string; name: string; unit: { code: string } }; warehouse: Warehouse };
type OpnameItem = { id: string; systemQtySnapshot: string; physicalQty: string; differenceQty: string; product: { id: string; sku: string; name: string; unit?: { code: string } } };
type Opname = { id: string; opnameNumber: string; status: string; createdAt: string; warehouse: Warehouse; items: OpnameItem[] };

const statusLabels: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Diajukan', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan' };
const qty = (value: string | number) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 4 });
const noop = () => undefined;

export default function OpnamesScreen() {
  const { user, authorizedRequest } = useAuth();
  const canCreate = user?.permissions.includes('inventory.opname') ?? false;
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  // Counts are keyed by product id, outside the lazily loaded rows, so loading more rows or searching never drops them.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Opname | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const list = useInfiniteList<Opname>(authorizedRequest, 'inventory/opnames?sortBy=createdAt&sortOrder=desc');
  const rows = list.items;
  const inventoryParams = new URLSearchParams({ warehouseId, sortBy: 'updatedAt', sortOrder: 'asc' });
  if (debouncedSearch) inventoryParams.set('search', debouncedSearch);
  const inventoryList = useInfiniteList<InventoryRow>(authorizedRequest, creating && warehouseId ? `inventory?${inventoryParams.toString()}` : null);
  const inventory = inventoryList.items;
  // Only the list visible in the current mode loads more rows on scroll.
  const scrollProps = useLoadMoreOnScroll(selected ? noop : creating ? inventoryList.loadMore : list.loadMore);

  const loadWarehouses = useCallback(async () => {
    try {
      const warehousePage = await authorizedRequest<WarehousePage>('catalog/warehouses?page=1&perPage=100&sortBy=name&sortOrder=asc');
      setWarehouses(warehousePage.data);
      setWarehouseId((current) => current || warehousePage.data[0]?.id || '');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Data gudang belum dapat dimuat.'); }
  }, [authorizedRequest]);

  // Load the warehouse choices when the screen opens.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadWarehouses(); }, [loadWarehouses]);

  function retry() { setError(''); void loadWarehouses(); void list.reload(); }

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
      setCreating(false); setCounts({}); setSelected(await authorizedRequest<Opname>(`inventory/opnames/${created.id}`)); void list.reload();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Draft opname belum dapat disimpan.'); }
    finally { setSaving(false); }
  }

  async function runAction(action: 'submit' | 'complete' | 'cancel') {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await authorizedRequest(`inventory/opnames/${selected.id}/${action}`, { method: 'POST' });
      setSelected(await authorizedRequest<Opname>(`inventory/opnames/${selected.id}`)); void list.reload();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Aksi opname belum dapat diproses.'); }
    finally { setSaving(false); }
  }

  return <View style={styles.screen}><KeyboardAwareScrollView {...scrollProps} bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={creating ? inventoryList.refreshing : list.refreshing} onRefresh={() => { if (creating) void inventoryList.refresh(); else { void loadWarehouses(); void list.refresh(); } }} tintColor="#087f5b" />}>
    <Text style={styles.subtitle}>Catat jumlah fisik dan sesuaikan stok setelah pemeriksaan.</Text>
    {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
    {(loading || (list.loading && !rows.length)) && !selected && !creating ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : null}
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
      <View style={styles.warehouseRow}>{warehouses.map((warehouse) => <Pressable key={warehouse.id} onPress={() => setWarehouseId(warehouse.id)} style={[styles.warehouse, warehouseId === warehouse.id && styles.warehouseSelected]}><Text style={[styles.warehouseText, warehouseId === warehouse.id && styles.warehouseTextSelected]}>{warehouse.name}</Text></Pressable>)}</View>
      <Text style={styles.sectionTitle}>Hitung barang</Text><TextInput accessibilityLabel="Cari produk atau SKU" value={search} onChangeText={setSearch} placeholder="Cari produk atau SKU" placeholderTextColor="#87948c" style={styles.search} />
      {inventoryList.error && !inventory.length ? <View style={styles.errorCard}><Text style={styles.errorText}>{inventoryList.error}</Text><Pressable accessibilityRole="button" onPress={() => void inventoryList.reload()}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
      {inventoryList.loading && !inventory.length ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : null}
      {!inventoryList.loading && !inventoryList.error && !inventory.length ? <Text style={styles.muted}>Tidak ada stok produk pada hasil pencarian ini.</Text> : null}
      {inventory.map((item) => <View key={item.id} style={styles.itemCard}><View style={styles.row}><View style={styles.flex}><Text style={styles.product}>{item.product.name}</Text><Text style={styles.muted}>{item.product.sku} · Sistem {qty(item.onHand)} {item.product.unit.code}</Text></View><TextInput accessibilityLabel={`Jumlah fisik ${item.product.name}`} keyboardType="decimal-pad" value={counts[item.product.id] ?? ''} onChangeText={(value) => setCounts((current) => ({ ...current, [item.product.id]: value }))} placeholder="Fisik" placeholderTextColor="#87948c" style={styles.countInput} /></View></View>)}
      <LoadMoreFooter loadingMore={inventoryList.loadingMore} hasMore={inventoryList.hasMore} count={inventory.length} error={inventoryList.error} onRetry={inventoryList.loadMore} />
      <Pressable disabled={saving || !canCreate} onPress={() => void createOpname()} style={[styles.primary, (saving || !canCreate) && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Simpan draft ({Object.values(counts).filter((value) => value.trim() !== '').length} produk)</Text>}</Pressable>
    </> : <>
      {canCreate ? <Pressable accessibilityRole="button" onPress={() => { setSearch(''); setCreating(true); }} style={styles.primary}><Text style={styles.primaryText}>+ Buat stock opname</Text></Pressable> : null}
      {rows.map((row) => <Pressable accessibilityRole="button" key={row.id} onPress={() => void openOpname(row.id)} style={styles.itemCard}><View style={styles.row}><View style={styles.flex}><Text style={styles.number}>{row.opnameNumber}</Text><Text style={styles.muted}>{row.warehouse.name} · {row.items.length} produk · {formatDate(row.createdAt)}</Text></View><Text style={styles.status}>{statusLabels[row.status] ?? formatStatus(row.status)}</Text></View></Pressable>)}
      {list.error && !rows.length ? <View style={styles.errorCard}><Text style={styles.errorText}>{list.error}</Text><Pressable accessibilityRole="button" onPress={() => void list.reload()}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
      {!list.loading && !list.error && !rows.length ? <View style={styles.empty}><Text style={styles.product}>Belum ada stock opname</Text><Text style={styles.muted}>Opname yang dibuat akan tampil di sini.</Text></View> : null}
      <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={rows.length} error={list.error} onRetry={list.loadMore} />
    </>}
  </KeyboardAwareScrollView></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 20, paddingBottom: 36 }, back: { alignSelf: 'flex-start', marginBottom: 15, paddingVertical: 4 }, backText: { color: '#087f5b', fontSize: 12, fontWeight: '800' }, eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '900' }, subtitle: { marginTop: 5, color: '#718078', fontSize: 12, lineHeight: 18 }, loader: { padding: 24 }, sectionTitle: { marginTop: 20, marginBottom: 9, color: '#26372e', fontSize: 15, fontWeight: '900' }, itemCard: { marginTop: 8, padding: 13, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 14, backgroundColor: '#fff' }, summary: { marginTop: 8, padding: 15, borderRadius: 15, backgroundColor: '#fff' }, number: { color: '#26372e', fontSize: 14, fontWeight: '900' }, status: { color: '#087f5b', fontSize: 10, fontWeight: '900' }, muted: { marginTop: 4, color: '#84918b', fontSize: 11 }, product: { color: '#26372e', fontSize: 12, fontWeight: '800' }, qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#edf1ee' }, diff: { color: '#718078', fontSize: 12, fontWeight: '900' }, diffChanged: { color: '#087f5b' }, primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingHorizontal: 14, borderRadius: 13, backgroundColor: '#087f5b' }, primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' }, secondary: { minHeight: 45, alignItems: 'center', justifyContent: 'center', marginTop: 8, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff' }, secondaryText: { color: '#68766e', fontSize: 12, fontWeight: '800' }, disabled: { opacity: 0.5 }, errorCard: { marginTop: 14, padding: 13, borderRadius: 14, backgroundColor: '#fff1f0' }, errorText: { color: '#a3332a', fontSize: 12 }, retry: { marginTop: 7, color: '#087f5b', fontSize: 12, fontWeight: '900' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, flex: { flex: 1 }, warehouseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, warehouse: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: '#fff' }, warehouseSelected: { backgroundColor: '#e7f5ee' }, warehouseText: { color: '#718078', fontSize: 11, fontWeight: '700' }, warehouseTextSelected: { color: '#087f5b' }, search: { height: 45, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, backgroundColor: '#fff', color: '#172820' }, countInput: { width: 92, height: 42, paddingHorizontal: 8, borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, color: '#172820', textAlign: 'center' }, empty: { alignItems: 'center', marginTop: 15, padding: 22, borderRadius: 15, backgroundColor: '#fff' } });
