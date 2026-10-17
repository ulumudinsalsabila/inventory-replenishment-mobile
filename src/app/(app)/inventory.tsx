import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { useAuth } from '../../auth/auth-provider';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type InventoryRow = {
  id: string;
  onHand: string;
  reserved: string;
  minimumStock: string;
  reorderPoint: string;
  updatedAt: string;
  product: { id: string; sku: string; name: string; unit: { code: string } };
  warehouse: { id: string; code: string; name: string };
};

function quantity(value: string | number) {
  return Number(value).toLocaleString('id-ID', { maximumFractionDigits: 3 });
}

export default function InventoryScreen() {
  const { authorizedRequest } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const list = useInfiniteList<InventoryRow>(authorizedRequest, `inventory?${params.toString()}`);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);
  const rows = list.items;

  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView {...scrollProps} bottomOffset={24} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor="#087f5b" />}>
        <Text style={styles.subtitle}>{list.total.toLocaleString('id-ID')} item · tarik ke bawah untuk memperbarui</Text>

        <View style={styles.searchField}>
          <Search size={17} color="#71839a" />
          <TextInput accessibilityLabel="Cari produk atau SKU" autoCapitalize="none" autoCorrect={false} returnKeyType="search" placeholder="Cari produk atau SKU" placeholderTextColor="#8a968f" value={searchInput} onChangeText={setSearchInput} style={styles.searchInput} />
          {searchInput ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" hitSlop={8} onPress={() => setSearchInput('')}><X size={16} color="#71839a" /></Pressable> : null}
        </View>

        {list.error && !rows.length ? <View style={styles.errorCard}><Text style={styles.errorText}>{list.error}</Text><Pressable accessibilityRole="button" onPress={() => void list.reload()}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
        {list.loading && rows.length === 0 ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : null}
        {!list.loading && !list.error && rows.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Stok tidak ditemukan</Text><Text style={styles.emptyText}>Coba kata pencarian lain.</Text></View> : null}

        {rows.map((row) => {
          const available = Number(row.onHand) - Number(row.reserved);
          const low = available <= Number(row.reorderPoint);
          return (
            <View key={row.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.productInfo}>
                  <Text numberOfLines={2} style={styles.productName}>{row.product.name}</Text>
                  <Text style={styles.sku}>{row.product.sku} · {row.warehouse.name}</Text>
                </View>
                {low ? <Text style={styles.lowBadge}>RENDAH</Text> : null}
              </View>
              <View style={styles.stockLine}>
                <View><Text style={styles.stockLabel}>Tersedia</Text><Text style={[styles.stockValue, low && styles.stockLow]}>{quantity(available)} <Text style={styles.unit}>{row.product.unit.code}</Text></Text></View>
                <View style={styles.stockRight}><Text style={styles.stockLabel}>Dipesan  {quantity(row.reserved)}</Text><Text style={styles.minimum}>Reorder point  {quantity(row.reorderPoint)}</Text></View>
              </View>
            </View>
          );
        })}

        <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={rows.length} error={list.error} onRetry={list.loadMore} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f6' },
  page: { padding: 20, paddingTop: 18, paddingBottom: 32 },
  back: { alignSelf: 'flex-start', marginBottom: 20, paddingVertical: 4 },
  backText: { color: '#087f5b', fontSize: 12, fontWeight: '800' },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '800' },
  subtitle: { marginTop: 5, color: '#718078', fontSize: 12 },
  searchField: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 15, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 14, backgroundColor: '#fff' },
  searchInput: { flex: 1, minWidth: 0, height: 46, color: '#172820', fontSize: 14 },
  card: { marginBottom: 10, padding: 15, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 17, backgroundColor: '#fff' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { color: '#26372e', fontSize: 14, fontWeight: '800', lineHeight: 19 },
  sku: { marginTop: 5, color: '#89958e', fontSize: 11 },
  lowBadge: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#fff2d8', color: '#a86200', fontSize: 9, fontWeight: '900' },
  stockLine: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 15, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#edf1ee' },
  stockLabel: { color: '#84918b', fontSize: 10, fontWeight: '700' },
  stockValue: { marginTop: 3, color: '#087f5b', fontSize: 15, fontWeight: '900' },
  stockLow: { color: '#b86d00' },
  unit: { color: '#819087', fontSize: 12, fontWeight: '700' },
  stockRight: { alignItems: 'flex-end' },
  minimum: { marginTop: 6, color: '#84918b', fontSize: 10 },
  errorCard: { padding: 15, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 15, backgroundColor: '#fff6f5' },
  errorText: { color: '#a3332a', fontSize: 12, lineHeight: 18 },
  retry: { marginTop: 8, color: '#087f5b', fontSize: 12, fontWeight: '800' },
  loader: { padding: 24 },
  empty: { alignItems: 'center', padding: 24, borderRadius: 16, backgroundColor: '#fff' },
  emptyTitle: { color: '#28372f', fontSize: 14, fontWeight: '800' },
  emptyText: { marginTop: 5, color: '#819087', fontSize: 12 },
});
