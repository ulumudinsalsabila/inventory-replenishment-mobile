import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../../auth/auth-provider';
import { ApiError } from '../../../lib/api';

type Dashboard = {
  date: string;
  salesToday: string;
  orderCountToday: number;
  lowStockCount: number;
  pendingRequestCount: number;
  incomingTransferCount: number;
  lowStock: { product?: { id: string; name: string; sku: string }; warehouse?: { name: string }; onHand: string; reorderPoint: string }[];
};

const money = (amount: string | number) => `Rp ${Number(amount).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

export default function DashboardScreen() {
  const { user, accessToken, authorizedRequest } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const canReadReports = user?.permissions.includes('report.read') ?? false;
  const canCreateStockRequest = user?.permissions.includes('stock_request.create') ?? false;
  const canReviewStockRequest = user?.permissions.includes('stock_request.review') ?? false;

  useEffect(() => {
    if (!accessToken || !canReadReports) return;
    let active = true;
    void authorizedRequest<Dashboard>('dashboard')
      .then((result) => { if (active) setData(result); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof ApiError ? cause.message : 'Ringkasan belum dapat dimuat.');
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => { active = false; };
  }, [accessToken, authorizedRequest, canReadReports, reloadKey]);

  const metrics = [
    { label: 'Penjualan hari ini', value: data ? money(data.salesToday) : '—', color: '#e7f5ee' },
    { label: 'Pesanan hari ini', value: data?.orderCountToday ?? '—', color: '#e9f2ff' },
    { label: 'Stok rendah', value: data?.lowStockCount ?? '—', color: '#fff4dc' },
    { label: 'Transfer masuk', value: data?.incomingTransferCount ?? '—', color: '#f0eaff' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setError(''); setRefreshing(true); setReloadKey((current) => current + 1); }} tintColor="#087f5b" />}>
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>RINGKASAN OPERASIONAL</Text><Text style={styles.title}>Halo, {user?.name.split(' ')[0] ?? 'Tim'} 👋</Text><Text style={styles.subtitle}>{user?.roles.join(' · ')}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Buka profil akun" onPress={() => router.push('/(app)/(tabs)/account')} style={({ pressed }) => [styles.avatar, pressed && styles.avatarPressed]}><Text style={styles.avatarText}>{user?.name.slice(0, 1).toUpperCase() ?? 'U'}</Text></Pressable>
      </View>
      {canCreateStockRequest || canReviewStockRequest ? <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/stock-requests')} style={({ pressed }) => [styles.requestCard, pressed && styles.requestCardPressed]}>
        <View style={styles.requestIcon}><Text style={styles.requestIconText}>{canReviewStockRequest ? '✓' : '＋'}</Text></View>
        <View style={styles.requestContent}>
          <Text style={styles.requestTitle}>{canReviewStockRequest ? 'Permintaan stok masuk' : 'Ajukan permintaan stok'}</Text>
          <Text style={styles.requestDescription}>{canReviewStockRequest ? `${data?.pendingRequestCount ?? 0} permintaan menunggu ditinjau` : 'Ajukan kebutuhan stok untuk cabang Anda'}</Text>
        </View>
        <Text style={styles.requestAction}>{canReviewStockRequest ? 'Tinjau ›' : 'Buat ›'}</Text>
      </Pressable> : null}
      {canReadReports ? <>
        <View style={styles.metrics}>{metrics.map((item) => <View key={item.label} style={[styles.metricCard, { backgroundColor: item.color }]}><Text style={styles.metricLabel}>{item.label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>{loading ? '…' : item.value}</Text></View>)}</View>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Perlu perhatian</Text><Text style={styles.sectionHint}>{data?.pendingRequestCount ?? 0} permintaan menunggu</Text></View>
        {error ? <Pressable onPress={() => { setError(''); setLoading(true); setReloadKey((current) => current + 1); }} style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Text style={styles.retry}>Coba lagi</Text></Pressable> : null}
        {loading && !data ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : null}
        {!loading && data?.lowStock.length === 0 ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Stok aman</Text><Text style={styles.emptyText}>Tidak ada produk di bawah batas stok minimum.</Text></View> : null}
        {(data?.lowStock ?? []).map((row) => <View key={`${row.product?.id}-${row.warehouse?.name}`} style={styles.stockRow}><View style={styles.stockIcon}><Text style={styles.stockIconText}>!</Text></View><View style={styles.stockInfo}><Text numberOfLines={1} style={styles.stockName}>{row.product?.name ?? 'Produk'}</Text><Text style={styles.stockMeta}>{row.product?.sku ?? '—'} · {row.warehouse?.name ?? 'Gudang'}</Text></View><Text style={styles.stockCount}>{row.onHand}<Text style={styles.stockUnit}> / {row.reorderPoint}</Text></Text></View>)}
      </> : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Selamat datang</Text><Text style={styles.emptyText}>Ringkasan akan tampil jika akun memiliki akses laporan.</Text></View>}
      <Text style={styles.dateLabel}>{data?.date ? `Data per ${new Date(`${data.date}T00:00:00`).toLocaleDateString('id-ID', { dateStyle: 'long' })}` : 'Inventory Replenishment Mobile'}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 20, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 7, color: '#172820', fontSize: 25, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { marginTop: 5, color: '#718078', fontSize: 12, fontWeight: '600' },
  avatar: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#dff3e9' },
  avatarPressed: { opacity: 0.7 },
  avatarText: { color: '#087f5b', fontSize: 18, fontWeight: '800' },
  requestCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, padding: 14, borderWidth: 1, borderColor: '#d8ebe1', borderRadius: 17, backgroundColor: '#fff' },
  requestCardPressed: { backgroundColor: '#f6fcf8' },
  requestIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#e7f5ee' },
  requestIconText: { color: '#087f5b', fontSize: 19, fontWeight: '900' },
  requestContent: { flex: 1, minWidth: 0, marginLeft: 11 },
  requestTitle: { color: '#26372e', fontSize: 13, fontWeight: '900' },
  requestDescription: { marginTop: 4, color: '#718078', fontSize: 10 },
  requestAction: { marginLeft: 8, color: '#087f5b', fontSize: 11, fontWeight: '900' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  metricCard: { width: '48%', minHeight: 102, flexGrow: 1, justifyContent: 'space-between', padding: 14, borderRadius: 18 },
  metricLabel: { color: '#53635a', fontSize: 11, fontWeight: '700' },
  metricValue: { marginTop: 10, color: '#172820', fontSize: 21, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 12 },
  sectionTitle: { color: '#172820', fontSize: 17, fontWeight: '800' },
  sectionHint: { color: '#8a968f', fontSize: 11, fontWeight: '600' },
  stockRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 9, padding: 12, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 15, backgroundColor: '#fff' },
  stockIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff3db' },
  stockIconText: { color: '#a86200', fontSize: 15, fontWeight: '900' },
  stockInfo: { flex: 1, minWidth: 0, marginLeft: 10 },
  stockName: { color: '#28372f', fontSize: 13, fontWeight: '700' },
  stockMeta: { marginTop: 4, color: '#8a968f', fontSize: 10 },
  stockCount: { marginLeft: 8, color: '#b86d00', fontSize: 13, fontWeight: '800' },
  stockUnit: { color: '#9ca7a1', fontSize: 11, fontWeight: '500' },
  emptyCard: { padding: 18, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 16, backgroundColor: '#fff' },
  emptyTitle: { color: '#28372f', fontSize: 14, fontWeight: '800' },
  emptyText: { marginTop: 5, color: '#819087', fontSize: 12, lineHeight: 18 },
  errorCard: { padding: 15, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 15, backgroundColor: '#fff6f5' },
  errorText: { color: '#a3332a', fontSize: 12, lineHeight: 18 },
  retry: { marginTop: 8, color: '#087f5b', fontSize: 12, fontWeight: '800' },
  loader: { padding: 20 },
  dateLabel: { marginTop: 18, color: '#9aa59f', fontSize: 11, textAlign: 'center' },
});
