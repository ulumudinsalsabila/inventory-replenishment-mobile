import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Search, X } from 'lucide-react-native';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { useAuth } from '../../auth/auth-provider';
import { formatDate, formatMovementType } from '../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
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

const quantity = (value: string | number) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 3 });
// Direction comes from the stock itself: adjustments and opnames go either way, and the stored quantity is already signed.
const stockChange = (row: Pick<Movement, 'beforeStock' | 'afterStock'>) => Number(row.afterStock) - Number(row.beforeStock);

export default function StockMovementsScreen() {
  const { user, authorizedRequest } = useAuth();
  const canRead = user?.permissions.includes('inventory.read') ?? false;
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const params = new URLSearchParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  if (search) params.set('search', search);
  const list = useInfiniteList<Movement>(authorizedRequest, canRead ? `stock-movements?${params.toString()}` : null);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);
  const rows = list.items;

  return <KeyboardAwareScrollView {...scrollProps} bottomOffset={24} style={styles.screen} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor="#07885b" />}>
    {canRead ? <>
      <View style={styles.searchBox}><Search size={17} color="#71839a" /><TextInput accessibilityLabel="Cari pergerakan stok" autoCapitalize="none" autoCorrect={false} value={searchInput} onChangeText={setSearchInput} placeholder="Cari produk atau referensi" placeholderTextColor="#8b99a8" style={styles.searchInput} returnKeyType="search" />{searchInput ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" hitSlop={8} onPress={() => setSearchInput('')}><X size={16} color="#71839a" /></Pressable> : null}</View>
      {list.error && !rows.length ? <Pressable accessibilityRole="button" onPress={() => void list.reload()} style={styles.error}><Text style={styles.errorText}>{list.error}</Text><Text style={styles.retry}>Coba lagi</Text></Pressable> : null}
      {list.loading && !rows.length ? <ActivityIndicator style={styles.loader} color="#07885b" /> : null}
      {!list.loading && !list.error && !rows.length ? <View style={styles.empty}><ArrowLeftRight size={22} color="#8091a4" /><Text style={styles.emptyTitle}>{search ? 'Pergerakan stok tidak ditemukan' : 'Belum ada pergerakan stok'}</Text><Text style={styles.emptyText}>{search ? 'Coba kata pencarian lain.' : 'Perubahan stok akan tercatat di sini.'}</Text></View> : null}
      {rows.map((row) => {
        const change = stockChange(row);
        const inbound = change > 0;
        const outbound = change < 0;
        const Icon = inbound ? ArrowDownLeft : outbound ? ArrowUpRight : ArrowLeftRight;
        const tint = inbound ? '#07885b' : outbound ? '#c23a36' : '#54758c';
        const sign = inbound ? '+' : outbound ? '−' : '';
        return <View key={row.id} style={styles.row}>
          <View style={[styles.typeIcon, { backgroundColor: inbound ? '#e3f7ee' : outbound ? '#fff0ee' : '#edf3f6' }]}><Icon size={19} color={tint} /></View>
          <View style={styles.rowBody}><View style={styles.rowHeader}><Text numberOfLines={1} style={styles.productName}>{row.product.name}</Text><Text style={[styles.delta, { color: tint }]}>{sign}{quantity(Math.abs(change))}</Text></View><Text style={styles.productSku}>{row.product.sku} · {formatMovementType(row.type)}</Text><Text numberOfLines={1} style={styles.meta}>{row.warehouse.name} · {formatDate(row.createdAt)}</Text>{row.note ? <Text numberOfLines={1} style={styles.note}>{row.note}</Text> : null}<Text numberOfLines={1} style={styles.stockLine}>Stok {quantity(row.beforeStock)} → {quantity(row.afterStock)}{row.referenceNumber ? ` · ${row.referenceNumber}` : ''}</Text></View>
        </View>;
      })}
      <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={rows.length} error={list.error} onRetry={list.loadMore} />
    </> : <View style={styles.empty}><Text style={styles.emptyTitle}>Akses tidak tersedia</Text><Text style={styles.emptyText}>Akun ini belum memiliki izin melihat stok.</Text></View>}
  </KeyboardAwareScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' }, page: { padding: 16, paddingTop: 12, paddingBottom: 26 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 }, backText: { color: '#07885b', fontSize: 11, fontWeight: '800' }, eyebrow: { color: '#07885b', fontSize: 9, fontWeight: '900' }, title: { marginTop: 5, marginBottom: 14, color: '#172338', fontSize: 25, fontWeight: '900' },
  searchBox: { height: 43, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e2e9ed', borderRadius: 11, backgroundColor: '#fff' }, searchInput: { flex: 1, color: '#172338', fontSize: 10 }, error: { padding: 10, borderRadius: 9, backgroundColor: '#fff1ef' }, errorText: { color: '#a3332a', fontSize: 10 }, retry: { marginTop: 5, color: '#07885b', fontSize: 10, fontWeight: '800' }, loader: { padding: 20 },
  empty: { alignItems: 'center', gap: 7, marginTop: 22, padding: 20, borderWidth: 1, borderColor: '#e5ecef', borderRadius: 13, backgroundColor: '#fff' }, emptyTitle: { color: '#26384a', fontSize: 12, fontWeight: '900' }, emptyText: { color: '#7a8a9b', fontSize: 10, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8, padding: 11, borderWidth: 1, borderColor: '#e8eef1', borderRadius: 12, backgroundColor: '#fff' }, typeIcon: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, rowBody: { flex: 1, minWidth: 0 }, rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, productName: { flex: 1, color: '#25364a', fontSize: 10, fontWeight: '900' }, delta: { fontSize: 10, fontWeight: '900' }, productSku: { marginTop: 4, color: '#536b80', fontSize: 9, fontWeight: '700' }, meta: { marginTop: 4, color: '#7b8b9b', fontSize: 9 }, note: { marginTop: 3, color: '#64798c', fontSize: 9 }, stockLine: { marginTop: 5, color: '#596f82', fontSize: 9, fontWeight: '700' },
});
