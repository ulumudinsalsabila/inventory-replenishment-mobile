import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronLeft, Search } from 'lucide-react-native';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatDate, formatStatus } from '../../lib/display';

type Movement = {
  id: string;
  type: string;
  quantity: string | number;
  beforeStock: string | number;
  afterStock: string | number;
  createdAt: string;
  note?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceNumber?: string | null;
  product: { id: string; sku: string; name: string };
  warehouse: { id: string; code: string; name: string };
};
type Page = { data: Movement[]; meta: { page: number; totalPages: number; total: number } };

const quantity = (value: string | number) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 3 });
const isInbound = (type: string) => ['PURCHASE_IN', 'TRANSFER_IN', 'RETURN_IN', 'ADJUSTMENT_IN', 'OPNAME_IN'].includes(type);
const isOutbound = (type: string) => ['SALE', 'TRANSFER_OUT', 'PURCHASE_RETURN', 'ADJUSTMENT_OUT', 'OPNAME_OUT'].includes(type);

export default function StockMovementsScreen() {
  const { user, authorizedRequest } = useAuth();
  const canRead = user?.permissions.includes('inventory.read') ?? false;
  const [rows, setRows] = useState<Movement[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(canRead);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    let active = true;
    const params = new URLSearchParams({ page: '1', perPage: '20', sortBy: 'createdAt', sortOrder: 'desc' });
    if (search) params.set('search', search);
    void authorizedRequest<Page>(`stock-movements?${params.toString()}`)
      .then((result) => { if (active) { setRows(result.data); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Pergerakan stok belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [authorizedRequest, canRead, reload, search]);

  return <ScrollView style={styles.screen} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReload((value) => value + 1); }} tintColor="#07885b" />}>
    {canRead ? <>
      <View style={styles.searchRow}><View style={styles.searchBox}><Search size={17} color="#71839a" /><TextInput accessibilityLabel="Cari pergerakan stok" value={searchInput} onChangeText={setSearchInput} onSubmitEditing={() => setSearch(searchInput.trim())} placeholder="Cari produk atau referensi" placeholderTextColor="#8b99a8" style={styles.searchInput} returnKeyType="search" /></View><Pressable accessibilityRole="button" accessibilityLabel="Cari" onPress={() => setSearch(searchInput.trim())} style={styles.searchButton}><Search size={18} color="#fff" /></Pressable></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : null}
      {!loading && !rows.length ? <View style={styles.empty}><ArrowLeftRight size={22} color="#8091a4" /><Text style={styles.emptyTitle}>Belum ada pergerakan stok</Text><Text style={styles.emptyText}>Perubahan stok akan tercatat di sini.</Text></View> : null}
      {rows.map((row) => {
        const inbound = isInbound(row.type);
        const outbound = isOutbound(row.type);
        const Icon = inbound ? ArrowDownLeft : outbound ? ArrowUpRight : ArrowLeftRight;
        const tint = inbound ? '#07885b' : outbound ? '#c23a36' : '#54758c';
        const sign = inbound ? '+' : outbound ? '−' : '';
        return <View key={row.id} style={styles.row}>
          <View style={[styles.typeIcon, { backgroundColor: inbound ? '#e3f7ee' : outbound ? '#fff0ee' : '#edf3f6' }]}><Icon size={19} color={tint} /></View>
          <View style={styles.rowBody}><View style={styles.rowHeader}><Text numberOfLines={1} style={styles.productName}>{row.product.name}</Text><Text style={[styles.delta, { color: tint }]}>{sign}{quantity(row.quantity)}</Text></View><Text style={styles.productSku}>{row.product.sku} · {formatStatus(row.type)}</Text><Text numberOfLines={1} style={styles.meta}>{row.warehouse.name} · {formatDate(row.createdAt)}</Text>{row.note ? <Text numberOfLines={1} style={styles.note}>{row.note}</Text> : null}<Text numberOfLines={1} style={styles.stockLine}>Stok {quantity(row.beforeStock)} → {quantity(row.afterStock)}{row.referenceNumber ? ` · ${row.referenceNumber}` : ''}</Text></View>
        </View>;
      })}
    </> : <View style={styles.empty}><Text style={styles.emptyTitle}>Akses tidak tersedia</Text><Text style={styles.emptyText}>Akun ini belum memiliki izin melihat stok.</Text></View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' }, page: { padding: 16, paddingTop: 12, paddingBottom: 26 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 }, backText: { color: '#07885b', fontSize: 11, fontWeight: '800' }, eyebrow: { color: '#07885b', fontSize: 9, fontWeight: '900' }, title: { marginTop: 5, marginBottom: 14, color: '#172338', fontSize: 25, fontWeight: '900' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 }, searchBox: { height: 43, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e2e9ed', borderRadius: 11, backgroundColor: '#fff' }, searchInput: { flex: 1, color: '#172338', fontSize: 10 }, searchButton: { width: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#07885b' }, error: { padding: 10, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10 }, loader: { padding: 20 },
  empty: { alignItems: 'center', gap: 7, marginTop: 22, padding: 20, borderWidth: 1, borderColor: '#e5ecef', borderRadius: 13, backgroundColor: '#fff' }, emptyTitle: { color: '#26384a', fontSize: 12, fontWeight: '900' }, emptyText: { color: '#7a8a9b', fontSize: 10, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8, padding: 11, borderWidth: 1, borderColor: '#e8eef1', borderRadius: 12, backgroundColor: '#fff' }, typeIcon: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, rowBody: { flex: 1, minWidth: 0 }, rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, productName: { flex: 1, color: '#25364a', fontSize: 10, fontWeight: '900' }, delta: { fontSize: 10, fontWeight: '900' }, productSku: { marginTop: 4, color: '#536b80', fontSize: 9, fontWeight: '700' }, meta: { marginTop: 4, color: '#7b8b9b', fontSize: 9 }, note: { marginTop: 3, color: '#64798c', fontSize: 9 }, stockLine: { marginTop: 5, color: '#596f82', fontSize: 9, fontWeight: '700' },
});