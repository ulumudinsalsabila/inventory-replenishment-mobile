import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { CalendarDays, ChevronDown, ChevronRight, Coins, Store, TrendingUp, Warehouse, X } from 'lucide-react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { useAuth } from '../../auth/auth-provider';
import { useBranchFilter } from '../../auth/branch-filter';
import { ApiError } from '../../lib/api';
import { useOnRefocus } from '../../lib/use-refocus';
import { OptionSheet } from '../../components/option-sheet';
import { compactMoney, jakartaToday, money, monthLabel, monthRange, percent, recentMonths, shortDateLabel } from '../../lib/report';

type Totals = { revenue: number; cost: number; profit: number; margin: number; orderCount: number };
type BranchProfit = { summary: Totals; daily: (Totals & { date: string })[]; branches: (Totals & { branchId: string; name: string; code: string })[] };
type Granularity = 'day' | 'week';

const series = [
  { key: 'revenue', label: 'Pendapatan', color: '#13a46f' },
  { key: 'cost', label: 'Modal', color: '#f07f7a' },
  { key: 'profit', label: 'Keuntungan', color: '#4a74e8' },
] as const;
const branchTones = [
  { bg: '#eef4ff', fg: '#3f6fe0' }, { bg: '#fff3e3', fg: '#e07d12' }, { bg: '#eef0ff', fg: '#5b5be0' }, { bg: '#eefaf4', fg: '#07956f' }, { bg: '#fff1f2', fg: '#d6455a' },
];

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value / 4) ?? 10;
  return Math.ceil(value / (step * magnitude)) * step * magnitude;
}

function ProfitChart({ buckets }: { buckets: (Totals & { label: string; showLabel: boolean })[] }) {
  const [width, setWidth] = useState(0);
  const height = 210;
  const left = 34;
  const bottom = 22;
  const plotHeight = height - bottom - 8;
  const max = niceMax(Math.max(0, ...buckets.flatMap((bucket) => [bucket.revenue, bucket.cost, bucket.profit])));
  const ticks = [0, 1, 2, 3, 4].map((index) => (max / 4) * index);
  const slot = buckets.length ? (width - left) / buckets.length : 0;
  const bar = Math.max(1.5, Math.min(9, (slot * 0.78) / 3));
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height }}>
    {width ? <Svg width={width} height={height} accessibilityLabel="Grafik pendapatan, modal, dan keuntungan">
      {ticks.map((tick) => {
        const y = 8 + plotHeight - (tick / max) * plotHeight;
        return <G key={tick}>
          <Line x1={left} x2={width} y1={y} y2={y} stroke="#e9eef3" strokeWidth={1} />
          <SvgText x={left - 6} y={y + 3} fontSize={9} fill="#7a899b" textAnchor="end">{compactMoney(tick)}</SvgText>
        </G>;
      })}
      {buckets.map((bucket, index) => {
        const groupStart = left + index * slot + (slot - bar * 3) / 2;
        return <G key={bucket.label}>
          {series.map((item, position) => {
            const value = Math.max(bucket[item.key], 0);
            const barHeight = (value / max) * plotHeight;
            return <Rect key={item.key} x={groupStart + position * bar} y={8 + plotHeight - barHeight} width={bar * 0.9} height={barHeight} rx={Math.min(2, bar / 3)} fill={item.color} />;
          })}
          {bucket.showLabel ? <SvgText x={left + index * slot + slot / 2} y={height - 6} fontSize={9} fill="#7a899b" textAnchor="middle">{bucket.label}</SvgText> : null}
        </G>;
      })}
    </Svg> : null}
  </View>;
}

export default function BranchProfitScreen() {
  // The dashboard opens this for one branch (?branchId=) when a "Penjualan per cabang" row is tapped.
  const params = useLocalSearchParams<{ month?: string; branchId?: string }>();
  const { accessToken, authorizedRequest } = useAuth();
  const [month, setMonth] = useState(params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : jakartaToday().slice(0, 7));
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { selectedBranchId } = useBranchFilter();
  const [branchId, setBranchId] = useState(params.branchId || selectedBranchId);
  const [all, setAll] = useState<BranchProfit | null>(null);
  const [selected, setSelected] = useState<BranchProfit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useOnRefocus(() => setReloadKey((value) => value + 1));
  const [monthSheet, setMonthSheet] = useState(false);
  const [granularitySheet, setGranularitySheet] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const { from, to } = monthRange(month);
    void Promise.all([
      authorizedRequest<BranchProfit>(`reports/branch-profit?from=${from}&to=${to}`),
      branchId ? authorizedRequest<BranchProfit>(`reports/branch-profit?from=${from}&to=${to}&branchId=${encodeURIComponent(branchId)}`) : Promise.resolve(null),
    ])
      .then(([allResult, branchResult]) => { if (active) { setAll(allResult); setSelected(branchResult); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Laporan keuntungan belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [accessToken, authorizedRequest, branchId, month, reloadKey]);

  const view = branchId ? selected : all;
  const summary = view?.summary;
  const buckets = useMemo(() => {
    const daily = view?.daily ?? [];
    if (granularity === 'day') return daily.map((row, index) => ({ ...row, label: shortDateLabel(row.date), showLabel: index === 0 || (index + 1) % 5 === 0 }));
    const weeks: (Totals & { label: string; showLabel: boolean })[] = [];
    daily.forEach((row, index) => {
      const week = Math.floor(index / 7);
      weeks[week] ??= { revenue: 0, cost: 0, profit: 0, margin: 0, orderCount: 0, label: `Mg ${week + 1}`, showLabel: true };
      weeks[week].revenue += row.revenue;
      weeks[week].cost += row.cost;
      weeks[week].profit += row.profit;
    });
    return weeks;
  }, [granularity, view?.daily]);
  const selectedBranch = all?.branches.find((row) => row.branchId === branchId);

  return <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((value) => value + 1); }} tintColor="#07956f" />}>
      <Pressable accessibilityRole="button" accessibilityLabel="Pilih bulan" onPress={() => setMonthSheet(true)} style={styles.monthButton}>
        <CalendarDays size={17} color="#33465c" /><Text style={styles.monthText}>{monthLabel(month)}</Text><ChevronDown size={16} color="#5f7188" />
      </Pressable>
      {selectedBranch ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus filter cabang" onPress={() => setBranchId('')} style={styles.branchChip}><Text style={styles.branchChipText}>{selectedBranch.name}</Text><X size={14} color="#07795a" /></Pressable> : null}

      {error ? <Pressable accessibilityRole="button" onPress={() => setReloadKey((value) => value + 1)} style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText}>Coba lagi</Text></Pressable> : null}

      <View style={styles.grid}>
        <View style={[styles.statCard, { backgroundColor: '#eef4ff' }]}><View style={[styles.statIcon, { backgroundColor: '#dbe7ff' }]}><TrendingUp size={19} color="#3f6fe0" /></View><View style={styles.statText}><Text style={styles.statLabel}>Total Pendapatan</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{money(summary?.revenue)}</Text></View></View>
        <View style={[styles.statCard, { backgroundColor: '#fff1f2' }]}><View style={[styles.statIcon, { backgroundColor: '#ffdfe2' }]}><Warehouse size={19} color="#d6455a" /></View><View style={styles.statText}><Text style={styles.statLabel}>Total Modal</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{money(summary?.cost)}</Text></View></View>
      </View>
      <View style={styles.grid}>
        <View style={[styles.statCard, styles.profitCard, { backgroundColor: '#eefaf4' }]}><View style={[styles.statIcon, { backgroundColor: '#d5f3e5' }]}><Coins size={19} color="#07956f" /></View><View style={styles.statText}><Text style={styles.statLabel}>Total Keuntungan</Text><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statValue, styles.statValueLarge]}>{money(summary?.profit)}</Text></View></View>
        <View style={[styles.statCard, styles.marginCard]}><Text style={styles.statLabel}>Margin</Text><Text style={[styles.statValue, styles.marginValue]}>{percent(summary?.margin ?? 0)}</Text></View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>Grafik keuntungan</Text>
          <Pressable accessibilityRole="button" onPress={() => setGranularitySheet(true)} style={styles.selectButton}><Text style={styles.selectText}>{granularity === 'day' ? 'Per hari' : 'Per minggu'}</Text><ChevronDown size={15} color="#5f7188" /></Pressable>
        </View>
        {loading && !view ? <ActivityIndicator style={styles.loader} color="#07956f" /> : <ProfitChart buckets={buckets} />}
        <View style={styles.legend}>{series.map((item) => <View key={item.key} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: item.color }]} /><Text style={styles.legendText}>{item.label}</Text></View>)}</View>
      </View>

      <Text style={styles.sectionTitle}>Keuntungan per cabang</Text>
      {!loading && !all?.branches.length ? <Text style={styles.empty}>Belum ada cabang aktif.</Text> : null}
      {(all?.branches ?? []).map((row, index) => {
        const tone = branchTones[index % branchTones.length];
        const active = row.branchId === branchId;
        return <Pressable key={row.branchId} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityHint="Tampilkan ringkasan dan grafik cabang ini" onPress={() => setBranchId(active ? '' : row.branchId)} style={({ pressed }) => [styles.branchCard, active && styles.branchCardActive, pressed && styles.pressed]}>
          <View style={[styles.branchIcon, { backgroundColor: tone.bg }]}><Store size={20} color={tone.fg} /></View>
          <View style={styles.branchInfo}>
            <View style={styles.branchNameRow}><Text numberOfLines={1} style={styles.branchName}>{row.name}</Text><Text style={[styles.marginBadge, row.margin < 0 && styles.marginBadgeNegative]}>{percent(row.margin)}</Text></View>
            <View style={styles.branchLine}><Text style={styles.branchLabel}>Pendapatan</Text><Text style={styles.branchNumber}>{money(row.revenue)}</Text></View>
            <View style={styles.branchLine}><Text style={styles.branchLabel}>Modal</Text><Text style={styles.branchNumber}>{money(row.cost)}</Text></View>
          </View>
          <View style={styles.branchProfit}><Text style={styles.profitLabel}>Keuntungan</Text><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.branchProfitValue, row.profit < 0 && styles.negative]}>{money(row.profit)}</Text></View>
          <ChevronRight size={17} color="#8a9aab" />
        </Pressable>;
      })}
    </ScrollView>

    <OptionSheet visible={monthSheet} title="Pilih bulan" selectedId={month} onSelect={setMonth} onClose={() => setMonthSheet(false)} options={recentMonths(12).map((value) => ({ id: value, label: monthLabel(value) }))} />
    <OptionSheet visible={granularitySheet} title="Tampilan grafik" selectedId={granularity} onSelect={(value) => setGranularity(value as Granularity)} onClose={() => setGranularitySheet(false)} options={[{ id: 'day', label: 'Per hari' }, { id: 'week', label: 'Per minggu' }]} />
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f9fb' },
  page: { padding: 16, paddingBottom: 28 },
  monthButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 13, backgroundColor: '#fff' },
  monthText: { flex: 1, color: '#24364c', fontSize: 14, fontWeight: '700' },
  branchChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16, backgroundColor: '#d9f4e8' },
  branchChipText: { color: '#07795a', fontSize: 12, fontWeight: '800' },
  errorBox: { marginTop: 12, padding: 11, borderWidth: 1, borderColor: '#f2c7c4', borderRadius: 12, backgroundColor: '#fff5f4' },
  errorText: { color: '#a83a32', fontSize: 12 },
  retryText: { marginTop: 4, color: '#a83a32', fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', gap: 10, marginTop: 12 },
  statCard: { flex: 1, minWidth: 0, minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16 },
  profitCard: { flex: 1.6 },
  marginCard: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 6, backgroundColor: '#eefaf4' },
  statIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  statText: { flex: 1, minWidth: 0 },
  statLabel: { color: '#43566b', fontSize: 11, fontWeight: '600' },
  statValue: { marginTop: 4, color: '#13233a', fontSize: 15, fontWeight: '800' },
  statValueLarge: { fontSize: 15 },
  marginValue: { color: '#07956f', fontSize: 15 },
  panel: { marginTop: 14, padding: 14, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  panelTitle: { color: '#13233a', fontSize: 15, fontWeight: '800' },
  selectButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 10 },
  selectText: { color: '#33465c', fontSize: 12, fontWeight: '700' },
  loader: { height: 210 },
  legend: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 16, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { color: '#43566b', fontSize: 11 },
  sectionTitle: { marginTop: 18, marginBottom: 10, color: '#13233a', fontSize: 15, fontWeight: '800' },
  empty: { paddingVertical: 16, color: '#7a899b', fontSize: 12, textAlign: 'center' },
  branchCard: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9, padding: 12, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  branchCardActive: { borderColor: '#9fdcc5', backgroundColor: '#f6fdf9' },
  branchIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  branchInfo: { flex: 1, minWidth: 0, gap: 3 },
  branchNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  branchName: { flexShrink: 1, color: '#13233a', fontSize: 12, fontWeight: '800' },
  marginBadge: { overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, color: '#07795a', fontSize: 10, fontWeight: '800', backgroundColor: '#d9f4e8' },
  marginBadgeNegative: { color: '#b4332d', backgroundColor: '#fde2e0' },
  branchLine: { flexDirection: 'row', gap: 8 },
  branchLabel: { width: 66, color: '#7a899b', fontSize: 10 },
  branchNumber: { color: '#26384d', fontSize: 11, fontWeight: '600' },
  profitLabel: { color: '#7a899b', fontSize: 10 },
  branchProfit: { alignItems: 'flex-end', maxWidth: 110 },
  branchProfitValue: { marginTop: 3, color: '#07956f', fontSize: 14, fontWeight: '800' },
  negative: { color: '#d23b35' },
  pressed: { opacity: 0.75 },
});
