import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Banknote, Box, ChevronRight, CircleUserRound, Clock3, LockKeyhole, Package, ReceiptText, Store, TrendingUp } from 'lucide-react-native';
import Svg, { Circle, Defs, G, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useAuth } from '../../../auth/auth-provider';
import { ApiError } from '../../../lib/api';

type Dashboard = {
  from: string;
  branchName: string | null;
  salesToday: string | number;
  grossSalesToday: string | number;
  refundToday: string | number;
  orderCountToday: number;
  itemSoldCount: string | number;
  averageTransaction: string | number;
  lowStockCount: number;
  orderStatuses: { status: string; count: number }[];
  salesByMethod: { method: string; amount: string | number; count: number }[];
  recentOrders: {
    id: string;
    orderNumber: string;
    status: string;
    grandTotal: string | number;
    createdAt: string;
    paymentMethod: string | null;
    _count: { items: number };
  }[];
  cashClosing: { status: string; closingNumber: string; closedAt: string } | null;
};

const money = (value: string | number) => `Rp ${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const dateLabel = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
const timeLabel = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

function jakartaDate() {
  return new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date());
}

function PaymentChart({ methods }: { methods: Dashboard['salesByMethod'] }) {
  const categories = [
    { label: 'Tunai', methods: ['CASH'], color: '#27c993' },
    { label: 'QRIS', methods: ['QRIS'], color: '#3888f5' },
    { label: 'E-Wallet', methods: ['GRAB', 'GOBIZ'], color: '#b54df0' },
    { label: 'Transfer', methods: ['TRANSFER'], color: '#ed45a9' },
    { label: 'Kartu', methods: ['DEBIT_CARD', 'CREDIT_CARD'], color: '#ff9418' },
    { label: 'Lainnya', methods: ['OTHER'], color: '#a5afbd' },
  ];
  const rows = categories.map((category) => ({
    ...category,
    amount: methods.filter((item) => category.methods.includes(item.method)).reduce((total, item) => total + Number(item.amount), 0),
  }));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const circumference = 2 * Math.PI * 48;
  let offset = 0;

  return <View style={styles.paymentContent}>
    <View style={styles.chartWrap}>
      <Svg width={124} height={124} viewBox="0 0 124 124" accessibilityLabel={`Total pembayaran ${money(total)}`}>
        <Circle cx={62} cy={62} r={48} fill="none" stroke="#edf1f4" strokeWidth={16} />
        <G transform="rotate(-90 62 62)">{rows.map((row) => {
          const length = total ? (row.amount / total) * circumference : 0;
          const segment = <Circle key={row.label} cx={62} cy={62} r={48} fill="none" stroke={row.color} strokeWidth={16} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />;
          offset += length;
          return segment;
        })}</G>
      </Svg>
      <View pointerEvents="none" style={styles.chartCenter}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.chartTotal}>{money(total)}</Text><Text style={styles.chartCaption}>Total pembayaran</Text></View>
    </View>
    <View style={styles.legend}>{rows.map((row) => {
      const percent = total ? `${((row.amount / total) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '0%';
      return <View key={row.label} style={styles.legendRow}>
        <View style={styles.legendLabel}><View style={[styles.legendDot, { backgroundColor: row.color }]} /><Text numberOfLines={1} style={styles.legendName}>{row.label}</Text></View>
        <Text numberOfLines={1} style={styles.legendAmount}>{money(row.amount)}</Text><Text style={styles.legendPercent}>{percent}</Text>
      </View>;
    })}</View>
  </View>;
}

const orderStatusLabel: Record<string, string> = { COMPLETED: 'SELESAI', PARTIALLY_REFUNDED: 'REFUND', REFUNDED: 'REFUND', PAID: 'DIBAYAR', PENDING_PAYMENT: 'MENUNGGU', CANCELLED: 'BATAL' };

export default function DashboardScreen() {
  const { user, accessToken, authorizedRequest } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const canReadReports = user?.permissions.includes('report.read') ?? false;
  const canCloseCash = user?.permissions.includes('cash_closing.create') ?? false;
  const today = jakartaDate();
  const completedOrders = data?.orderStatuses.find((item) => item.status === 'COMPLETED')?.count ?? 0;

  useEffect(() => {
    if (!accessToken || !canReadReports) { setLoading(false); return; }
    let active = true;
    setError('');
    void authorizedRequest<Dashboard>(`dashboard?from=${today}&to=${today}`)
      .then((result) => { if (active) setData(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Ringkasan belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [accessToken, authorizedRequest, canReadReports, reloadKey, today]);

  const metrics = [
    { label: 'Transaksi', value: data?.orderCountToday, color: '#eef5ff', icon: <ReceiptText size={19} color="#347ff0" /> },
    { label: 'Item terjual', value: data ? Number(data.itemSoldCount).toLocaleString('id-ID') : undefined, color: '#fff5e9', icon: <Box size={19} color="#f28b17" /> },
    { label: 'Rata-rata', value: data ? money(data.averageTransaction) : undefined, color: '#f6efff', icon: <Banknote size={19} color="#9a4be3" /> },
  ];

  return <ScrollView style={styles.screen} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((current) => current + 1); }} tintColor="#07956f" />}>
    <View style={styles.header}>
      <View style={styles.storeIcon}><Store size={22} color="#07956f" /></View>
      <View style={styles.branchInfo}><Text numberOfLines={1} style={styles.branchName}>Toko {data?.branchName ?? (user?.branchId ? 'Cabang' : 'Semua Cabang')}</Text><Text style={styles.dateText}>{dateLabel.format(new Date())}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Buka profil akun" onPress={() => router.push('/(app)/(tabs)/account')} style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}><CircleUserRound size={23} color="#53677f" /></Pressable>
    </View>

    {canReadReports ? <>
      <View style={styles.hero}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 360 150" preserveAspectRatio="none">
          <Defs><LinearGradient id="salesGradient" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#20b98d" /><Stop offset="1" stopColor="#009c72" /></LinearGradient></Defs>
          <Rect width="360" height="150" rx="18" fill="url(#salesGradient)" />
          {[34, 54, 40, 68, 50, 78, 58, 91, 73, 108, 82, 120].map((height, index) => <Rect key={index} x={190 + index * 15} y={150 - height} width="9" height={height} rx="4" fill="#fff" opacity="0.07" />)}
        </Svg>
        <Text style={styles.heroLabel}>Total Penjualan Hari Ini</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.heroValue}>{loading ? 'Memuat…' : data ? money(data.salesToday) : '—'}</Text>
        <Text style={styles.heroDetail}>Bruto {money(data?.grossSalesToday ?? 0)}  ·  Refund {money(data?.refundToday ?? 0)}</Text>
        <View style={styles.heroBadge}><TrendingUp size={16} color="#fff" /><Text style={styles.heroBadgeText}>Hari ini</Text></View>
      </View>
      {error ? <Pressable accessibilityRole="button" onPress={() => { setLoading(true); setReloadKey((current) => current + 1); }} style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText}>Coba lagi</Text></Pressable> : null}
      <View style={styles.metrics}>{metrics.map((item) => <View key={item.label} style={[styles.metricCard, { backgroundColor: item.color }]}>
        <View style={styles.metricIcon}>{item.icon}</View><Text numberOfLines={1} style={styles.metricLabel}>{item.label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>{loading ? '…' : item.value ?? '—'}</Text>
      </View>)}</View>
      <View style={styles.overviewRow}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/orders')} style={({ pressed }) => [styles.overviewCard, pressed && styles.pressed]}>
          <View style={[styles.overviewIcon, styles.greenIcon]}><ReceiptText size={20} color="#07956f" /></View><View style={styles.overviewInfo}><Text style={styles.overviewLabel}>Pesanan</Text><Text style={styles.overviewValue}>{loading ? '…' : data?.orderCountToday ?? '—'}</Text><Text style={styles.overviewHint}>Selesai {completedOrders}</Text></View><ChevronRight size={18} color="#687e98" />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/inventory')} style={({ pressed }) => [styles.overviewCard, pressed && styles.pressed]}>
          <View style={[styles.overviewIcon, styles.redIcon]}><Package size={20} color="#df342c" /></View><View style={styles.overviewInfo}><Text style={styles.overviewLabel}>Stok rendah</Text><Text style={styles.overviewValue}>{loading ? '…' : data?.lowStockCount ?? '—'}</Text><Text style={styles.overviewHint}>Di bawah minimum</Text></View><ChevronRight size={18} color="#687e98" />
        </Pressable>
      </View>
      <View style={styles.panel}><Text style={styles.panelTitle}>Penjualan per metode</Text><PaymentChart methods={data?.salesByMethod ?? []} /></View>
      <View style={styles.panel}>
        <View style={styles.panelHeader}><Text style={styles.panelTitle}>Transaksi terbaru</Text><Pressable accessibilityRole="button" onPress={() => router.push('/(app)/orders')} style={styles.seeAll}><Text style={styles.seeAllText}>Lihat semua</Text><ChevronRight size={15} color="#07956f" /></Pressable></View>
        {loading && !data ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}
        {!loading && !data?.recentOrders.length ? <Text style={styles.emptyText}>Belum ada transaksi hari ini.</Text> : null}
        {(data?.recentOrders ?? []).map((order, index) => {
          const label = orderStatusLabel[order.status] ?? order.status.replaceAll('_', ' ');
          return <Pressable key={order.id} accessibilityRole="button" onPress={() => router.push('/(app)/orders')} style={({ pressed }) => [styles.orderRow, index > 0 && styles.orderBorder, pressed && styles.pressed]}>
            <View style={[styles.orderIcon, { backgroundColor: index % 2 ? '#edf5ff' : '#e8f8f1' }]}>{index % 2 ? <Clock3 size={19} color="#3987f5" /> : <ReceiptText size={19} color="#07956f" />}</View>
            <View style={styles.orderMain}><Text numberOfLines={1} style={styles.orderNumber}>{order.orderNumber}</Text><Text style={styles.orderMeta}>{timeLabel.format(new Date(order.createdAt))}  ·  {order._count.items} item</Text></View>
            <View style={styles.orderTrailing}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.orderTotal}>{money(order.grandTotal)}</Text><Text style={[styles.statusBadge, order.status === 'COMPLETED' ? styles.statusComplete : styles.statusOther]}>{label}</Text></View><ChevronRight size={16} color="#71839a" />
          </Pressable>;
        })}
      </View>
      <View style={styles.closingCard}>
        <View style={styles.closingIcon}><Box size={21} color="#07956f" /></View><View style={styles.closingInfo}><Text style={styles.closingLabel}>Status kas hari ini</Text><Text style={styles.closingStatus}>{data?.cashClosing ? 'Sudah ditutup' : 'Belum ditutup'}</Text><Text numberOfLines={2} style={styles.closingHint}>{data?.cashClosing ? data.cashClosing.closingNumber : 'Lakukan cash closing untuk mengakhiri hari.'}</Text></View>
        {canCloseCash ? <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/cash')} style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}><LockKeyhole size={16} color="#fff" /><Text style={styles.closeButtonText}>{data?.cashClosing ? 'Lihat kas' : 'Tutup kas'}</Text></Pressable> : null}
      </View>
    </> : <View style={styles.noAccess}><Text style={styles.noAccessTitle}>Ringkasan tidak tersedia</Text><Text style={styles.noAccessText}>Akun ini belum memiliki akses laporan.</Text></View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' }, page: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 22 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  storeIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#def7ed' },
  branchInfo: { flex: 1, minWidth: 0, marginHorizontal: 11 }, branchName: { color: '#172338', fontSize: 14, fontWeight: '800' }, dateText: { marginTop: 3, color: '#687b95', fontSize: 12 },
  profileButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#eef2f6' }, pressed: { opacity: 0.72 },
  hero: { minHeight: 150, justifyContent: 'center', overflow: 'hidden', marginBottom: 14, padding: 19, borderRadius: 18, backgroundColor: '#08a97c' }, heroLabel: { color: '#e8fff7', fontSize: 14, fontWeight: '600' },
  heroValue: { maxWidth: '88%', marginTop: 7, color: '#fff', fontSize: 30, fontWeight: '900' }, heroDetail: { marginTop: 8, color: '#e3fff6', fontSize: 11 },
  heroBadge: { position: 'absolute', top: 18, right: 15, minWidth: 58, alignItems: 'center', gap: 3, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 15, backgroundColor: '#ffffff2e' }, heroBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  errorBox: { marginBottom: 12, padding: 12, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 12, backgroundColor: '#fff6f5' }, errorText: { color: '#a3332a', fontSize: 11 }, retryText: { marginTop: 5, color: '#087f5b', fontSize: 11, fontWeight: '800' },
  metrics: { flexDirection: 'row', gap: 8, marginBottom: 12 }, metricCard: { flex: 1, minWidth: 0, minHeight: 112, padding: 10, borderWidth: 1, borderColor: '#edf0f3', borderRadius: 15 },
  metricIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 8, borderRadius: 11, backgroundColor: '#ffffffb8' }, metricLabel: { color: '#65748c', fontSize: 9, fontWeight: '700' }, metricValue: { marginTop: 5, color: '#172338', fontSize: 16, fontWeight: '900' },
  overviewRow: { flexDirection: 'row', gap: 9, marginBottom: 14 }, overviewCard: { flex: 1, minWidth: 0, minHeight: 92, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 11, borderWidth: 1, borderColor: '#edf0f3', borderRadius: 15, backgroundColor: '#fff' },
  overviewIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, greenIcon: { backgroundColor: '#e4f8ef' }, redIcon: { backgroundColor: '#fff0ef' }, overviewInfo: { flex: 1, minWidth: 0, marginHorizontal: 8 }, overviewLabel: { color: '#63748c', fontSize: 10, fontWeight: '600' }, overviewValue: { marginTop: 3, color: '#172338', fontSize: 17, fontWeight: '900' }, overviewHint: { marginTop: 3, color: '#697d97', fontSize: 9 },
  panel: { marginBottom: 13, paddingHorizontal: 13, paddingVertical: 14, borderWidth: 1, borderColor: '#e9eef1', borderRadius: 16, backgroundColor: '#fff' }, panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, panelTitle: { color: '#172338', fontSize: 15, fontWeight: '900' },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 }, seeAllText: { color: '#07956f', fontSize: 10, fontWeight: '800' }, paymentContent: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 }, chartWrap: { width: 124, height: 124, alignItems: 'center', justifyContent: 'center' },
  chartCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 17 }, chartTotal: { width: '100%', color: '#172338', fontSize: 12, fontWeight: '900', textAlign: 'center' }, chartCaption: { marginTop: 3, color: '#75849b', fontSize: 8, textAlign: 'center' },
  legend: { flex: 1, minWidth: 0, gap: 9 }, legendRow: { minHeight: 14, flexDirection: 'row', alignItems: 'center', gap: 5 }, legendLabel: { width: 62, flexDirection: 'row', alignItems: 'center', gap: 5 }, legendDot: { width: 8, height: 8, borderRadius: 4 }, legendName: { flex: 1, color: '#28364e', fontSize: 9, fontWeight: '600' }, legendAmount: { flex: 1, color: '#28364e', fontSize: 9, fontWeight: '600' }, legendPercent: { width: 31, color: '#6e8098', fontSize: 9, textAlign: 'right' },
  loader: { padding: 18 }, emptyText: { paddingVertical: 18, color: '#78879a', fontSize: 11, textAlign: 'center' }, orderRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }, orderBorder: { borderTopWidth: 1, borderTopColor: '#eef1f3' }, orderIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, orderMain: { flex: 1, minWidth: 0 }, orderNumber: { color: '#28364e', fontSize: 10, fontWeight: '700' }, orderMeta: { marginTop: 4, color: '#75849b', fontSize: 9 }, orderTrailing: { width: 91, alignItems: 'flex-end', gap: 4 }, orderTotal: { width: '100%', color: '#172338', fontSize: 10, fontWeight: '900', textAlign: 'right' },
  statusBadge: { overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, fontSize: 8, fontWeight: '900' }, statusComplete: { color: '#078a58', backgroundColor: '#ddf8eb' }, statusOther: { color: '#327be0', backgroundColor: '#e6f1ff' },
  closingCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4, padding: 12, borderWidth: 1, borderColor: '#d4f2e5', borderRadius: 16, backgroundColor: '#effbf5' }, closingIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#d8f6e8' }, closingInfo: { flex: 1, minWidth: 0 }, closingLabel: { color: '#60788b', fontSize: 9, fontWeight: '600' }, closingStatus: { marginTop: 3, color: '#07814f', fontSize: 14, fontWeight: '900' }, closingHint: { marginTop: 3, color: '#6a7e92', fontSize: 8 }, closeButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 11, backgroundColor: '#07956f' }, closeButtonPressed: { opacity: 0.8 }, closeButtonText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  noAccess: { marginTop: 20, padding: 18, borderWidth: 1, borderColor: '#e9eef1', borderRadius: 15, backgroundColor: '#fff' }, noAccessTitle: { color: '#172338', fontSize: 14, fontWeight: '800' }, noAccessText: { marginTop: 5, color: '#75849b', fontSize: 11 },
});