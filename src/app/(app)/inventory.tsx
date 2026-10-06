import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { BarcodeScanner } from '../../components/barcode-scanner';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';

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
type InventoryResult = { data: InventoryRow[]; meta: { page: number; total: number; totalPages: number } };

function quantity(value: string | number) {
  return Number(value).toLocaleString('id-ID', { maximumFractionDigits: 3 });
}

export default function InventoryScreen() {
  const { authorizedRequest } = useAuth();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [scannerVisible, setScannerVisible] = useState(false);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), perPage: '20' });
    if (search) params.set('search', search);
    void authorizedRequest<InventoryResult>(`inventory?${params.toString()}`)
      .then((result) => {
        if (!active) return;
        setRows(result.data);
        setTotal(result.meta.total);
        setTotalPages(Math.max(1, result.meta.totalPages));
        setError('');
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof ApiError ? cause.message : 'Data stok belum dapat dimuat.');
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => { active = false; };
  }, [authorizedRequest, page, reloadKey, search]);

  const runSearch = () => { setPage(1); setSearch(searchInput.trim()); };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((key) => key + 1); }} tintColor="#087f5b" />}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹  Operasional</Text></Pressable>
        <Text style={styles.eyebrow}>PERSEDIAAN</Text>
        <Text style={styles.title}>Cek stok</Text>
        <Text style={styles.subtitle}>{total.toLocaleString('id-ID')} item · tarik ke bawah untuk memperbarui</Text>

        <View style={styles.searchRow}>
          <TextInput accessibilityLabel="Cari produk atau SKU" autoCapitalize="none" returnKeyType="search" onSubmitEditing={runSearch} placeholder="Cari produk atau SKU" placeholderTextColor="#8a968f" value={searchInput} onChangeText={setSearchInput} style={styles.searchInput} />
          <Pressable accessibilityRole="button" accessibilityLabel="Scan barcode" onPress={() => setScannerVisible(true)} style={styles.scanButton}><Text style={styles.searchButtonText}>Scan</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={runSearch} style={styles.searchButton}><Text style={styles.searchButtonText}>Cari</Text></Pressable>
        </View>

        {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { setLoading(true); setReloadKey((key) => key + 1); }}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
        {loading && rows.length === 0 ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : null}
        {!loading && !error && rows.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Stok tidak ditemukan</Text><Text style={styles.emptyText}>Coba kata pencarian lain.</Text></View> : null}

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

        {rows.length > 0 ? <View style={styles.pagination}><Pressable accessibilityRole="button" disabled={page <= 1} onPress={() => setPage((current) => current - 1)} style={[styles.pageButton, page <= 1 && styles.disabled]}><Text style={styles.pageButtonText}>‹ Sebelumnya</Text></Pressable><Text style={styles.pageLabel}>{page} / {totalPages}</Text><Pressable accessibilityRole="button" disabled={page >= totalPages} onPress={() => setPage((current) => current + 1)} style={[styles.pageButton, page >= totalPages && styles.disabled]}><Text style={styles.pageButtonText}>Berikutnya ›</Text></Pressable></View> : null}
      </ScrollView>
      <BarcodeScanner visible={scannerVisible} onClose={() => setScannerVisible(false)} onScanned={(value) => { setScannerVisible(false); setSearchInput(value); setPage(1); setSearch(value); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f6' },
  page: { padding: 20, paddingTop: 18, paddingBottom: 32 },
  back: { alignSelf: 'flex-start', marginBottom: 20, paddingVertical: 4 },
  backText: { color: '#087f5b', fontSize: 13, fontWeight: '800' },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 6, color: '#172820', fontSize: 26, fontWeight: '800' },
  subtitle: { marginTop: 5, color: '#718078', fontSize: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 20, marginBottom: 15 },
  searchInput: { height: 48, flex: 1, paddingHorizontal: 14, borderWidth: 1, borderColor: '#dce4df', borderRadius: 14, backgroundColor: '#fff', color: '#172820', fontSize: 14 },
  searchButton: { minWidth: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#087f5b' },
  scanButton: { minWidth: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#34574a' },
  searchButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  card: { marginBottom: 10, padding: 15, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 17, backgroundColor: '#fff' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { color: '#26372e', fontSize: 14, fontWeight: '800', lineHeight: 19 },
  sku: { marginTop: 5, color: '#89958e', fontSize: 11 },
  lowBadge: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#fff2d8', color: '#a86200', fontSize: 9, fontWeight: '900' },
  stockLine: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 15, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#edf1ee' },
  stockLabel: { color: '#84918b', fontSize: 10, fontWeight: '700' },
  stockValue: { marginTop: 3, color: '#087f5b', fontSize: 20, fontWeight: '900' },
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
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  pageButton: { paddingHorizontal: 11, paddingVertical: 10, borderRadius: 11, backgroundColor: '#e7f5ee' },
  pageButtonText: { color: '#087f5b', fontSize: 11, fontWeight: '800' },
  pageLabel: { color: '#68766e', fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
