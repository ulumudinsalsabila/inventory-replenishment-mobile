import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, Boxes, ChevronRight, Coins, House, Package, X } from 'lucide-react-native';
import { useAuth } from '../../auth/auth-provider';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { ApiError } from '../../lib/api';
import { useOnRefocus } from '../../lib/use-refocus';
import { formatMovementType } from '../../lib/display';
import { useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { money, quantity } from '../../lib/report';
import { PreviewImage } from '../../components/image-viewer';

type Detail = {
  product: { id: string; name: string; sku: string; imageUrl: string | null; category: { name: string }; unit: { code: string; name: string }; costPrice: number; sellPrice: number };
  quantity: number;
  stockValue: number;
  warehouses: { warehouseId: string; warehouseName: string; branchId: string | null; branchName: string | null; quantity: number; stockValue: number }[];
};
type Movement = { id: string; type: string; quantity: string | number; beforeStock: string | number; afterStock: string | number; createdAt: string; referenceNumber?: string | null; warehouse: { name: string } };
type Tab = 'branch' | 'history';

const houseTones = [{ bg: '#ffeceb', fg: '#d6455a' }, { bg: '#e7f8ef', fg: '#07956f' }, { bg: '#eaf0ff', fg: '#3f6fe0' }, { bg: '#fff3e3', fg: '#e07d12' }, { bg: '#f1ebff', fg: '#7c4fe0' }];
const dateTime = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

export default function StockDetailScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { user, accessToken, authorizedRequest } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>('branch');
  const [warehouseId, setWarehouseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useOnRefocus(() => setReloadKey((value) => value + 1));
  const canReadMovements = user?.permissions.includes('inventory.read') ?? false;

  useEffect(() => {
    if (!accessToken || !productId) return;
    let active = true;
    void authorizedRequest<Detail>(`reports/stock-value/${encodeURIComponent(productId)}`)
      .then((response) => { if (active) { setDetail(response); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Detail stok belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [accessToken, authorizedRequest, productId, reloadKey]);

  const historyParams = new URLSearchParams({ productId: productId ?? '' });
  if (warehouseId) historyParams.set('warehouseId', warehouseId);
  const history = useInfiniteList<Movement>(authorizedRequest, accessToken && productId && tab === 'history' && canReadMovements ? `stock-movements?${historyParams.toString()}` : null);
  const scrollProps = useLoadMoreOnScroll(history.loadMore);
  const movements = history.items;

  if (loading && !detail) return <View style={styles.center}><ActivityIndicator color="#07956f" /></View>;
  if (!detail) return <View style={styles.center}><Text style={styles.errorText}>{error || 'Produk tidak ditemukan.'}</Text><Pressable accessibilityRole="button" onPress={() => { setLoading(true); setReloadKey((value) => value + 1); }}><Text style={styles.retryText}>Coba lagi</Text></Pressable></View>;

  const { product } = detail;
  const branchCounts = detail.warehouses.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.branchId ?? '']: (counts[row.branchId ?? ''] ?? 0) + 1 }), {});
  const locationName = (row: Detail['warehouses'][number]) => !row.branchName ? row.warehouseName : branchCounts[row.branchId ?? ''] > 1 ? `${row.branchName} · ${row.warehouseName}` : row.branchName;
  const selectedWarehouse = detail.warehouses.find((row) => row.warehouseId === warehouseId);

  return <ScrollView {...scrollProps} style={styles.screen} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((value) => value + 1); if (tab === 'history') void history.refresh(); }} tintColor="#07956f" />}>
    <View style={styles.card}>
      <View style={styles.productRow}>
        {product.imageUrl ? <PreviewImage uri={product.imageUrl} accessibilityLabel={product.name} style={styles.image} /> : <View style={[styles.image, styles.imageFallback]}><Package size={28} color="#8a9aab" /></View>}
        <View style={styles.productInfo}><Text style={styles.productName}>{product.name}</Text><Text style={styles.productMeta}>{product.sku} · {product.category.name}</Text></View>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.stat}><View style={[styles.statIcon, { backgroundColor: '#e7f8ef' }]}><Boxes size={19} color="#07956f" /></View><View style={styles.statText}><Text style={styles.statLabel}>Sisa stok</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{quantity(detail.quantity)} {product.unit.code}</Text></View></View>
        <View style={styles.divider} />
        <View style={styles.stat}><View style={[styles.statIcon, { backgroundColor: '#fff3e3' }]}><Coins size={19} color="#e07d12" /></View><View style={styles.statText}><Text style={styles.statLabel}>Nilai modal</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{money(detail.stockValue)}</Text></View></View>
      </View>
    </View>

    <View style={styles.tabs}>
      {([['branch', 'Per cabang'], ['history', 'Riwayat pergerakan']] as const).map(([id, label]) => {
        const active = tab === id;
        return <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setTab(id)} style={[styles.tab, active && styles.tabActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>;
      })}
    </View>

    {tab === 'branch' ? <>
      {!detail.warehouses.length ? <Text style={styles.empty}>Produk ini belum memiliki stok di gudang mana pun.</Text> : null}
      {detail.warehouses.map((row, index) => {
        const tone = houseTones[index % houseTones.length];
        return <Pressable key={row.warehouseId} accessibilityRole="button" accessibilityHint="Lihat riwayat pergerakan di lokasi ini" onPress={() => { setWarehouseId(row.warehouseId); setTab('history'); }} style={({ pressed }) => [styles.locationCard, pressed && styles.pressed]}>
          <View style={[styles.locationIcon, { backgroundColor: tone.bg }]}><House size={20} color={tone.fg} /></View>
          <View style={styles.locationInfo}><Text numberOfLines={1} style={styles.locationName}>{locationName(row)}</Text><Text style={styles.locationQty}>{quantity(row.quantity)} {product.unit.code}</Text></View>
          <Text style={styles.locationValue}>{money(row.stockValue)}</Text>
          <ChevronRight size={17} color="#8a9aab" />
        </Pressable>;
      })}
    </> : <>
      {selectedWarehouse ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus filter lokasi" onPress={() => setWarehouseId('')} style={styles.chip}><Text style={styles.chipText}>{locationName(selectedWarehouse)}</Text><X size={14} color="#07795a" /></Pressable> : null}
      {!canReadMovements ? <Text style={styles.empty}>Akun ini belum memiliki izin melihat pergerakan stok.</Text> : null}
      {history.error && !movements.length ? <Pressable accessibilityRole="button" onPress={() => void history.reload()}><Text style={styles.errorText}>{history.error}</Text><Text style={[styles.retryText, styles.retryCenter]}>Coba lagi</Text></Pressable> : null}
      {history.loading ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}
      {canReadMovements && !history.loading && !history.error && !movements.length ? <Text style={styles.empty}>Belum ada pergerakan stok.</Text> : null}
      {!history.loading ? movements.map((row) => {
        const delta = Number(row.afterStock) - Number(row.beforeStock);
        const inbound = delta >= 0;
        return <View key={row.id} style={styles.movementCard}>
          <View style={[styles.movementIcon, { backgroundColor: inbound ? '#e7f8ef' : '#ffeceb' }]}>{inbound ? <ArrowDownLeft size={18} color="#07956f" /> : <ArrowUpRight size={18} color="#d6455a" />}</View>
          <View style={styles.locationInfo}>
            <Text style={styles.locationName}>{formatMovementType(row.type)}</Text>
            <Text numberOfLines={1} style={styles.movementMeta}>{row.warehouse.name}{row.referenceNumber ? ` · ${row.referenceNumber}` : ''}</Text>
            <Text style={styles.movementMeta}>{dateTime.format(new Date(row.createdAt))}</Text>
          </View>
          <View style={styles.movementRight}>
            <Text style={[styles.movementQty, { color: inbound ? '#07956f' : '#d23b35' }]}>{inbound ? '+' : '−'}{quantity(Math.abs(delta))}</Text>
            <Text style={styles.movementMeta}>Sisa {quantity(row.afterStock)}</Text>
          </View>
        </View>;
      }) : null}
      {!history.loading ? <LoadMoreFooter loadingMore={history.loadingMore} hasMore={history.hasMore} count={movements.length} error={history.error} onRetry={history.loadMore} /> : null}
    </>}

    <View style={[styles.card, styles.infoCard]}>
      <Text style={styles.infoTitle}>Informasi produk</Text>
      {[['Kategori', product.category.name], ['Satuan', product.unit.code], ['Harga modal', money(product.costPrice)], ['Harga jual', money(product.sellPrice)]].map(([label, value]) => <View key={label} style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>)}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f9fb' },
  page: { padding: 16, paddingBottom: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, backgroundColor: '#f7f9fb' },
  card: { padding: 14, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  image: { width: 74, height: 74, borderRadius: 12, backgroundColor: '#f1f4f6' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { color: '#13233a', fontSize: 15, fontWeight: '800' },
  productMeta: { marginTop: 4, color: '#7a899b', fontSize: 12 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eef2f5' },
  stat: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  divider: { width: 1, alignSelf: 'stretch', marginHorizontal: 10, backgroundColor: '#eef2f5' },
  statIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  statText: { flex: 1, minWidth: 0 },
  statLabel: { color: '#7a899b', fontSize: 11 },
  statValue: { marginTop: 2, color: '#13233a', fontSize: 15, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 12 },
  tab: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 12 },
  tabActive: { backgroundColor: '#07956f' },
  tabText: { color: '#43566b', fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  locationCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 8, padding: 12, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  locationIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  locationInfo: { flex: 1, minWidth: 0 },
  locationName: { color: '#13233a', fontSize: 12, fontWeight: '800' },
  locationQty: { marginTop: 3, color: '#13233a', fontSize: 15, fontWeight: '800' },
  locationValue: { color: '#26384d', fontSize: 12, fontWeight: '700' },
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16, backgroundColor: '#d9f4e8' },
  chipText: { color: '#07795a', fontSize: 12, fontWeight: '800' },
  movementCard: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 8, padding: 12, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  movementIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  movementMeta: { marginTop: 2, color: '#7a899b', fontSize: 11 },
  movementRight: { alignItems: 'flex-end' },
  movementQty: { fontSize: 15, fontWeight: '800' },
  infoCard: { marginTop: 8 },
  infoTitle: { marginBottom: 6, color: '#13233a', fontSize: 14, fontWeight: '800' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f0f3f6' },
  infoLabel: { color: '#6d7d90', fontSize: 12 },
  infoValue: { color: '#13233a', fontSize: 12, fontWeight: '700' },
  empty: { paddingVertical: 20, color: '#7a899b', fontSize: 12, textAlign: 'center' },
  loader: { paddingVertical: 18 },
  errorText: { color: '#a83a32', fontSize: 12, textAlign: 'center' },
  retryText: { color: '#07956f', fontSize: 12, fontWeight: '800' },
  retryCenter: { marginTop: 6, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
