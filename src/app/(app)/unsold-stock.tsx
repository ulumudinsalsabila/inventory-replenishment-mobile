import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Print from 'expo-print';
import { ChevronDown, ChevronRight, CircleDollarSign, Download, Layers, Package, Save, Search, SlidersHorizontal, Store } from 'lucide-react-native';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { OptionSheet } from '../../components/option-sheet';
import { money, quantity } from '../../lib/report';

type StockItem = { productId: string; name: string; sku: string; imageUrl: string | null; category: { id: string; name: string }; unit: { code: string; name: string }; costPrice: number; quantity: number; stockValue: number };
type StockGroup = { id: string | null; name: string; quantity: number; stockValue: number; productCount: number };
type StockValue = { summary: { totalQuantity: number; productCount: number; stockValue: number }; byBranch: StockGroup[]; byCategory: StockGroup[]; data: StockItem[]; meta: { page: number; totalPages: number } };
type Option = { id: string; name: string };
type Tab = 'all' | 'branch' | 'category';
type Sort = 'name' | 'quantity' | 'value';

const tabs: { id: Tab; label: string }[] = [{ id: 'all', label: 'Semua' }, { id: 'branch', label: 'Per cabang' }, { id: 'category', label: 'Per kategori' }];
const sortOptions = [{ id: 'name', label: 'Nama produk (A-Z)' }, { id: 'quantity', label: 'Sisa stok terbanyak' }, { id: 'value', label: 'Nilai stok terbesar' }];
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);

export default function UnsoldStockScreen() {
  const { user, accessToken, authorizedRequest } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [tab, setTab] = useState<Tab>('all');
  const [result, setResult] = useState<StockValue | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [branches, setBranches] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [sheet, setSheet] = useState<'branch' | 'category' | 'sort' | null>(null);
  const [exporting, setExporting] = useState(false);

  const buildQuery = useCallback((targetPage: number, perPage: number) => {
    const params = new URLSearchParams({ page: String(targetPage), perPage: String(perPage), sortBy: sort, sortOrder: sort === 'name' ? 'asc' : 'desc' });
    if (search) params.set('search', search);
    if (branchId) params.set('branchId', branchId);
    if (categoryId) params.set('categoryId', categoryId);
    return params.toString();
  }, [branchId, categoryId, search, sort]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    if (!user?.branchId) void authorizedRequest<{ data: Option[] }>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc').then((response) => { if (active) setBranches(response.data); }).catch(() => undefined);
    void authorizedRequest<{ data: Option[] }>('catalog/categories?page=1&perPage=100&sortBy=name&sortOrder=asc').then((response) => { if (active) setCategories(response.data); }).catch(() => undefined);
    return () => { active = false; };
  }, [accessToken, authorizedRequest, user?.branchId]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void authorizedRequest<StockValue>(`reports/stock-value?${buildQuery(1, 50)}`)
      .then((response) => { if (active) { setResult(response); setItems(response.data); setPage(1); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Data stok belum dapat dimuat.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken, authorizedRequest, buildQuery, reloadKey]);

  const loadMore = () => {
    if (loading || loadingMore || tab !== 'all' || !result || page >= result.meta.totalPages) return;
    setLoadingMore(true);
    void authorizedRequest<StockValue>(`reports/stock-value?${buildQuery(page + 1, 50)}`)
      .then((response) => { setItems((current) => [...current, ...response.data]); setPage(page + 1); })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  };

  const exportStock = useCallback(async () => {
    setExporting(true);
    try {
      const rows: StockItem[] = [];
      for (let target = 1; ; target += 1) {
        const response = await authorizedRequest<StockValue>(`reports/stock-value?${buildQuery(target, 100)}`);
        rows.push(...response.data);
        if (target >= response.meta.totalPages) break;
      }
      const total = rows.reduce((sum, row) => sum + row.stockValue, 0);
      const filters = [branches.find((item) => item.id === branchId)?.name ?? 'Semua cabang', categories.find((item) => item.id === categoryId)?.name ?? 'Semua kategori'].join(' · ');
      const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:11px;color:#13233a}h1{font-size:18px;margin:0}p{color:#5f7188}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:6px;border-bottom:1px solid #e1e7ee;text-align:left}th{background:#f2f5f8}.r{text-align:right}</style></head><body><h1>Stok belum terjual</h1><p>${escapeHtml(filters)} · Dicetak ${escapeHtml(new Date().toLocaleString('id-ID'))}</p><table><tr><th>SKU</th><th>Produk</th><th>Kategori</th><th class="r">Sisa stok</th><th class="r">Harga modal</th><th class="r">Nilai stok</th></tr>${rows.map((row) => `<tr><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.category.name)}</td><td class="r">${quantity(row.quantity)} ${escapeHtml(row.unit.code)}</td><td class="r">${money(row.costPrice)}</td><td class="r">${money(row.stockValue)}</td></tr>`).join('')}<tr><th colspan="5">Total</th><th class="r">${money(total)}</th></tr></table></body></html>`;
      await Print.printAsync({ html });
    } catch (cause) {
      Alert.alert('Gagal mengunduh', cause instanceof ApiError ? cause.message : 'Daftar stok belum dapat dicetak.');
    } finally {
      setExporting(false);
    }
  }, [authorizedRequest, branchId, branches, buildQuery, categories, categoryId]);

  const selectGroup = (group: StockGroup) => {
    if (!group.id) return;
    if (tab === 'branch') setBranchId(group.id ?? '');
    else setCategoryId(group.id ?? '');
    setTab('all');
  };

  const header = <View>
    <View style={styles.summaryRow}>
      <View style={[styles.summaryCard, { backgroundColor: '#eefaf4' }]}><View style={[styles.summaryIcon, { backgroundColor: '#d5f3e5' }]}><Save size={20} color="#07956f" /></View><View style={styles.summaryText}><Text style={styles.summaryLabel}>Total item</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.summaryValue}>{quantity(result?.summary.totalQuantity)}</Text><Text style={styles.summaryHint}>dari {quantity(result?.summary.productCount)} produk</Text></View></View>
      <View style={[styles.summaryCard, { backgroundColor: '#fff1f2' }]}><View style={[styles.summaryIcon, { backgroundColor: '#ffdfe2' }]}><CircleDollarSign size={20} color="#d6455a" /></View><View style={styles.summaryText}><Text style={styles.summaryLabel}>Nilai stok</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.summaryValue}>{money(result?.summary.stockValue)}</Text><Text style={styles.summaryHint}>harga modal</Text></View></View>
    </View>
    <View style={styles.searchRow}>
      <View style={styles.searchBox}><Search size={18} color="#71839a" /><TextInput accessibilityLabel="Cari produk atau SKU" value={searchInput} onChangeText={setSearchInput} placeholder="Cari produk atau SKU..." placeholderTextColor="#94a3b4" style={styles.searchInput} returnKeyType="search" /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Urutkan" onPress={() => setSheet('sort')} style={styles.iconButton}><SlidersHorizontal size={19} color="#33465c" /></Pressable>
    </View>
    <View style={styles.filterRow}>
      {!user?.branchId ? <Pressable accessibilityRole="button" onPress={() => setSheet('branch')} style={[styles.filter, branchId ? styles.filterActive : null]}><Text numberOfLines={1} style={styles.filterText}>{branches.find((item) => item.id === branchId)?.name ?? 'Semua cabang'}</Text><ChevronDown size={15} color="#5f7188" /></Pressable> : null}
      <Pressable accessibilityRole="button" onPress={() => setSheet('category')} style={[styles.filter, categoryId ? styles.filterActive : null]}><Text numberOfLines={1} style={styles.filterText}>{categories.find((item) => item.id === categoryId)?.name ?? 'Semua kategori'}</Text><ChevronDown size={15} color="#5f7188" /></Pressable>
    </View>
    <View style={styles.tabs}>{tabs.filter((item) => item.id !== 'branch' || !user?.branchId).map((item) => {
      const active = tab === item.id;
      return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setTab(item.id)} style={[styles.tab, active && styles.tabActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text></Pressable>;
    })}</View>
    {error ? <Pressable accessibilityRole="button" onPress={() => setReloadKey((value) => value + 1)} style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText}>Coba lagi</Text></Pressable> : null}
    {loading ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}
  </View>;

  const groups = tab === 'branch' ? result?.byBranch ?? [] : result?.byCategory ?? [];

  return <>
    <Stack.Screen options={{ headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Unduh daftar stok" disabled={exporting} onPress={() => void exportStock()} style={styles.headerButton}>{exporting ? <ActivityIndicator color="#07956f" /> : <Download size={20} color="#26384d" />}</Pressable> }} />
    {tab === 'all' ? <FlatList
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={loading ? [] : items}
      keyExtractor={(item) => item.productId}
      ListHeaderComponent={header}
      ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>Tidak ada stok yang cocok dengan filter.</Text> : null}
      ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(app)/stock-detail', params: { productId: item.productId } })} style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
        {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.productImage} /> : <View style={[styles.productImage, styles.imageFallback]}><Package size={22} color="#8a9aab" /></View>}
        <View style={styles.productInfo}>
          <Text numberOfLines={2} style={styles.productName}>{item.name}</Text>
          <Text numberOfLines={1} style={styles.productMeta}>{item.sku} · {item.category.name}</Text>
          <Text style={styles.stockLine}>Sisa stok <Text style={styles.stockQty}>{quantity(item.quantity)} {item.unit.code}</Text></Text>
        </View>
        <View style={styles.productRight}>
          <Text numberOfLines={1} style={styles.productValue}>{money(item.stockValue)}</Text>
          <Text style={styles.costLabel}>Modal</Text>
          <Text style={styles.costValue}>{money(item.costPrice)}</Text>
        </View>
        <ChevronRight size={17} color="#8a9aab" />
      </Pressable>}
    /> : <FlatList
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={loading ? [] : groups}
      keyExtractor={(item) => item.id ?? 'none'}
      ListHeaderComponent={header}
      ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>Belum ada stok.</Text> : null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityHint="Tampilkan produk pada kelompok ini" onPress={() => selectGroup(item)} style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
        <View style={[styles.groupIcon, tab === 'branch' ? styles.groupBranch : styles.groupCategory]}>{tab === 'branch' ? <Store size={20} color="#3f6fe0" /> : <Layers size={20} color="#e07d12" />}</View>
        <View style={styles.productInfo}><Text numberOfLines={1} style={styles.productName}>{item.name}</Text><Text style={styles.productMeta}>{quantity(item.productCount)} produk · {quantity(item.quantity)} item</Text></View>
        <View style={styles.productRight}><Text style={styles.productValue}>{money(item.stockValue)}</Text><Text style={styles.costLabel}>Nilai modal</Text></View>
        <ChevronRight size={17} color="#8a9aab" />
      </Pressable>}
    />}

    <OptionSheet visible={sheet === 'branch'} title="Pilih cabang" selectedId={branchId} onSelect={setBranchId} onClose={() => setSheet(null)} options={[{ id: '', label: 'Semua cabang' }, ...branches.map((item) => ({ id: item.id, label: item.name }))]} />
    <OptionSheet visible={sheet === 'category'} title="Pilih kategori" selectedId={categoryId} onSelect={setCategoryId} onClose={() => setSheet(null)} options={[{ id: '', label: 'Semua kategori' }, ...categories.map((item) => ({ id: item.id, label: item.name }))]} />
    <OptionSheet visible={sheet === 'sort'} title="Urutkan" selectedId={sort} onSelect={(value) => setSort(value as Sort)} onClose={() => setSheet(null)} options={sortOptions} />
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f9fb' },
  page: { padding: 16, paddingBottom: 28 },
  headerButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryCard: { flex: 1, minWidth: 0, minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16 },
  summaryIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  summaryText: { flex: 1, minWidth: 0 },
  summaryLabel: { color: '#43566b', fontSize: 11, fontWeight: '600' },
  summaryValue: { marginTop: 3, color: '#13233a', fontSize: 15, fontWeight: '800' },
  summaryHint: { marginTop: 1, color: '#7a899b', fontSize: 11 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  searchBox: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 13, backgroundColor: '#fff' },
  searchInput: { flex: 1, color: '#13233a', fontSize: 14, paddingVertical: 8 },
  iconButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 13, backgroundColor: '#fff' },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  filter: { flex: 1, minWidth: 0, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 12, backgroundColor: '#fff' },
  filterActive: { borderColor: '#9fdcc5', backgroundColor: '#f2fcf7' },
  filterText: { flex: 1, color: '#26384d', fontSize: 12, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 12 },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 12, backgroundColor: '#fff' },
  tabActive: { borderColor: '#07956f', backgroundColor: '#07956f' },
  tabText: { color: '#33465c', fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  errorBox: { marginBottom: 12, padding: 11, borderWidth: 1, borderColor: '#f2c7c4', borderRadius: 12, backgroundColor: '#fff5f4' },
  errorText: { color: '#a83a32', fontSize: 12 },
  retryText: { marginTop: 4, color: '#a83a32', fontSize: 12, fontWeight: '800' },
  loader: { paddingVertical: 18 },
  empty: { paddingVertical: 24, color: '#7a899b', fontSize: 12, textAlign: 'center' },
  productCard: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, padding: 10, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  productImage: { width: 58, height: 58, borderRadius: 10, backgroundColor: '#f1f4f6' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { color: '#13233a', fontSize: 12, fontWeight: '800' },
  productMeta: { marginTop: 3, color: '#7a899b', fontSize: 11 },
  stockLine: { marginTop: 4, color: '#5f7188', fontSize: 11 },
  stockQty: { color: '#07956f', fontWeight: '800' },
  productRight: { alignItems: 'flex-end', maxWidth: 118 },
  productValue: { color: '#13233a', fontSize: 12, fontWeight: '800' },
  costLabel: { marginTop: 4, color: '#7a899b', fontSize: 10 },
  costValue: { color: '#43566b', fontSize: 11, fontWeight: '600' },
  groupIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  groupBranch: { backgroundColor: '#eef4ff' },
  groupCategory: { backgroundColor: '#fff6e9' },
  pressed: { opacity: 0.75 },
});
