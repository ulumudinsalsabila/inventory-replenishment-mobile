import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Print from 'expo-print';
import { Ban, CircleCheck, CircleX, Clock3, Download, ReceiptText, Search, Timer, TrendingUp } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { getRange, rangeLabel, rangeOptions, type RangePreset } from '../../lib/date-range';
import { customerLabel, formatDate, formatDuration } from '../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { fetchAllPages } from '../../lib/paging';
import { dateLabel, money, percent } from '../../lib/report';

type State = 'open' | 'closed' | 'cancelled';
type Bucket = { count: number; total: string | number };
type OpenBillRow = {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  state: State;
  grandTotal: string;
  paidTotal: string;
  itemCount: number;
  createdAt: string;
  closedAt: string | null;
  durationMinutes: number;
  branch: { name: string } | null;
  cashier: { id: string; name: string } | null;
};
type OpenBillReport = {
  summary: { totalCount: number; open: Bucket; closed: Bucket; cancelled: Bucket; averageCloseMinutes: number | null; closeRate: number | null; voids?: { count: number; amount: string | number } };
  data: OpenBillRow[];
  meta: { page: number; totalPages: number; total: number };
};
type IconType = ComponentType<{ size?: number; color?: string }>;

const stateTabs: { id: State | ''; label: string }[] = [{ id: '', label: 'Semua' }, { id: 'open', label: 'Open' }, { id: 'closed', label: 'Selesai' }, { id: 'cancelled', label: 'Batal' }];
const stateLabel: Record<State, string> = { open: 'Open', closed: 'Selesai', cancelled: 'Batal' };
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);

function Tile({ label, value, hint, icon: Icon, bg, fg }: { label: string; value: string; hint?: string; icon: IconType; bg: string; fg: string }) {
  return <View style={[styles.tile, { backgroundColor: bg }]}>
    <View style={styles.tileIcon}><Icon size={18} color={fg} /></View>
    <View style={styles.tileText}><Text style={styles.tileLabel}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.tileValue}>{value}</Text>{hint ? <Text numberOfLines={1} style={styles.tileHint}>{hint}</Text> : null}</View>
  </View>;
}

export default function OpenBillReportScreen() {
  const { user, accessToken, authorizedRequest } = useAuth();
  const canRead = user?.permissions.includes('report.read') ?? false;
  const canOpenOrder = user?.permissions.includes('order.read') ?? false;
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [rangePreset, setRangePreset] = useState<RangePreset>('7days');
  const [state, setState] = useState<State | ''>('');
  // The summary comes with every page; it is kept from the first page of the current filters.
  const [firstPage, setFirstPage] = useState<{ path: string; value: OpenBillReport } | null>(null);
  const [exporting, setExporting] = useState(false);

  const { from, to } = getRange(rangePreset);
  const params = new URLSearchParams({ from, to });
  if (search) params.set('search', search);
  if (state) params.set('state', state);
  const listPath = `reports/open-bills?${params.toString()}`;

  const reportRequest = useCallback(async <R,>(path: string) => {
    const response = await authorizedRequest<R>(path);
    const [base, query = ''] = path.split(/&(?=page=)/);
    if (query.startsWith('page=1&')) setFirstPage({ path: base, value: response as OpenBillReport });
    return response;
  }, [authorizedRequest]);
  const list = useInfiniteList<OpenBillRow>(reportRequest, accessToken && canRead ? listPath : null);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);
  const items = list.items;
  const summary = firstPage?.path === listPath ? firstPage.value.summary : null;
  const error = items.length ? '' : list.error;

  const exportReport = useCallback(async () => {
    setExporting(true);
    try {
      const { data: rows } = await fetchAllPages<OpenBillRow>(authorizedRequest, listPath);
      const filters = [`${dateLabel(from)} - ${dateLabel(to)}`, state ? stateLabel[state] : 'Semua status', ...(search ? [`Cari "${search}"`] : [])].join(' · ');
      const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:11px;color:#13233a}h1{font-size:18px;margin:0}p{color:#5f7188}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:6px;border-bottom:1px solid #e1e7ee;text-align:left}th{background:#f2f5f8}.r{text-align:right}</style></head><body><h1>Laporan Open Bill</h1><p>${escapeHtml(filters)} · Dicetak ${escapeHtml(new Date().toLocaleString('id-ID'))}</p><table><tr><th>Nomor</th><th>Pelanggan</th><th>No. HP</th><th>Cabang</th><th>Dibuka</th><th>Status</th><th class="r">Durasi</th><th class="r">Total</th></tr>${rows.map((row) => `<tr><td>${escapeHtml(row.orderNumber)}</td><td>${escapeHtml(row.customerName ?? '-')}</td><td>${escapeHtml(row.customerPhone ?? '-')}</td><td>${escapeHtml(row.branch?.name ?? '-')}</td><td>${escapeHtml(formatDate(row.createdAt))}</td><td>${stateLabel[row.state]}</td><td class="r">${formatDuration(row.durationMinutes)}</td><td class="r">${money(row.grandTotal)}</td></tr>`).join('')}<tr><th colspan="7">Total</th><th class="r">${money(rows.reduce((sum, row) => sum + Number(row.grandTotal), 0))}</th></tr></table></body></html>`;
      await Print.printAsync({ html });
    } catch (cause) {
      Alert.alert('Gagal mengunduh', cause instanceof ApiError ? cause.message : 'Laporan open bill belum dapat dicetak.');
    } finally {
      setExporting(false);
    }
  }, [authorizedRequest, from, listPath, search, state, to]);

  if (!canRead) return <View style={styles.noAccess}><Text style={styles.noAccessTitle}>Laporan tidak tersedia</Text><Text style={styles.noAccessText}>Akun ini belum memiliki izin untuk membaca laporan.</Text></View>;

  const header = <View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>
      {rangeOptions.map((item) => {
        const active = rangePreset === item.id;
        return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setRangePreset(item.id)} style={[styles.preset, active && styles.presetActive]}><Text style={[styles.presetText, active && styles.presetTextActive]}>{item.label}</Text></Pressable>;
      })}
    </ScrollView>
    <Text style={styles.rangeHint}>Bill yang dibuka {dateLabel(from)}{from !== to ? ` - ${dateLabel(to)}` : ''}</Text>

    <View style={styles.grid}>
      <Tile label="Total bill" value={`${summary?.totalCount ?? 0} bill`} icon={ReceiptText} bg="#eef4ff" fg="#3f6fe0" />
      <Tile label="Masih open" value={`${summary?.open.count ?? 0} bill`} hint={money(summary?.open.total)} icon={Clock3} bg="#fff6e9" fg="#e07d12" />
    </View>
    <View style={styles.grid}>
      <Tile label="Selesai" value={`${summary?.closed.count ?? 0} bill`} hint={money(summary?.closed.total)} icon={CircleCheck} bg="#eefaf4" fg="#07956f" />
      <Tile label="Batal" value={`${summary?.cancelled.count ?? 0} bill`} hint={money(summary?.cancelled.total)} icon={CircleX} bg="#fff1f2" fg="#d6455a" />
    </View>
    <View style={styles.grid}>
      <Tile label="Rata-rata waktu tutup" value={summary?.averageCloseMinutes != null ? formatDuration(summary.averageCloseMinutes) : '—'} icon={Timer} bg="#f3eaff" fg="#9746df" />
      <Tile label="Close rate" value={summary?.closeRate != null ? percent(summary.closeRate * 100) : '—'} hint="selesai dari bill yang ditutup" icon={TrendingUp} bg="#eefaf4" fg="#07956f" />
    </View>
    <View style={styles.grid}>
      {/* Items voided after being sent to the kitchen: the main open bill leak to watch. */}
      <Tile label="Void" value={`${summary?.voids?.count ?? 0} kali`} hint={money(summary?.voids?.amount)} icon={Ban} bg="#fff1f2" fg="#d6455a" />
    </View>

    <View style={styles.searchBox}><Search size={18} color="#71839a" /><TextInput accessibilityLabel="Cari open bill" value={searchInput} onChangeText={setSearchInput} placeholder="Cari nama, No. HP, atau nomor..." placeholderTextColor="#94a3b4" style={styles.searchInput} returnKeyType="search" /></View>
    <View style={styles.tabs}>{stateTabs.map((item) => {
      const active = state === item.id;
      return <Pressable key={item.id || 'all'} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setState(item.id)} style={[styles.tab, active && styles.tabActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text></Pressable>;
    })}</View>
    {error ? <Pressable accessibilityRole="button" onPress={() => void list.reload()} style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText}>Coba lagi</Text></Pressable> : null}
    {list.loading ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}
  </View>;

  return <>
    <Stack.Screen options={{ headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Unduh laporan open bill" disabled={exporting} onPress={() => void exportReport()} style={styles.headerButton}>{exporting ? <ActivityIndicator color="#07956f" /> : <Download size={20} color="#26384d" />}</Pressable> }} />
    <FlatList
      {...scrollProps}
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={list.loading ? [] : items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      ListEmptyComponent={!list.loading && !error ? <Text style={styles.empty}>Belum ada open bill untuk periode {rangeLabel(rangePreset).toLowerCase()}.</Text> : null}
      ListFooterComponent={<LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={items.length} error={list.error} onRetry={list.loadMore} />}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor="#07956f" />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" disabled={!canOpenOrder} onPress={() => router.push({ pathname: '/(app)/orders', params: { orderId: item.id } })} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.cardTop}>
          <View style={styles.cardMain}>
            <Text numberOfLines={1} style={styles.cardName}>{customerLabel(item.customerName, item.customerPhone) || 'Tanpa nama'}</Text>
            <Text numberOfLines={1} style={styles.cardMeta}>{item.orderNumber} · {item.itemCount} item{item.branch?.name ? ` · ${item.branch.name}` : ''}</Text>
          </View>
          <Text style={[styles.badge, item.state === 'open' ? styles.badgeOpen : item.state === 'closed' ? styles.badgeClosed : styles.badgeCancelled]}>{stateLabel[item.state]}</Text>
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.cardMain}>
            <Text style={styles.cardMeta}>Dibuka {formatDate(item.createdAt)}{item.cashier ? ` · ${item.cashier.name}` : ''}</Text>
            <Text style={styles.cardMeta}>{item.state === 'open' ? `Terbuka ${formatDuration(item.durationMinutes)}` : `${item.state === 'closed' ? 'Selesai' : 'Dibatalkan'} setelah ${formatDuration(item.durationMinutes)}`}</Text>
          </View>
          <View style={styles.cardRight}><Text numberOfLines={1} style={styles.cardTotal}>{money(item.grandTotal)}</Text>{Number(item.paidTotal) > 0 && item.state === 'open' ? <Text style={styles.cardMeta}>Dibayar {money(item.paidTotal)}</Text> : null}</View>
        </View>
      </Pressable>}
    />
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f9fb' },
  page: { padding: 16, paddingBottom: 28 },
  headerButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  presets: { gap: 7 },
  preset: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 12, backgroundColor: '#fff' },
  presetActive: { borderColor: '#07956f', backgroundColor: '#07956f' },
  presetText: { color: '#33465c', fontSize: 12, fontWeight: '700' },
  presetTextActive: { color: '#fff' },
  rangeHint: { marginTop: 8, color: '#6d7d90', fontSize: 11 },
  grid: { flexDirection: 'row', gap: 10, marginTop: 10 },
  tile: { flex: 1, minWidth: 0, minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 16 },
  tileIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#ffffffb3' },
  tileText: { flex: 1, minWidth: 0 },
  tileLabel: { color: '#43566b', fontSize: 11, fontWeight: '600' },
  tileValue: { marginTop: 3, color: '#13233a', fontSize: 15, fontWeight: '800' },
  tileHint: { marginTop: 1, color: '#5f7188', fontSize: 10 },
  searchBox: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 13, backgroundColor: '#fff' },
  searchInput: { flex: 1, color: '#13233a', fontSize: 14, paddingVertical: 8 },
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
  card: { marginBottom: 8, padding: 12, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 8 },
  cardMain: { flex: 1, minWidth: 0 },
  cardName: { color: '#13233a', fontSize: 12, fontWeight: '800' },
  cardMeta: { marginTop: 3, color: '#7a899b', fontSize: 11 },
  cardRight: { alignItems: 'flex-end', maxWidth: 130 },
  cardTotal: { color: '#13233a', fontSize: 13, fontWeight: '800' },
  badge: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontSize: 10, fontWeight: '800' },
  badgeOpen: { color: '#b0650a', backgroundColor: '#fff1d9' },
  badgeClosed: { color: '#07795a', backgroundColor: '#d9f4e8' },
  badgeCancelled: { color: '#b4332d', backgroundColor: '#fde2e0' },
  pressed: { opacity: 0.75 },
  noAccess: { flex: 1, justifyContent: 'center', margin: 16, padding: 20, borderWidth: 1, borderColor: '#e6ece9', borderRadius: 16, backgroundColor: '#fff' },
  noAccessTitle: { color: '#172338', fontSize: 14, fontWeight: '800' },
  noAccessText: { marginTop: 6, color: '#6d7d90', fontSize: 12 },
});
