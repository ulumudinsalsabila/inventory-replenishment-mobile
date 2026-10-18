import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { ChevronDown, Plus, Search, Store, UserCheck, Users, UserX } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/auth-provider';
import { useBranchFilter } from '../../auth/branch-filter';
import { CustomerFormSheet } from '../../components/customer-form';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { OptionSheet } from '../../components/option-sheet';
import { customerErrorMessage, type Customer } from '../../lib/customers';
import { formatDate } from '../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { money } from '../../lib/report';

type Status = 'all' | 'active' | 'inactive';
type Summary = { total: number; active: number; inactive: number };
type IconType = ComponentType<{ size?: number; color?: string }>;

const statusTabs: { id: Status; label: string }[] = [{ id: 'all', label: 'Semua' }, { id: 'active', label: 'Aktif' }, { id: 'inactive', label: 'Nonaktif' }];

function Tile({ label, value, icon: Icon, bg, fg }: { label: string; value: number | undefined; icon: IconType; bg: string; fg: string }) {
  return <View style={[styles.tile, { backgroundColor: bg }]}>
    <View style={styles.tileIcon}><Icon size={17} color={fg} /></View>
    <View style={styles.tileText}><Text style={styles.tileLabel}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.tileValue}>{value ?? '—'}</Text></View>
  </View>;
}

export default function CustomersScreen() {
  const { user, accessToken, authorizedRequest } = useAuth();
  const { branches, selectedBranchId, setSelectedBranchId, locked } = useBranchFilter();
  const insets = useSafeAreaInsets();
  const can = (permission: string) => user?.permissions.includes(permission) ?? false;
  const canRead = can('customer.read');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [status, setStatus] = useState<Status>('all');
  const [branchSheet, setBranchSheet] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [notice, setNotice] = useState('');
  // The summary comes with every page; it is kept from the first page of the current filters.
  const [firstPage, setFirstPage] = useState<{ path: string; summary: Summary } | null>(null);

  const params = new URLSearchParams({ status });
  if (search) params.set('search', search);
  if (!locked && selectedBranchId) params.set('branchId', selectedBranchId);
  const listPath = `customers?${params.toString()}`;
  const allBranches = !locked && !selectedBranchId;
  const branchName = branches.find((branch) => branch.id === selectedBranchId)?.name ?? (locked ? 'Cabang Anda' : 'Semua Cabang');

  const listRequest = useCallback(async <R,>(path: string) => {
    const response = await authorizedRequest<R>(path).catch((cause: unknown) => { throw new Error(customerErrorMessage(cause, 'Data customer belum dapat dimuat.')); });
    const [base, query = ''] = path.split(/&(?=page=)/);
    if (query.startsWith('page=1&')) setFirstPage({ path: base, summary: (response as { summary: Summary }).summary });
    return response;
  }, [authorizedRequest]);
  const list = useInfiniteList<Customer>(listRequest, accessToken && canRead ? listPath : null);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);
  const summary = firstPage?.path === listPath ? firstPage.summary : null;
  const error = list.items.length ? '' : list.error;

  // Customers are edited on the detail route, so reload the list whenever this screen regains focus.
  const reloadList = useRef(list.reload);
  useEffect(() => { reloadList.current = list.reload; }, [list.reload]);
  const focusedBefore = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedBefore.current) void reloadList.current();
    focusedBefore.current = true;
  }, []));

  if (!canRead) return <View style={styles.noAccess}><Text style={styles.noAccessTitle}>Customer tidak tersedia</Text><Text style={styles.noAccessText}>Akun ini belum memiliki izin untuk melihat data customer.</Text></View>;

  const header = <View>
    <Pressable accessibilityRole={locked ? undefined : 'button'} accessibilityLabel={locked ? undefined : `Cabang: ${branchName}. Ketuk untuk mengganti.`} disabled={locked} onPress={() => setBranchSheet(true)} style={({ pressed }) => [styles.branchBar, pressed && styles.pressed]}>
      <View style={styles.branchIcon}><Store size={17} color="#07956f" /></View>
      <View style={styles.cardMain}><Text style={styles.branchLabel}>Cabang</Text><Text numberOfLines={1} style={styles.branchName}>{branchName}</Text></View>
      {!locked ? <ChevronDown size={16} color="#61738a" /> : null}
    </Pressable>
    <View style={styles.grid}>
      <Tile label="Total" value={summary?.total} icon={Users} bg="#eef4ff" fg="#3f6fe0" />
      <Tile label="Aktif" value={summary?.active} icon={UserCheck} bg="#eefaf4" fg="#07956f" />
      <Tile label="Nonaktif" value={summary?.inactive} icon={UserX} bg="#fff1f2" fg="#d6455a" />
    </View>
    <View style={styles.searchBox}><Search size={18} color="#71839a" /><TextInput accessibilityLabel="Cari customer" value={searchInput} onChangeText={setSearchInput} placeholder="Cari nama atau No. HP..." placeholderTextColor="#94a3b4" style={styles.searchInput} returnKeyType="search" autoCorrect={false} /></View>
    <View style={styles.tabs}>{statusTabs.map((item) => {
      const active = status === item.id;
      return <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setStatus(item.id)} style={[styles.tab, active && styles.tabActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text></Pressable>;
    })}</View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {error ? <Pressable accessibilityRole="button" onPress={() => void list.reload()} style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText}>Coba lagi</Text></Pressable> : null}
    {list.loading ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}
  </View>;

  return <>
    <Stack.Screen options={{ headerRight: can('customer.create') ? () => <Pressable accessibilityRole="button" accessibilityLabel="Tambah customer" onPress={() => { setNotice(''); setFormVisible(true); }} style={styles.headerButton}><Plus size={22} color="#07956f" /></Pressable> : undefined }} />
    <FlatList
      {...scrollProps}
      style={styles.screen}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      data={list.loading ? [] : list.items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      ListEmptyComponent={!list.loading && !error ? <Text style={styles.empty}>{search ? `Tidak ada customer yang cocok dengan "${search}".` : status === 'inactive' ? 'Tidak ada customer nonaktif.' : 'Belum ada customer.'}</Text> : null}
      ListFooterComponent={<LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={list.items.length} error={list.error} onRetry={list.loadMore} />}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor="#07956f" />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityHint="Buka detail customer" onPress={() => router.push({ pathname: '/(app)/customer-detail', params: { id: item.id } })} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.cardTop}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.trim().charAt(0).toUpperCase() || '?'}</Text></View>
          <View style={styles.cardMain}>
            <Text numberOfLines={1} style={styles.cardName}>{item.name}</Text>
            <Text numberOfLines={1} style={styles.cardMeta}>{item.phone || 'Tanpa No. HP'}{allBranches && item.branch?.name ? ` · ${item.branch.name}` : ''}</Text>
          </View>
          <Text style={[styles.badge, item.active ? styles.badgeActive : styles.badgeInactive]}>{item.active ? 'Aktif' : 'Nonaktif'}</Text>
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.cardMain}><Text style={styles.cardMeta}>{item.transactionCount} transaksi{item.lastPurchaseAt ? ` · terakhir ${formatDate(item.lastPurchaseAt)}` : ''}</Text></View>
          <Text numberOfLines={1} style={styles.cardTotal}>{money(item.totalSpent)}</Text>
        </View>
      </Pressable>}
    />
    {!locked ? <OptionSheet visible={branchSheet} title="Pilih cabang" selectedId={selectedBranchId} onSelect={setSelectedBranchId} onClose={() => setBranchSheet(false)}
      options={[{ id: '', label: 'Semua Cabang' }, ...branches.map((branch) => ({ id: branch.id, label: branch.name, hint: branch.code }))]} /> : null}
    {formVisible ? <CustomerFormSheet
      request={authorizedRequest}
      branchId={locked ? user?.branchId ?? '' : selectedBranchId}
      branches={branches}
      bottomInset={insets.bottom}
      onClose={() => setFormVisible(false)}
      onSaved={(customer) => { setFormVisible(false); setNotice(`Customer ${customer.name} ditambahkan.`); void list.reload(); }}
    /> : null}
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f9fb' },
  page: { padding: 16, paddingBottom: 28 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  branchBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 14, backgroundColor: '#fff' },
  branchIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#ddf7ed' },
  branchLabel: { color: '#6d7d90', fontSize: 10, fontWeight: '700' },
  branchName: { marginTop: 2, color: '#13233a', fontSize: 13, fontWeight: '800' },
  grid: { flexDirection: 'row', gap: 8, marginTop: 10 },
  tile: { flex: 1, minWidth: 0, minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 15 },
  tileIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#ffffffb3' },
  tileText: { flex: 1, minWidth: 0 },
  tileLabel: { color: '#43566b', fontSize: 11, fontWeight: '600' },
  tileValue: { marginTop: 2, color: '#13233a', fontSize: 16, fontWeight: '800' },
  searchBox: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 13, backgroundColor: '#fff' },
  searchInput: { flex: 1, color: '#13233a', fontSize: 14, paddingVertical: 8 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 12 },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1e7ee', borderRadius: 12, backgroundColor: '#fff' },
  tabActive: { borderColor: '#07956f', backgroundColor: '#07956f' },
  tabText: { color: '#33465c', fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  notice: { marginBottom: 12, padding: 11, borderRadius: 12, overflow: 'hidden', color: '#087c53', backgroundColor: '#e5f8f0', fontSize: 12 },
  errorBox: { marginBottom: 12, padding: 11, borderWidth: 1, borderColor: '#f2c7c4', borderRadius: 12, backgroundColor: '#fff5f4' },
  errorText: { color: '#a83a32', fontSize: 12 },
  retryText: { marginTop: 4, color: '#a83a32', fontSize: 12, fontWeight: '800' },
  loader: { paddingVertical: 18 },
  empty: { paddingVertical: 24, color: '#7a899b', fontSize: 12, textAlign: 'center' },
  card: { marginBottom: 8, padding: 12, borderWidth: 1, borderColor: '#e8edf2', borderRadius: 16, backgroundColor: '#fff' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f0f3f6' },
  cardMain: { flex: 1, minWidth: 0 },
  avatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#ddf7ed' },
  avatarText: { color: '#07885b', fontSize: 14, fontWeight: '900' },
  cardName: { color: '#13233a', fontSize: 13, fontWeight: '800' },
  cardMeta: { marginTop: 3, color: '#7a899b', fontSize: 11 },
  cardTotal: { maxWidth: 140, color: '#13233a', fontSize: 13, fontWeight: '800' },
  badge: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontSize: 10, fontWeight: '800' },
  badgeActive: { color: '#07795a', backgroundColor: '#d9f4e8' },
  badgeInactive: { color: '#b4332d', backgroundColor: '#fde2e0' },
  pressed: { opacity: 0.75 },
  noAccess: { flex: 1, justifyContent: 'center', margin: 16, padding: 20, borderWidth: 1, borderColor: '#e6ece9', borderRadius: 16, backgroundColor: '#fff' },
  noAccessTitle: { color: '#172338', fontSize: 14, fontWeight: '800' },
  noAccessText: { marginTop: 6, color: '#6d7d90', fontSize: 12 },
});
