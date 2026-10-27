import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, Mail, MapPin, Pencil, Phone, StickyNote, Store, Trash2, UserCheck, UserX } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/auth-provider';
import { CustomerFormSheet } from '../../components/customer-form';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { customerErrorMessage, type Customer, type CustomerTransaction } from '../../lib/customers';
import { formatDate, formatStatus } from '../../lib/display';
import { useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { useOnRefocus } from '../../lib/use-refocus';
import { money } from '../../lib/report';

type IconType = ComponentType<{ size?: number; color?: string }>;

function InfoRow({ icon: Icon, value }: { icon: IconType; value: string }) {
  return <View style={styles.infoRow}><Icon size={15} color="#71839a" /><Text style={styles.infoText}>{value}</Text></View>;
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, accessToken, authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const can = (permission: string) => user?.permissions.includes(permission) ?? false;
  const canOpenOrder = can('order.read');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useOnRefocus(() => setReloadKey((value) => value + 1));
  const [busy, setBusy] = useState(false);
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    if (!accessToken || !id) return;
    let active = true;
    void authorizedRequest<Customer>(`customers/${encodeURIComponent(id)}`)
      .then((response) => { if (active) { setCustomer(response); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(customerErrorMessage(cause, 'Detail customer belum dapat dimuat.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken, authorizedRequest, id, reloadKey]);

  const history = useInfiniteList<CustomerTransaction>(authorizedRequest, accessToken && id ? `customers/${encodeURIComponent(id)}/transactions` : null);
  const scrollProps = useLoadMoreOnScroll(history.loadMore);

  const setActive = useCallback(async (target: Customer, active: boolean) => {
    setBusy(true); setError('');
    try {
      const updated = await authorizedRequest<Customer>(`customers/${target.id}/status`, { method: 'PATCH', body: JSON.stringify({ active }) });
      // The status endpoint returns the customer without purchase stats; keep the ones on screen.
      setCustomer((current) => current ? { ...current, ...updated } : current);
    } catch (cause) { setError(customerErrorMessage(cause, 'Status customer gagal diubah.')); }
    finally { setBusy(false); }
  }, [authorizedRequest]);

  const remove = useCallback(async (target: Customer) => {
    setBusy(true); setError('');
    try {
      await authorizedRequest(`customers/${target.id}`, { method: 'DELETE' });
      router.back();
    } catch (cause) { setError(customerErrorMessage(cause, 'Customer gagal dihapus.')); setBusy(false); }
  }, [authorizedRequest]);

  if (loading && !customer) return <View style={styles.center}><ActivityIndicator color="#07956f" /></View>;
  if (!customer) return <View style={styles.center}><Text style={styles.errorText}>{error || 'Customer tidak ditemukan.'}</Text><Pressable accessibilityRole="button" onPress={() => { setLoading(true); setReloadKey((value) => value + 1); }}><Text style={styles.retryText}>Coba lagi</Text></Pressable></View>;

  const confirmStatus = () => Alert.alert(
    customer.active ? 'Nonaktifkan customer?' : 'Aktifkan customer?',
    customer.active ? `${customer.name} tidak akan muncul lagi di pencarian kasir. Riwayat transaksinya tetap tersimpan.` : `${customer.name} akan bisa dipilih lagi di kasir.`,
    [{ text: 'Kembali', style: 'cancel' }, { text: customer.active ? 'Nonaktifkan' : 'Aktifkan', style: customer.active ? 'destructive' : 'default', onPress: () => void setActive(customer, !customer.active) }],
  );
  const confirmDelete = () => Alert.alert(
    'Hapus customer?',
    `${customer.name} akan dihapus dari daftar customer. Riwayat transaksinya tetap tersimpan, dan No. HP-nya bisa didaftarkan lagi.`,
    [{ text: 'Kembali', style: 'cancel' }, { text: 'Hapus', style: 'destructive', onPress: () => void remove(customer) }],
  );
  const actions = [
    can('customer.update') ? <Pressable key="edit" accessibilityRole="button" disabled={busy} onPress={() => setFormVisible(true)} style={[styles.action, busy && styles.disabled]}><Pencil size={16} color="#07885b" /><Text style={styles.actionText}>Ubah</Text></Pressable> : null,
    can('customer.deactivate') ? <Pressable key="status" accessibilityRole="button" disabled={busy} onPress={confirmStatus} style={[styles.action, busy && styles.disabled]}>{customer.active ? <UserX size={16} color="#b0650a" /> : <UserCheck size={16} color="#07885b" />}<Text style={[styles.actionText, customer.active && styles.actionWarnText]}>{customer.active ? 'Nonaktifkan' : 'Aktifkan'}</Text></Pressable> : null,
    can('customer.delete') ? <Pressable key="delete" accessibilityRole="button" disabled={busy} onPress={confirmDelete} style={[styles.action, styles.actionDanger, busy && styles.disabled]}><Trash2 size={16} color="#c0392b" /><Text style={[styles.actionText, styles.actionDangerText]}>Hapus</Text></Pressable> : null,
  ].filter(Boolean);

  const header = <View>
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{customer.name.trim().charAt(0).toUpperCase() || '?'}</Text></View>
        <View style={styles.cardMain}><Text style={styles.name}>{customer.name}</Text><Text style={styles.meta}>Terdaftar {formatDate(customer.createdAt)}</Text></View>
        <Text style={[styles.badge, customer.active ? styles.badgeActive : styles.badgeInactive]}>{customer.active ? 'Aktif' : 'Nonaktif'}</Text>
      </View>
      <View style={styles.info}>
        {customer.branch?.name ? <InfoRow icon={Store} value={customer.branch.name} /> : null}
        <InfoRow icon={Phone} value={customer.phone || 'Tanpa No. HP'} />
        {customer.email ? <InfoRow icon={Mail} value={customer.email} /> : null}
        {customer.address ? <InfoRow icon={MapPin} value={customer.address} /> : null}
        {customer.notes ? <InfoRow icon={StickyNote} value={customer.notes} /> : null}
      </View>
      {actions.length ? <View style={styles.actions}>{actions}</View> : null}
      {busy ? <ActivityIndicator style={styles.busy} color="#07956f" /> : null}
    </View>
    {error ? <Text style={styles.errorBox}>{error}</Text> : null}
    <View style={styles.stats}>
      <View style={styles.stat}><Text style={styles.statLabel}>Transaksi</Text><Text style={styles.statValue}>{customer.transactionCount}</Text></View>
      <View style={styles.stat}><Text style={styles.statLabel}>Total belanja</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{money(customer.totalSpent)}</Text></View>
      <View style={styles.stat}><Text style={styles.statLabel}>Terakhir belanja</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.statValue}>{customer.lastPurchaseAt ? formatDate(customer.lastPurchaseAt) : '—'}</Text></View>
    </View>
    <Text style={styles.sectionTitle}>Riwayat transaksi{history.total ? ` (${history.total})` : ''}</Text>
    {history.error && !history.items.length ? <Pressable accessibilityRole="button" onPress={() => void history.reload()}><Text style={styles.errorBox}>{history.error} Ketuk untuk coba lagi.</Text></Pressable> : null}
    {history.loading ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}
  </View>;

  return <>
    <FlatList
      {...scrollProps}
      style={styles.screen}
      contentContainerStyle={styles.page}
      data={history.loading ? [] : history.items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      ListEmptyComponent={!history.loading && !history.error ? <Text style={styles.empty}>Belum ada transaksi untuk customer ini.</Text> : null}
      ListFooterComponent={<LoadMoreFooter loadingMore={history.loadingMore} hasMore={history.hasMore} count={history.items.length} error={history.error} onRetry={history.loadMore} />}
      refreshControl={<RefreshControl refreshing={history.refreshing} onRefresh={() => { setReloadKey((value) => value + 1); void history.refresh(); }} tintColor="#07956f" />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityHint={canOpenOrder ? 'Buka detail pesanan' : undefined} disabled={!canOpenOrder} onPress={() => router.push({ pathname: '/(app)/orders', params: { orderId: item.id } })} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <View style={styles.cardMain}>
          <View style={styles.rowTitle}><Text numberOfLines={1} style={styles.rowNumber}>{item.orderNumber}</Text><Text style={styles.status}>{formatStatus(item.status)}</Text>{item.isOpenBill && item.status !== 'OPEN' ? <Text style={styles.billTag}>Open Bill</Text> : null}</View>
          <Text numberOfLines={1} style={styles.meta}>{formatDate(item.completedAt ?? item.createdAt)} · {item.itemCount} item{Number(item.refundTotal) > 0 ? ` · refund ${money(item.refundTotal)}` : ''}</Text>
        </View>
        <Text numberOfLines={1} style={styles.rowTotal}>{money(item.netTotal)}</Text>
        {canOpenOrder ? <ChevronRight size={16} color="#8a97a8" /> : null}
      </Pressable>}
    />
    {formVisible ? <CustomerFormSheet
      request={authorizedRequest}
      branchId={customer.branchId}
      customer={customer}
      bottomInset={insets.bottom}
      onClose={() => setFormVisible(false)}
      onSaved={(saved) => { setFormVisible(false); setCustomer(saved); }}
    /> : null}
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f9fb' },
  page: { padding: 16, paddingBottom: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, backgroundColor: '#f7f9fb' },
  card: { padding: 14, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardMain: { flex: 1, minWidth: 0 },
  avatar: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: '#ddf7ed' },
  avatarText: { color: '#07885b', fontSize: 18, fontWeight: '900' },
  name: { color: '#13233a', fontSize: 16, fontWeight: '900' },
  meta: { marginTop: 3, color: '#7a899b', fontSize: 11 },
  info: { gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f3f6' },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  infoText: { flex: 1, color: '#33465c', fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  action: { flexGrow: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#cfeadf', borderRadius: 11, backgroundColor: '#fff' },
  actionText: { color: '#07885b', fontSize: 12, fontWeight: '900' },
  actionWarnText: { color: '#b0650a' },
  actionDanger: { borderColor: '#f3c5c1' },
  actionDangerText: { color: '#c0392b' },
  busy: { marginTop: 10 },
  disabled: { opacity: 0.5 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 10 },
  stat: { flex: 1, minWidth: 0, padding: 11, borderRadius: 14, backgroundColor: '#eefaf4' },
  statLabel: { color: '#4d6a60', fontSize: 10, fontWeight: '600' },
  statValue: { marginTop: 3, color: '#13233a', fontSize: 14, fontWeight: '800' },
  sectionTitle: { marginTop: 18, marginBottom: 8, color: '#13233a', fontSize: 14, fontWeight: '800' },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 14, backgroundColor: '#fff' },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowNumber: { flexShrink: 1, color: '#13233a', fontSize: 12, fontWeight: '800' },
  status: { overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, color: '#087f5b', backgroundColor: '#e7f5ee', fontSize: 9, fontWeight: '900' },
  billTag: { overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, color: '#8a5a08', backgroundColor: '#fff1d9', fontSize: 9, fontWeight: '900' },
  rowTotal: { maxWidth: 130, color: '#13233a', fontSize: 13, fontWeight: '800' },
  badge: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontSize: 10, fontWeight: '800' },
  badgeActive: { color: '#07795a', backgroundColor: '#d9f4e8' },
  badgeInactive: { color: '#b4332d', backgroundColor: '#fde2e0' },
  errorBox: { marginTop: 10, padding: 11, borderRadius: 12, overflow: 'hidden', color: '#a83a32', backgroundColor: '#fff5f4', fontSize: 12 },
  errorText: { color: '#a83a32', fontSize: 12, textAlign: 'center' },
  retryText: { color: '#07956f', fontSize: 12, fontWeight: '800' },
  loader: { paddingVertical: 18 },
  empty: { paddingVertical: 24, color: '#7a899b', fontSize: 12, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
