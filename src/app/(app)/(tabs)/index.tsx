import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Banknote, Box, ChevronDown, ChevronRight, ClipboardCheck, LockKeyhole, Package, ReceiptText, ShoppingCart, TrendingUp, WalletCards, X } from 'lucide-react-native';
import Svg, { Circle, Defs, G, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useAuth } from '../../../auth/auth-provider';
import { ApiError } from '../../../lib/api';
import { getRange, rangeOptions, type RangePreset } from '../../../lib/date-range';
import { AdminDashboard } from '../../../components/admin-dashboard';

type Dashboard = {
  branchName: string | null;
  salesToday: string | number;
  grossSalesToday: string | number;
  refundToday: string | number;
  estimatedProfit: string | number;
  orderCountToday: number;
  itemSoldCount: string | number;
  averageTransaction: string | number;
  lowStockCount: number;
  pendingRequestCount: number;
  orderStatuses: { status: string; count: number }[];
  salesByMethod: { method: string; amount: string | number; count: number }[];
  recentOrders: { id: string; orderNumber: string; status: string; grandTotal: string | number; createdAt: string; paymentMethod: string | null; _count: { items: number } }[];
  cashClosing: { status: string; closingNumber: string; closedAt: string } | null;
};
type Branch = { id: string; name: string; code: string };
type BranchPage = { data: Branch[] };

const money = (value: string | number | null | undefined) => `Rp ${Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const timeFormatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
const orderStatusLabel: Record<string, string> = { COMPLETED: 'SELESAI', PARTIALLY_REFUNDED: 'REFUND', REFUNDED: 'REFUND', PAID: 'DIBAYAR', PENDING_PAYMENT: 'MENUNGGU', CANCELLED: 'BATAL' };


function PaymentChart({ methods }: { methods: Dashboard['salesByMethod'] }) {
  const rows = useMemo(() => {
    const categories = [
      { label: 'Cash', methods: ['CASH'], color: '#27c993' }, { label: 'QRIS', methods: ['QRIS'], color: '#3987f5' },
      { label: 'E-Wallet', methods: ['GRAB', 'GOBIZ', 'E_WALLET'], color: '#a94ee8' }, { label: 'Transfer', methods: ['TRANSFER', 'BANK_TRANSFER'], color: '#ee55aa' },
      { label: 'Kartu', methods: ['DEBIT_CARD', 'CREDIT_CARD', 'CARD'], color: '#ff9418' }, { label: 'Lainnya', methods: ['OTHER'], color: '#a7b0bd' },
    ];
    return categories.map((category) => ({ ...category, amount: methods.filter((item) => category.methods.includes(item.method)).reduce((sum, item) => sum + Number(item.amount), 0) }));
  }, [methods]);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const circumference = 2 * Math.PI * 43;
  let used = 0;
  return <View style={styles.paymentContent}>
    <View style={styles.chartWrap}>
      <Svg width={112} height={112} viewBox="0 0 112 112" accessibilityLabel={`Total pembayaran ${money(total)}`}>
        <Circle cx={56} cy={56} r={43} fill="none" stroke="#edf1f4" strokeWidth={15} />
        <G transform="rotate(-90 56 56)">{rows.map((row) => { const length = total ? (row.amount / total) * circumference : 0; const segment = <Circle key={row.label} cx={56} cy={56} r={43} fill="none" stroke={row.color} strokeWidth={15} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-used} />; used += length; return segment; })}</G>
      </Svg>
      <View pointerEvents="none" style={styles.chartCenter}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.chartTotal}>{money(total)}</Text><Text style={styles.chartCaption}>Total penjualan</Text></View>
    </View>
    <View style={styles.legend}>{rows.map((row) => <View key={row.label} style={styles.legendRow}>
      <View style={styles.legendNameWrap}><View style={[styles.legendDot, { backgroundColor: row.color }]} /><Text style={styles.legendName}>{row.label}</Text></View>
      <Text numberOfLines={1} style={styles.legendAmount}>{money(row.amount)}</Text><Text style={styles.legendPercent}>{total ? `${((row.amount / total) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '0%'}</Text>
    </View>)}</View>
  </View>;
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const isEmployee = user?.roles.some((role) => role.toUpperCase() === 'PEGAWAI') ?? false;
  return isEmployee ? <EmployeeDashboard /> : <AdminDashboard />;
}

function EmployeeDashboard() {
  const { user, accessToken, authorizedRequest } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState(user?.branchId ?? '');
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [branchPickerVisible, setBranchPickerVisible] = useState(false);
  const [loading, setLoading] = useState(user?.permissions.includes('report.read') ?? false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const canReadReports = user?.permissions.includes('report.read') ?? false;
  const canCloseCash = user?.permissions.includes('cash_closing.create') ?? false;
  const { from, to } = getRange(rangePreset);
  const rangeLabel = rangeOptions.find((item) => item.id === rangePreset)?.label ?? 'Hari ini';
  const selectedBranch = branches.find((item) => item.id === selectedBranchId);
  const completedOrders = data?.orderStatuses.find((item) => item.status === 'COMPLETED')?.count ?? 0;

  useEffect(() => {
    if (!accessToken || user?.branchId) return;
    let active = true;
    void authorizedRequest<BranchPage>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc').then((result) => { if (active) setBranches(result.data); }).catch(() => undefined);
    return () => { active = false; };
  }, [accessToken, authorizedRequest, user?.branchId]);

  useEffect(() => {
    if (!accessToken || !canReadReports) return;
    let active = true;
    const params = new URLSearchParams({ from, to });
    const branchId = user?.branchId ?? selectedBranchId;
    if (branchId) params.set('branchId', branchId);
    void authorizedRequest<Dashboard>(`dashboard?${params.toString()}`)
      .then((result) => { if (active) { setData(result); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Ringkasan dashboard belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [accessToken, authorizedRequest, canReadReports, from, reloadKey, selectedBranchId, to, user?.branchId]);

  if (!canReadReports) return <View style={styles.noAccess}><Text style={styles.noAccessTitle}>Dashboard tidak tersedia</Text><Text style={styles.noAccessText}>Akun ini belum memiliki izin untuk membaca laporan.</Text></View>;

  return <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((value) => value + 1); }} tintColor="#07956f" />}>
      <View style={styles.filters}>
        <View style={styles.rangeControl}>{rangeOptions.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: rangePreset === item.id }} onPress={() => { setLoading(true); setRangePreset(item.id); }} style={[styles.rangeButton, rangePreset === item.id && styles.rangeButtonActive]}><Text style={[styles.rangeText, rangePreset === item.id && styles.rangeTextActive]}>{item.label}</Text></Pressable>)}</View>
        {!user?.branchId ? <Pressable accessibilityRole="button" onPress={() => setBranchPickerVisible(true)} style={styles.branchFilter}><Text numberOfLines={1} style={styles.branchFilterText}>{selectedBranch?.name ?? 'Semua cabang'}</Text><ChevronDown size={15} color="#5f7188" /></Pressable> : null}
      </View>

      <View style={styles.hero}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 360 145" preserveAspectRatio="none"><Defs><LinearGradient id="dashboardGreen" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#22ba8d" /><Stop offset="1" stopColor="#02986f" /></LinearGradient></Defs><Rect width="360" height="145" rx="18" fill="url(#dashboardGreen)" />{[34, 50, 42, 66, 54, 81, 63, 96, 76, 111].map((height, index) => <Rect key={height + index} x={205 + index * 17} y={145 - height} width="10" height={height} rx="5" fill="#fff" opacity="0.07" />)}</Svg>
        <Text style={styles.heroLabel}>Total Penjualan · {rangeLabel}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.heroValue}>{loading && !data ? 'Memuat…' : money(data?.salesToday)}</Text><Text style={styles.heroDetail}>Bruto {money(data?.grossSalesToday)}  ·  Refund {money(data?.refundToday)}</Text>
        <View style={styles.heroBadge}><TrendingUp size={15} color="#fff" /><Text style={styles.heroBadgeText}>{rangeLabel}</Text></View>
      </View>
      {error ? <Pressable accessibilityRole="button" onPress={() => { setLoading(true); setReloadKey((value) => value + 1); }} style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText}>Coba lagi</Text></Pressable> : null}

      <View style={styles.metricRow}>
        <View style={styles.metricCard}><View style={[styles.metricIcon, styles.blue]}><ShoppingCart size={18} color="#377ee8" /></View><Text style={styles.metricLabel}>Transaksi</Text><Text style={styles.metricValue}>{loading ? '…' : Number(data?.orderCountToday ?? 0).toLocaleString('id-ID')}</Text><Text style={styles.metricHint}>Selesai {completedOrders}</Text></View>
        <View style={styles.metricCard}><View style={[styles.metricIcon, styles.orange]}><Box size={18} color="#ef8a1b" /></View><Text style={styles.metricLabel}>Item terjual</Text><Text style={styles.metricValue}>{loading ? '…' : Number(data?.itemSoldCount ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })}</Text><Text style={styles.metricHint}>Unit produk</Text></View>
        <View style={styles.metricCard}><View style={[styles.metricIcon, styles.purple]}><WalletCards size={18} color="#9746df" /></View><Text style={styles.metricLabel}>Rata-rata</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValueSmall}>{loading ? '…' : money(data?.averageTransaction)}</Text><Text style={styles.metricHint}>Per transaksi</Text></View>
      </View>

      <View style={styles.overviewRow}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/(tabs)/orders')} style={({ pressed }) => [styles.overviewCard, pressed && styles.pressed]}><View style={[styles.overviewIcon, styles.green]}><ClipboardCheck size={20} color="#07956f" /></View><View style={styles.overviewText}><Text style={styles.overviewLabel}>Pesanan</Text><Text style={styles.overviewValue}>{data?.orderCountToday ?? 0}</Text><Text style={styles.metricHint}>Selesai {completedOrders}</Text></View><ChevronRight size={17} color="#75869a" /></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/(tabs)/inventory')} style={({ pressed }) => [styles.overviewCard, pressed && styles.pressed]}><View style={[styles.overviewIcon, styles.red]}><Package size={20} color="#de423a" /></View><View style={styles.overviewText}><Text style={styles.overviewLabel}>Stok rendah</Text><Text style={styles.overviewValue}>{data?.lowStockCount ?? 0}</Text><Text style={styles.metricHint}>Di bawah minimum</Text></View><ChevronRight size={17} color="#75869a" /></Pressable>
      </View>

      <View style={styles.panel}><Text style={styles.panelTitle}>Penjualan per metode</Text><PaymentChart methods={data?.salesByMethod ?? []} /></View>
      <View style={styles.panel}>
        <View style={styles.panelHeader}><Text style={styles.panelTitle}>Transaksi terbaru</Text><Pressable accessibilityRole="button" onPress={() => router.push('/(app)/(tabs)/orders')} style={styles.seeAll}><Text style={styles.seeAllText}>Lihat semua</Text><ChevronRight size={14} color="#07956f" /></Pressable></View>
        {loading && !data ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}{!loading && !data?.recentOrders.length ? <Text style={styles.emptyText}>Belum ada transaksi pada periode ini.</Text> : null}
        {(data?.recentOrders ?? []).map((order, index) => <Pressable key={order.id} accessibilityRole="button" onPress={() => router.push('/(app)/(tabs)/orders')} style={({ pressed }) => [styles.orderRow, index > 0 && styles.orderBorder, pressed && styles.pressed]}><View style={[styles.orderIcon, index % 2 ? styles.blue : styles.green]}><ReceiptText size={18} color={index % 2 ? '#377ee8' : '#07956f'} /></View><View style={styles.orderMain}><Text numberOfLines={1} style={styles.orderNumber}>{order.orderNumber}</Text><Text style={styles.orderMeta}>{timeFormatter.format(new Date(order.createdAt))} · {order._count.items} item{order.paymentMethod ? ` · ${order.paymentMethod.replaceAll('_', ' ')}` : ''}</Text></View><View style={styles.orderTrailing}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.orderTotal}>{money(order.grandTotal)}</Text><Text style={[styles.statusBadge, order.status === 'COMPLETED' ? styles.statusComplete : styles.statusOther]}>{orderStatusLabel[order.status] ?? order.status.replaceAll('_', ' ')}</Text></View><ChevronRight size={15} color="#7b899b" /></Pressable>)}
      </View>

      <View style={styles.closingCard}><View style={styles.closingIcon}><Banknote size={21} color="#07956f" /></View><View style={styles.closingInfo}><Text style={styles.closingLabel}>Status kas periode ini</Text><Text style={styles.closingStatus}>{data?.cashClosing ? 'Sudah ditutup' : 'Belum ditutup'}</Text><Text numberOfLines={1} style={styles.closingHint}>{data?.cashClosing?.closingNumber ?? 'Lakukan cash closing untuk mengakhiri hari.'}</Text></View>{canCloseCash ? <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/(tabs)/cash')} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}><LockKeyhole size={15} color="#fff" /><Text style={styles.closeButtonText}>{data?.cashClosing ? 'Lihat kas' : 'Tutup kas'}</Text></Pressable> : null}</View>
    </ScrollView>

    <Modal visible={branchPickerVisible} transparent animationType="fade" onRequestClose={() => setBranchPickerVisible(false)}><Pressable style={styles.modalBackdrop} onPress={() => setBranchPickerVisible(false)}><Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Pilih cabang</Text><Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={() => setBranchPickerVisible(false)} style={styles.modalClose}><X size={19} color="#52657d" /></Pressable></View><Pressable accessibilityRole="button" onPress={() => { setSelectedBranchId(''); setLoading(true); setBranchPickerVisible(false); }} style={[styles.branchOption, !selectedBranchId && styles.branchOptionActive]}><Text style={[styles.branchOptionText, !selectedBranchId && styles.branchOptionTextActive]}>Semua cabang</Text></Pressable>{branches.map((branch) => <Pressable key={branch.id} accessibilityRole="button" onPress={() => { setSelectedBranchId(branch.id); setLoading(true); setBranchPickerVisible(false); }} style={[styles.branchOption, selectedBranchId === branch.id && styles.branchOptionActive]}><Text style={[styles.branchOptionText, selectedBranchId === branch.id && styles.branchOptionTextActive]}>{branch.name}</Text><Text style={styles.branchCode}>{branch.code}</Text></Pressable>)}</Pressable></Pressable></Modal>
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' }, page: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 22 }, filters: { gap: 8, marginBottom: 11 },
  rangeControl: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 11, backgroundColor: '#e9eef1' }, rangeButton: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }, rangeButtonActive: { backgroundColor: '#07885f' }, rangeText: { color: '#63758b', fontSize: 9, fontWeight: '800' }, rangeTextActive: { color: '#fff' },
  branchFilter: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderWidth: 1, borderColor: '#e4e9ec', borderRadius: 11, backgroundColor: '#fff' }, branchFilterText: { flex: 1, color: '#26374e', fontSize: 11, fontWeight: '800' },
  hero: { minHeight: 145, justifyContent: 'center', overflow: 'hidden', marginBottom: 11, padding: 18, borderRadius: 18, backgroundColor: '#06a477' }, heroLabel: { color: '#e8fff7', fontSize: 12, fontWeight: '700' }, heroValue: { maxWidth: '82%', marginTop: 6, color: '#fff', fontSize: 25, fontWeight: '900' }, heroDetail: { marginTop: 8, color: '#dcfff4', fontSize: 10 }, heroBadge: { position: 'absolute', top: 17, right: 14, alignItems: 'center', gap: 3, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 14, backgroundColor: '#ffffff29' }, heroBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  errorBox: { marginBottom: 11, padding: 11, borderWidth: 1, borderColor: '#f2c7c4', borderRadius: 12, backgroundColor: '#fff5f4' }, errorText: { color: '#a83a32', fontSize: 11 }, retryText: { marginTop: 4, color: '#087f5b', fontSize: 10, fontWeight: '900' },
  metricRow: { flexDirection: 'row', gap: 7, marginBottom: 9 }, metricCard: { flex: 1, minWidth: 0, minHeight: 117, padding: 10, borderWidth: 1, borderColor: '#e9eef1', borderRadius: 15, backgroundColor: '#fff' }, metricIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 7, borderRadius: 11 }, blue: { backgroundColor: '#eaf2ff' }, orange: { backgroundColor: '#fff2e2' }, purple: { backgroundColor: '#f3eaff' }, green: { backgroundColor: '#e4f8ef' }, red: { backgroundColor: '#fff0ef' }, metricLabel: { color: '#64768c', fontSize: 9, fontWeight: '700' }, metricValue: { marginTop: 4, color: '#172338', fontSize: 15, fontWeight: '900' }, metricValueSmall: { height: 21, marginTop: 4, color: '#172338', fontSize: 14, fontWeight: '900' }, metricHint: { marginTop: 3, color: '#78899d', fontSize: 9 },
  overviewRow: { flexDirection: 'row', gap: 8, marginBottom: 11 }, overviewCard: { flex: 1, minWidth: 0, minHeight: 86, flexDirection: 'row', alignItems: 'center', padding: 9, borderWidth: 1, borderColor: '#e9eef1', borderRadius: 15, backgroundColor: '#fff' }, overviewIcon: { width: 37, height: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, overviewText: { flex: 1, minWidth: 0, marginHorizontal: 8 }, overviewLabel: { color: '#65758b', fontSize: 9 }, overviewValue: { marginTop: 2, color: '#172338', fontSize: 15, fontWeight: '900' },
  panel: { marginBottom: 11, paddingHorizontal: 12, paddingVertical: 13, borderWidth: 1, borderColor: '#e7edef', borderRadius: 16, backgroundColor: '#fff' }, panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, panelTitle: { color: '#172338', fontSize: 12, fontWeight: '900' }, seeAll: { flexDirection: 'row', alignItems: 'center' }, seeAllText: { color: '#07956f', fontSize: 9, fontWeight: '800' },
  paymentContent: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 11 }, chartWrap: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' }, chartCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }, chartTotal: { width: '100%', color: '#172338', fontSize: 11, fontWeight: '900', textAlign: 'center' }, chartCaption: { marginTop: 2, color: '#7b899a', fontSize: 9 }, legend: { flex: 1, minWidth: 0, gap: 7 }, legendRow: { flexDirection: 'row', alignItems: 'center', gap: 4 }, legendNameWrap: { width: 61, flexDirection: 'row', alignItems: 'center', gap: 5 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendName: { color: '#334158', fontSize: 9 }, legendAmount: { flex: 1, color: '#26344a', fontSize: 9, fontWeight: '700' }, legendPercent: { width: 31, color: '#74859a', fontSize: 9, textAlign: 'right' },
  loader: { padding: 18 }, emptyText: { paddingVertical: 18, color: '#7a899b', fontSize: 10, textAlign: 'center' }, orderRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8 }, orderBorder: { borderTopWidth: 1, borderTopColor: '#edf1f3' }, orderIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, orderMain: { flex: 1, minWidth: 0 }, orderNumber: { color: '#26344a', fontSize: 9, fontWeight: '800' }, orderMeta: { marginTop: 4, color: '#78889b', fontSize: 9 }, orderTrailing: { width: 84, alignItems: 'flex-end', gap: 4 }, orderTotal: { width: '100%', color: '#172338', fontSize: 9, fontWeight: '900', textAlign: 'right' }, statusBadge: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, fontSize: 9, fontWeight: '900' }, statusComplete: { color: '#087f57', backgroundColor: '#ddf8eb' }, statusOther: { color: '#3476ce', backgroundColor: '#e7f1ff' },
  closingCard: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderWidth: 1, borderColor: '#d2f0e2', borderRadius: 16, backgroundColor: '#effbf5' }, closingIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#d8f6e8' }, closingInfo: { flex: 1, minWidth: 0 }, closingLabel: { color: '#60778b', fontSize: 9 }, closingStatus: { marginTop: 2, color: '#07814f', fontSize: 12, fontWeight: '900' }, closingHint: { marginTop: 3, color: '#708197', fontSize: 9 }, closeButton: { minHeight: 41, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 11, backgroundColor: '#07956f' }, closeButtonText: { color: '#fff', fontSize: 9, fontWeight: '900' }, pressed: { opacity: 0.7 },
  noAccess: { flex: 1, justifyContent: 'center', margin: 16, padding: 20, borderWidth: 1, borderColor: '#e6ece9', borderRadius: 16, backgroundColor: '#fff' }, noAccessTitle: { color: '#172338', fontSize: 14, fontWeight: '900' }, noAccessText: { marginTop: 6, color: '#75869a', fontSize: 12 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#13221c80' }, modalCard: { maxHeight: '70%', padding: 17, paddingBottom: 28, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#fff' }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, modalTitle: { color: '#172338', fontSize: 14, fontWeight: '900' }, modalClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#f0f3f5' }, branchOption: { minHeight: 48, justifyContent: 'center', marginTop: 7, paddingHorizontal: 13, borderWidth: 1, borderColor: '#e7ecef', borderRadius: 12 }, branchOptionActive: { borderColor: '#8ad3ba', backgroundColor: '#ecfaf4' }, branchOptionText: { color: '#34445a', fontSize: 12, fontWeight: '800' }, branchOptionTextActive: { color: '#07845f' }, branchCode: { marginTop: 2, color: '#8190a1', fontSize: 9 },
});
