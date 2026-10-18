import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, ReceiptText } from 'lucide-react-native';
import { customerLabel, formatAge } from '../lib/display';
import { money } from '../lib/report';

/** `openBills` from GET /dashboard: live unpaid open bills, ignoring the dashboard's date range. */
export type DashboardOpenBills = {
  count: number;
  total: string | number;
  /** Deposits (DP) already taken on the bills that are still open. */
  paidTotal?: string | number;
  oldestOpenedAt: string | null;
  oldest: { id: string; orderNumber: string; customerName: string | null; customerPhone: string | null; grandTotal: string | number; createdAt: string; branch: { name: string } | null; _count: { items: number } }[];
};

/** Dashboard card with the unpaid open bills and the oldest ones, which are the most likely to be forgotten. */
export function OpenBillCard({ data, loading, actionLabel, onAction, onPressBill }: {
  data: DashboardOpenBills | undefined;
  loading: boolean;
  actionLabel: string;
  onAction: () => void;
  onPressBill: (id: string) => void;
}) {
  const count = data?.count ?? 0;
  const deposits = Number(data?.paidTotal ?? 0);
  return <View style={styles.panel}>
    <View style={styles.header}>
      <View style={styles.titleWrap}><View style={styles.icon}><ReceiptText size={17} color="#c27a0e" /></View><Text style={styles.title}>Open Bill</Text></View>
      <Pressable accessibilityRole="button" onPress={onAction} style={styles.action}><Text style={styles.actionText}>{actionLabel}</Text><ChevronRight size={14} color="#07956f" /></Pressable>
    </View>
    <View style={styles.stats}>
      <View style={styles.stat}><Text style={styles.statLabel}>Belum dibayar</Text><Text style={styles.statValue}>{count} bill</Text></View>
      <View style={styles.stat}><Text style={styles.statLabel}>Total nilai</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{money(data?.total)}</Text></View>
      <View style={styles.stat}><Text style={styles.statLabel}>Tertua</Text><Text style={styles.statValue}>{data?.oldestOpenedAt ? formatAge(data.oldestOpenedAt) : '—'}</Text></View>
    </View>
    {deposits > 0 ? <Text numberOfLines={1} style={styles.deposit}>DP {money(deposits)} · sisa {money(Number(data?.total ?? 0) - deposits)}</Text> : null}
    {!loading && !count ? <Text style={styles.empty}>Tidak ada open bill yang belum dibayar.</Text> : null}
    {(data?.oldest ?? []).map((bill, index) => <Pressable key={bill.id} accessibilityRole="button" onPress={() => onPressBill(bill.id)} style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.pressed]}>
      <View style={styles.rowMain}>
        <Text numberOfLines={1} style={styles.rowName}>{customerLabel(bill.customerName, bill.customerPhone) || bill.orderNumber}</Text>
        <Text numberOfLines={1} style={styles.rowMeta}>{bill.orderNumber} · {bill._count.items} item · {formatAge(bill.createdAt)} lalu{bill.branch?.name ? ` · ${bill.branch.name}` : ''}</Text>
      </View>
      <Text numberOfLines={1} style={styles.rowTotal}>{money(bill.grandTotal)}</Text>
      <ChevronRight size={15} color="#7b899b" />
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  panel: { marginBottom: 11, padding: 13, borderWidth: 1, borderColor: '#f3e2bf', borderRadius: 16, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#fff3dc' },
  title: { color: '#13233a', fontSize: 14, fontWeight: '800' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4 },
  actionText: { color: '#07956f', fontSize: 11, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 7, marginTop: 11 },
  stat: { flex: 1, minWidth: 0, padding: 9, borderRadius: 11, backgroundColor: '#fff8e8' },
  statLabel: { color: '#7a6a4b', fontSize: 10 },
  statValue: { marginTop: 3, color: '#13233a', fontSize: 13, fontWeight: '800' },
  deposit: { marginTop: 8, color: '#8a5a08', fontSize: 11, fontWeight: '800' },
  empty: { paddingTop: 14, paddingBottom: 4, color: '#7a899b', fontSize: 11, textAlign: 'center' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingVertical: 6 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#edf1f3' },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { color: '#26344a', fontSize: 12, fontWeight: '800' },
  rowMeta: { marginTop: 3, color: '#78889b', fontSize: 10 },
  rowTotal: { maxWidth: 110, color: '#172338', fontSize: 12, fontWeight: '900' },
  pressed: { opacity: 0.7 },
});
