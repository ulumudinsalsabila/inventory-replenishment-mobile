import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Flame, PackageSearch, ShoppingCart, SlidersHorizontal, Wallet } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/auth-provider';
import { useBranchFilter } from '../auth/branch-filter';
import { ApiError } from '../lib/api';
import { useOnRefocus } from '../lib/use-refocus';
import { formatServiceType, type ServiceType } from '../lib/display';
import { OpenBillCard, type DashboardOpenBills } from './open-bill-card';
import { OptionSheet } from './option-sheet';
import { dateLabel, daysBetween, jakartaToday, money, percent, percentChange, quantity, shiftDate } from '../lib/report';
import { customRangeLabel, type CustomRange } from '../lib/date-range';
import { DateRangeSheet } from './date-range-sheet';

type Dashboard = {
  salesToday: string | number;
  estimatedProfit: string | number;
  orderCountToday: number;
  itemSoldCount: string | number;
  branchSales: { branchId: string; branch: { id: string; name: string } | null; netSales: string | number }[];
  bestSellers: { productId: string; name: string; quantity: string | number }[];
  openBills?: DashboardOpenBills;
  /** Deposits of bills cancelled in the period: handed back or kept as income. Neither is part of sales. */
  deposits?: { refunded: DepositBucket; forfeited: DepositBucket };
  /** Settled sales split by dine in / takeaway; null = not recorded (older orders). */
  salesByServiceType?: { serviceType: ServiceType | null; amount: string | number; count: number }[];
};
type DepositBucket = { count: number; amount: string | number };
type StockSummary = { summary: { totalQuantity: number; productCount: number; stockValue: number } };
type Preset = 'today' | '7days' | 'month' | 'custom';
type IconType = ComponentType<{ size?: number; color?: string }>;

const presets: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Hari ini' }, { id: '7days', label: '7 Hari' }, { id: 'month', label: 'Bulan ini' }, { id: 'custom', label: 'Custom' },
];
const barColors = ['#07956f', '#2fc48d', '#3f7fe8', '#e0901c', '#9a5be0', '#e05a7a'];

function ranges(preset: Preset, anchor: string, custom?: CustomRange) {
  if (preset === 'custom' && custom) {
    // Compared with the same number of days right before the picked range.
    const length = daysBetween(custom.from, custom.to) + 1;
    const previousTo = shiftDate(custom.from, -1);
    return { from: custom.from, to: custom.to, previous: { from: shiftDate(previousTo, -(length - 1)), to: previousTo }, compare: length === 1 ? 'dari hari sebelumnya' : `dari ${length} hari sebelumnya` };
  }
  if (preset === 'month') {
    const from = `${anchor.slice(0, 7)}-01`;
    const previousFrom = `${shiftDate(from, -1).slice(0, 7)}-01`;
    const previousEnd = shiftDate(from, -1);
    const sameDay = shiftDate(previousFrom, daysBetween(from, anchor));
    return { from, to: anchor, previous: { from: previousFrom, to: sameDay < previousEnd ? sameDay : previousEnd }, compare: 'dari bulan lalu' };
  }
  const length = preset === 'today' ? 1 : 7;
  const from = shiftDate(anchor, -(length - 1));
  const previousTo = shiftDate(from, -1);
  return { from, to: anchor, previous: { from: shiftDate(previousTo, -(length - 1)), to: previousTo }, compare: length === 1 ? 'dari kemarin' : `dari ${length} hari sebelumnya` };
}

function Change({ current, previous, label }: { current: number; previous: number | undefined; label: string }) {
  if (previous === undefined) return <Text style={styles.changeHint}> </Text>;
  const change = percentChange(current, previous);
  const up = change === null || change >= 0;
  const color = up ? '#07956f' : '#d23b35';
  const Arrow = up ? ArrowUp : ArrowDown;
  return <>
    <View style={styles.changeRow}><Arrow size={14} color={color} strokeWidth={2.6} /><Text style={[styles.changeValue, { color }]}>{change === null ? 'Baru' : percent(Math.abs(change))}</Text></View>
    <Text style={styles.changeHint}>{label}</Text>
  </>;
}

function MetricCard({ label, value, icon: Icon, tone, children }: { label: string; value: string; icon: IconType; tone: keyof typeof tones; children: React.ReactNode }) {
  const color = tones[tone];
  return <View style={[styles.metricCard, { backgroundColor: color.bg }]}>
    <View style={styles.metricTop}><View style={[styles.metricIcon, { backgroundColor: color.iconBg }]}><Icon size={19} color={color.fg} /></View><Text style={styles.metricLabel}>{label}</Text></View>
    <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>{value}</Text>
    {children}
  </View>;
}

const tones = {
  green: { bg: '#eefaf4', iconBg: '#d5f3e5', fg: '#07956f' },
  pink: { bg: '#fff1f2', iconBg: '#ffdfe2', fg: '#d6455a' },
  blue: { bg: '#eef4ff', iconBg: '#dbe7ff', fg: '#3f6fe0' },
  orange: { bg: '#fff6e9', iconBg: '#ffe6c4', fg: '#e07d12' },
};

export function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const { user, accessToken, authorizedRequest } = useAuth();
  const [anchor, setAnchor] = useState(jakartaToday());
  const [preset, setPreset] = useState<Preset>('today');
  // Shared with the app header so picking a branch in either place filters the dashboard.
  const { branches, selectedBranchId: branchId, setSelectedBranchId: setBranchId } = useBranchFilter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [previous, setPrevious] = useState<Dashboard | null>(null);
  const [stock, setStock] = useState<StockSummary['summary'] | null>(null);
  const [loading, setLoading] = useState(user?.permissions.includes('report.read') ?? false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useOnRefocus(() => setReloadKey((value) => value + 1));
  const [branchSheet, setBranchSheet] = useState(false);
  const [datePicker, setDatePicker] = useState(false);
  const [pickerValue, setPickerValue] = useState(new Date());
  const [customRange, setCustomRange] = useState<CustomRange>(() => ({ from: jakartaToday(), to: jakartaToday() }));
  const [rangeSheetVisible, setRangeSheetVisible] = useState(false);
  const range = ranges(preset, anchor, customRange);
  const canReadReports = user?.permissions.includes('report.read') ?? false;
  const selectedBranch = branches.find((item) => item.id === branchId);

  useEffect(() => {
    if (!accessToken || !canReadReports) return;
    let active = true;
    const query = (from: string, to: string) => {
      const params = new URLSearchParams({ from, to });
      if (branchId) params.set('branchId', branchId);
      return params.toString();
    };
    const stockParams = new URLSearchParams({ page: '1', perPage: '10' });
    if (branchId) stockParams.set('branchId', branchId);
    void Promise.all([
      authorizedRequest<Dashboard>(`dashboard?${query(range.from, range.to)}`),
      authorizedRequest<Dashboard>(`dashboard?${query(range.previous.from, range.previous.to)}`).catch(() => null),
      authorizedRequest<StockSummary>(`reports/stock-value?${stockParams.toString()}`).catch(() => null),
    ])
      .then(([current, before, stockResult]) => { if (!active) return; setData(current); setPrevious(before); setStock(stockResult?.summary ?? null); setError(''); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Ringkasan dashboard belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [accessToken, authorizedRequest, canReadReports, branchId, range.from, range.to, range.previous.from, range.previous.to, reloadKey]);

  if (!canReadReports) return <View style={styles.noAccess}><Text style={styles.noAccessTitle}>Dashboard tidak tersedia</Text><Text style={styles.noAccessText}>Akun ini belum memiliki izin untuk membaca laporan.</Text></View>;

  const branchRows = (data?.branchSales ?? []).map((row) => ({ id: row.branchId, name: row.branch?.name ?? 'Cabang', amount: Number(row.netSales) }));
  const branchTotal = branchRows.reduce((sum, row) => sum + Math.max(row.amount, 0), 0);
  const bestSeller = data?.bestSellers[0];
  const depositRows = data?.deposits ? ([['DP dikembalikan', data.deposits.refunded], ['DP hangus', data.deposits.forfeited]] as const).filter(([, bucket]) => bucket.count > 0) : [];
  // Dine in first, then takeaway, then sales without a recorded service type; hidden while nothing was recorded at all.
  const serviceOrder = (type: ServiceType | null) => type === 'DINE_IN' ? 0 : type === 'TAKEAWAY' ? 1 : 2;
  const serviceRows = (data?.salesByServiceType ?? []).some((row) => row.serviceType) ? [...(data?.salesByServiceType ?? [])].sort((a, b) => serviceOrder(a.serviceType) - serviceOrder(b.serviceType)) : [];
  const serviceTotal = serviceRows.reduce((sum, row) => sum + Math.max(Number(row.amount), 0), 0);
  const openDatePicker = () => { setPickerValue(new Date(`${anchor}T12:00:00`)); setDatePicker(true); };
  const applyDate = (date: Date) => {
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    setAnchor(value > jakartaToday() ? jakartaToday() : value);
  };

  return <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((value) => value + 1); }} tintColor="#07956f" />}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Dashboard</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Pilih tanggal" onPress={preset === 'custom' ? () => setRangeSheetVisible(true) : openDatePicker} style={styles.dateButton}>
          <CalendarDays size={16} color="#33465c" /><Text style={styles.dateText}>{preset === 'custom' ? customRangeLabel(customRange) : dateLabel(anchor)}</Text><ChevronDown size={15} color="#5f7188" />
        </Pressable>
      </View>
      <Text style={styles.subtitle}>Ringkasan penjualan, stok dan keuntungan {selectedBranch ? selectedBranch.name : 'semua cabang'}.</Text>

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>
          {presets.map((item) => {
            const active = preset === item.id;
            return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => item.id === 'custom' ? setRangeSheetVisible(true) : setPreset(item.id)} style={[styles.preset, active && styles.presetActive]}><Text style={[styles.presetText, active && styles.presetTextActive]}>{item.label}</Text></Pressable>;
          })}
        </ScrollView>
        {!user?.branchId ? <Pressable accessibilityRole="button" accessibilityLabel="Filter cabang" onPress={() => setBranchSheet(true)} style={[styles.filterButton, branchId ? styles.filterButtonActive : null]}><SlidersHorizontal size={18} color={branchId ? '#fff' : '#33465c'} /></Pressable> : null}
      </View>

      {error ? <Pressable accessibilityRole="button" onPress={() => setReloadKey((value) => value + 1)} style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText}>Coba lagi</Text></Pressable> : null}
      {loading && !data ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}

      <View style={styles.grid}>
        <MetricCard label="Total Penjualan" value={money(data?.salesToday)} icon={Wallet} tone="green"><Change current={Number(data?.salesToday ?? 0)} previous={previous ? Number(previous.salesToday) : undefined} label={range.compare} /></MetricCard>
        <MetricCard label="Total Keuntungan" value={money(data?.estimatedProfit)} icon={ClipboardList} tone="pink"><Change current={Number(data?.estimatedProfit ?? 0)} previous={previous ? Number(previous.estimatedProfit) : undefined} label={range.compare} /></MetricCard>
      </View>
      <View style={styles.grid}>
        <MetricCard label="Total Transaksi" value={quantity(data?.orderCountToday)} icon={ShoppingCart} tone="blue"><Change current={data?.orderCountToday ?? 0} previous={previous?.orderCountToday} label={range.compare} /></MetricCard>
        <MetricCard label="Item Terjual" value={quantity(data?.itemSoldCount)} icon={PackageSearch} tone="orange"><Change current={Number(data?.itemSoldCount ?? 0)} previous={previous ? Number(previous.itemSoldCount) : undefined} label={range.compare} /></MetricCard>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Penjualan per cabang</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(app)/branch-profit', params: { month: anchor.slice(0, 7) } })} style={styles.seeAll}><Text style={styles.seeAllText}>Lihat semua</Text><ArrowRight size={15} color="#07956f" /></Pressable>
        </View>
        {!loading && !branchRows.length ? <Text style={styles.empty}>Belum ada penjualan pada periode ini.</Text> : null}
        {branchRows.slice(0, 4).map((row, index) => {
          const share = branchTotal ? (Math.max(row.amount, 0) / branchTotal) * 100 : 0;
          return <Pressable key={row.id} accessibilityRole="button" accessibilityHint="Buka laporan keuntungan cabang ini" onPress={() => router.push({ pathname: '/(app)/branch-profit', params: { month: anchor.slice(0, 7), branchId: row.id } })} style={({ pressed }) => [styles.branchRow, pressed && styles.pressed]}>
            <View style={styles.branchTop}><Text numberOfLines={1} style={styles.branchName}>{row.name}</Text><Text style={styles.branchAmount}>{money(row.amount)}</Text><ChevronRight size={15} color="#75869a" /></View>
            <View style={styles.branchBarRow}>
              <View style={styles.track}><View style={[styles.bar, { width: `${Math.max(share, row.amount > 0 ? 2 : 0)}%`, backgroundColor: barColors[index % barColors.length] }]} /></View>
              <Text style={styles.share}>{Math.round(share)}%</Text>
            </View>
          </Pressable>;
        })}
      </View>

      <OpenBillCard data={data?.openBills} loading={loading} actionLabel="Laporan" onAction={() => router.push('/(app)/open-bills')} onPressBill={(id) => router.push({ pathname: '/(app)/orders', params: { orderId: id } })} />

      {serviceRows.length ? <View style={styles.panel}>
        <Text style={styles.panelTitle}>Dine in / Takeaway</Text>
        {serviceRows.map((row, index) => {
          const share = serviceTotal ? (Math.max(Number(row.amount), 0) / serviceTotal) * 100 : 0;
          return <View key={row.serviceType ?? 'none'} style={styles.branchRow}>
            <View style={styles.branchTop}><Text numberOfLines={1} style={styles.branchName}>{formatServiceType(row.serviceType) || 'Tidak tercatat'} · {row.count} transaksi</Text><Text style={styles.branchAmount}>{money(row.amount)}</Text></View>
            <View style={styles.branchBarRow}>
              <View style={styles.track}><View style={[styles.bar, { width: `${Math.max(share, Number(row.amount) > 0 ? 2 : 0)}%`, backgroundColor: barColors[index % barColors.length] }]} /></View>
              <Text style={styles.share}>{Math.round(share)}%</Text>
            </View>
          </View>;
        })}
      </View> : null}

      {depositRows.length ? <View style={styles.panel}>
        <Text style={styles.panelTitle}>DP bill batal</Text>
        <Text style={styles.depositHint}>Tidak termasuk penjualan.</Text>
        {depositRows.map(([label, bucket]) => <View key={label} style={styles.depositRow}><Text style={styles.branchName}>{label}</Text><Text style={styles.branchAmount}>{bucket.count} bill · {money(bucket.amount)}</Text></View>)}
      </View> : null}

      <View style={styles.grid}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/unsold-stock')} style={({ pressed }) => [styles.bottomCard, { backgroundColor: tones.blue.bg }, pressed && styles.pressed]}>
          <View style={[styles.bottomIcon, { backgroundColor: tones.blue.iconBg }]}><PackageSearch size={19} color={tones.blue.fg} /></View>
          <View style={styles.bottomText}><Text style={styles.bottomLabel}>Stok belum terjual</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.bottomValue}>{quantity(stock?.totalQuantity)} item</Text><Text numberOfLines={1} style={styles.bottomHint}>{money(stock?.stockValue)}</Text></View>
          <ChevronRight size={17} color="#3f6fe0" />
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!bestSeller} onPress={() => bestSeller && router.push({ pathname: '/(app)/stock-detail', params: { productId: bestSeller.productId } })} style={({ pressed }) => [styles.bottomCard, { backgroundColor: tones.pink.bg }, pressed && styles.pressed]}>
          <View style={[styles.bottomIcon, { backgroundColor: tones.pink.iconBg }]}><Flame size={19} color={tones.pink.fg} /></View>
          <View style={styles.bottomText}><Text style={styles.bottomLabel}>Produk terlaris</Text><Text numberOfLines={1} style={styles.bottomValue}>{bestSeller?.name ?? '—'}</Text><Text numberOfLines={1} style={styles.bottomHint}>{bestSeller ? `${quantity(bestSeller.quantity)} terjual` : 'Belum ada penjualan'}</Text></View>
          <ChevronRight size={17} color="#d6455a" />
        </Pressable>
      </View>
    </ScrollView>

    <OptionSheet visible={branchSheet} title="Filter cabang" selectedId={branchId} onSelect={setBranchId} onClose={() => setBranchSheet(false)}
      options={[{ id: '', label: 'Semua cabang' }, ...branches.map((branch) => ({ id: branch.id, label: branch.name, hint: branch.code }))]} />
    {rangeSheetVisible ? <DateRangeSheet initial={customRange} bottomInset={insets.bottom} onApply={(picked) => { setCustomRange(picked); setPreset('custom'); setRangeSheetVisible(false); }} onClose={() => setRangeSheetVisible(false)} /> : null}
    {Platform.OS === 'android' && datePicker ? <DateTimePicker value={pickerValue} mode="date" display="default" maximumDate={new Date()} onChange={(event, date) => { setDatePicker(false); if (event.type === 'set' && date) applyDate(date); }} /> : null}
    {Platform.OS === 'ios' ? <Modal visible={datePicker} transparent animationType="slide" onRequestClose={() => setDatePicker(false)}>
      <View style={styles.sheetBackdrop}><View style={[styles.dateSheet, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
        <View style={styles.dateSheetHeader}>
          <Pressable accessibilityRole="button" onPress={() => setDatePicker(false)}><Text style={styles.dateAction}>Batal</Text></Pressable>
          <Text style={styles.dateSheetTitle}>Pilih tanggal</Text>
          <Pressable accessibilityRole="button" onPress={() => { applyDate(pickerValue); setDatePicker(false); }}><Text style={styles.dateAction}>Pilih</Text></Pressable>
        </View>
        <DateTimePicker value={pickerValue} mode="date" display="spinner" maximumDate={new Date()} onChange={(_, date) => { if (date) setPickerValue(date); }} />
      </View></View>
    </Modal> : null}
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f9fb' },
  page: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 26 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { color: '#13233a', fontSize: 25, fontWeight: '800' },
  dateButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 12, backgroundColor: '#fff' },
  dateText: { color: '#24364c', fontSize: 12, fontWeight: '700' },
  subtitle: { marginTop: 6, color: '#6d7d90', fontSize: 12 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 14 },
  presets: { gap: 7 },
  preset: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 12, backgroundColor: '#fff' },
  presetActive: { borderColor: '#07956f', backgroundColor: '#07956f' },
  presetText: { color: '#33465c', fontSize: 12, fontWeight: '700' },
  presetTextActive: { color: '#fff' },
  filterButton: { width: 42, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 12, backgroundColor: '#fff' },
  filterButtonActive: { borderColor: '#07956f', backgroundColor: '#07956f' },
  errorBox: { marginBottom: 12, padding: 11, borderWidth: 1, borderColor: '#f2c7c4', borderRadius: 12, backgroundColor: '#fff5f4' },
  errorText: { color: '#a83a32', fontSize: 12 },
  retryText: { marginTop: 4, color: '#a83a32', fontSize: 12, fontWeight: '800' },
  loader: { marginBottom: 12 },
  grid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  metricCard: { flex: 1, minWidth: 0, padding: 13, borderRadius: 16 },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  metricLabel: { flex: 1, color: '#43566b', fontSize: 11, fontWeight: '600' },
  metricValue: { marginTop: 10, color: '#13233a', fontSize: 15, fontWeight: '800' },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 7 },
  changeValue: { fontSize: 12, fontWeight: '800' },
  changeHint: { marginTop: 1, color: '#7a899b', fontSize: 11 },
  panel: { marginBottom: 10, padding: 14, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  panelTitle: { color: '#13233a', fontSize: 15, fontWeight: '800' },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  seeAllText: { color: '#07956f', fontSize: 12, fontWeight: '800' },
  empty: { paddingVertical: 16, color: '#7a899b', fontSize: 12, textAlign: 'center' },
  branchRow: { marginTop: 12 },
  branchTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingRight: 21 },
  branchName: { flex: 1, color: '#26384d', fontSize: 12, fontWeight: '600' },
  branchAmount: { color: '#13233a', fontSize: 12, fontWeight: '800' },
  branchBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  track: { flex: 1, height: 8, overflow: 'hidden', borderRadius: 4, backgroundColor: '#edf1f5' },
  bar: { height: 8, borderRadius: 4 },
  depositHint: { marginTop: 2, color: '#7a899b', fontSize: 11 },
  depositRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  share: { width: 34, color: '#6d7d90', fontSize: 12, textAlign: 'right' },
  bottomCard: { flex: 1, minWidth: 0, minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 16 },
  bottomIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  bottomText: { flex: 1, minWidth: 0 },
  bottomLabel: { color: '#43566b', fontSize: 10, fontWeight: '600' },
  bottomValue: { marginTop: 4, color: '#13233a', fontSize: 15, fontWeight: '800' },
  bottomHint: { marginTop: 2, color: '#5f7188', fontSize: 11 },
  pressed: { opacity: 0.75 },
  noAccess: { flex: 1, justifyContent: 'center', margin: 16, padding: 20, borderWidth: 1, borderColor: '#e6ece9', borderRadius: 16, backgroundColor: '#fff' },
  noAccessTitle: { color: '#172338', fontSize: 14, fontWeight: '800' },
  noAccessText: { marginTop: 6, color: '#6d7d90', fontSize: 12 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#13221c80' },
  dateSheet: { paddingHorizontal: 16, paddingTop: 14, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#fff' },
  dateSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateSheetTitle: { color: '#172338', fontSize: 15, fontWeight: '800' },
  dateAction: { color: '#07956f', fontSize: 14, fontWeight: '800' },
});
