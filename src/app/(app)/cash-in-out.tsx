import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react-native';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { useAuth } from '../../auth/auth-provider';
import { useBranchFilter } from '../../auth/branch-filter';
import { ApiError } from '../../lib/api';
import { getRange, rangeLabel, rangeOptions, type RangePreset } from '../../lib/date-range';
import { formatDateTime } from '../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { useBottomGap } from '../../lib/responsive';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type Branch = { id: string; name: string; code: string };
type Page<T> = { data: T[]; meta?: { totalPages: number } };
type CashRow = { id: string; amount?: string; type?: 'CASH_IN' | 'CASH_OUT'; category?: string; reason?: string; createdAt?: string; branch?: Branch };
const money = (value?: string | number | null) => `Rp ${Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

export default function CashInOutScreen() {
  const { user, authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomGap = useBottomGap();
  const canRead = user?.permissions.includes('cash_closing.read') ?? false;
  const canCreate = user?.permissions.includes('cash_transaction.create') ?? false;
  const assignedBranchId = user?.branchId ?? null;
  const [branches, setBranches] = useState<Branch[]>([]);
  const { selectedBranchId: branchId, setSelectedBranchId: setBranchId } = useBranchFilter();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CASH_IN' | 'CASH_OUT'>('ALL');
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [branchPickerVisible, setBranchPickerVisible] = useState(false);
  const [error, setError] = useState('');

  const { from, to } = getRange(rangePreset);
  const params = new URLSearchParams({ sortBy: 'createdAt', sortOrder: 'desc', from, to });
  if (search) params.set('search', search);
  if (typeFilter !== 'ALL') params.set('type', typeFilter);
  if (branchId && !assignedBranchId) params.set('branchId', branchId);
  const list = useInfiniteList<CashRow>(authorizedRequest, canRead ? `cash-transactions?${params.toString()}` : null);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);

  // The list reloads itself on refocus (useInfiniteList); the branch list is refreshed here too.
  useFocusEffect(useCallback(() => {
    if (assignedBranchId) return;
    let active = true;
    void authorizedRequest<Page<Branch>>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc')
      .then((result) => { if (!active) return; setBranches(result.data); setError(''); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Data kas belum dapat dimuat.'); });
    return () => { active = false; };
  }, [assignedBranchId, authorizedRequest]));

  const visibleTransactions = list.items;
  const listError = list.items.length ? '' : list.error;

  return <View style={styles.screen}>
    <KeyboardAwareScrollView {...scrollProps} bottomOffset={24} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor="#07885b" />}>
      {!assignedBranchId && branches.length ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(assignedBranchId) }} disabled={Boolean(assignedBranchId)} onPress={() => setBranchPickerVisible(true)} style={[styles.branchPicker, assignedBranchId && styles.branchPickerDisabled]}><View style={styles.branchIcon}><Text style={styles.branchInitial}>{branches.find((branch) => branch.id === branchId)?.name.slice(0, 1) ?? 'C'}</Text></View><View style={styles.branchTextWrap}><Text numberOfLines={1} style={styles.branchName}>{branches.find((branch) => branch.id === branchId)?.name ?? (assignedBranchId ? 'Cabang saya' : 'Semua cabang')}</Text><Text style={styles.branchCode}>{branches.find((branch) => branch.id === branchId)?.code ?? (assignedBranchId ? 'Cabang tetap' : 'Filter cabang')}</Text></View>{assignedBranchId ? null : <ChevronDown size={17} color="#71839a" />}</Pressable> : null}
      <Text style={styles.heading}>Kas masuk / keluar</Text>
      <Text style={styles.subtitle}>Pencatatan transaksi kas per cabang.</Text>
      <View style={styles.rangeControl}>{rangeOptions.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: rangePreset === item.id }} onPress={() => setRangePreset(item.id)} style={[styles.rangeButton, rangePreset === item.id && styles.rangeButtonActive]}><Text style={[styles.rangeText, rangePreset === item.id && styles.rangeTextActive]}>{item.label}</Text></Pressable>)}</View>
      <View style={styles.searchRow}><View style={styles.searchField}><Search size={17} color="#71839a" /><TextInput accessibilityLabel="Cari transaksi kas" value={searchInput} onChangeText={setSearchInput} placeholder="Cari kategori, alasan, atau cabang..." placeholderTextColor="#90a0ad" style={styles.searchInput} returnKeyType="search" /></View></View>
      <View style={styles.filters}>{[{ value: 'ALL', label: 'Semua' }, { value: 'CASH_IN', label: 'Kas masuk' }, { value: 'CASH_OUT', label: 'Kas keluar' }].map((filter) => <Pressable key={filter.value} accessibilityRole="button" accessibilityState={{ selected: typeFilter === filter.value }} onPress={() => setTypeFilter(filter.value as typeof typeFilter)} style={[styles.filter, typeFilter === filter.value && styles.filterActive]}><Text style={[styles.filterText, typeFilter === filter.value && styles.filterTextActive]}>{filter.label}</Text></Pressable>)}</View>
      {error || listError ? <Text style={styles.error}>{error || listError}</Text> : null}
      {list.loading ? <ActivityIndicator style={styles.loader} color="#07885b" size="large" /> : null}
      {canRead ? visibleTransactions.map((row) => <Pressable key={row.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/(app)/cash-in-out-detail', params: { id: row.id } })} style={styles.transactionCard}>
        <View style={[styles.transactionIcon, row.type === 'CASH_IN' ? styles.inIcon : styles.outIcon]}>{row.type === 'CASH_IN' ? <ArrowDownLeft size={18} color="#07885b" /> : <ArrowUpRight size={18} color="#c23a36" />}</View>
        <View style={styles.transactionText}><Text numberOfLines={1} style={styles.transactionTitle}>{row.reason}</Text><Text numberOfLines={1} style={styles.transactionMeta}>{row.type === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'} · {row.category}</Text><Text numberOfLines={1} style={styles.transactionDate}>{formatDateTime(row.createdAt ?? '')}{row.branch?.name ? ` · ${row.branch.name}` : ''}</Text></View>
        <Text style={[styles.amount, row.type === 'CASH_IN' ? styles.inAmount : styles.outAmount]}>{row.type === 'CASH_IN' ? '+' : '-'}{money(row.amount)}</Text><ChevronRight size={16} color="#95a2ad" />
      </Pressable>) : null}
      {canRead ? <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={visibleTransactions.length} error={list.error} onRetry={list.loadMore} /> : null}
      {!list.loading && !listError && canRead && !visibleTransactions.length ? <Text style={styles.empty}>Belum ada transaksi kas untuk periode {rangeLabel(rangePreset).toLowerCase()}.</Text> : null}
      {!canRead && !canCreate ? <View style={styles.noAccess}><Text style={styles.noAccessTitle}>Akses tidak tersedia</Text><Text style={styles.noAccessText}>Akun ini belum memiliki izin untuk kas.</Text></View> : null}
    </KeyboardAwareScrollView>
    {canCreate ? <Pressable accessibilityRole="button" onPress={() => router.push('/(app)/cash-in-out-form')} style={[styles.createButton, { marginBottom: bottomGap }]}><Plus size={17} color="#fff" /><Text style={styles.createButtonText}>Catat kas masuk / keluar</Text></Pressable> : null}
    <Modal visible={branchPickerVisible} transparent animationType="slide" onRequestClose={() => setBranchPickerVisible(false)}><View style={styles.modalBackdrop}><View style={[styles.branchSheet, { paddingBottom: Math.max(insets.bottom + 8, 22) }]}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Pilih cabang</Text><Pressable accessibilityRole="button" accessibilityLabel="Tutup pilihan cabang" onPress={() => setBranchPickerVisible(false)} style={styles.closeButton}><X size={18} color="#53677e" /></Pressable></View><Pressable accessibilityRole="button" accessibilityState={{ selected: !branchId }} onPress={() => { setBranchId(''); setBranchPickerVisible(false); }} style={styles.branchOption}><Text style={styles.branchOptionText}>Semua cabang</Text>{!branchId ? <Check size={17} color="#07885b" /> : null}</Pressable>{branches.map((branch) => <Pressable key={branch.id} accessibilityRole="button" accessibilityState={{ selected: branch.id === branchId }} onPress={() => { setBranchId(branch.id); setBranchPickerVisible(false); }} style={styles.branchOption}><Text style={styles.branchOptionText}>{branch.name} ({branch.code})</Text>{branch.id === branchId ? <Check size={17} color="#07885b" /> : null}</Pressable>)}</View></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' },
  page: { padding: 16, paddingTop: 14, paddingBottom: 12 },
  branchPicker: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' },
  branchPickerDisabled: { opacity: 0.8 },
  branchIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#e4f8ef' },
  branchInitial: { color: '#087f5b', fontSize: 12, fontWeight: '900' },
  branchTextWrap: { flex: 1, minWidth: 0 },
  branchName: { color: '#25364a', fontSize: 10, fontWeight: '900' },
  branchCode: { marginTop: 3, color: '#8191a3', fontSize: 9 },
  heading: { color: '#172338', fontSize: 25, fontWeight: '900' },
  subtitle: { marginTop: 4, color: '#71839a', fontSize: 10 },
  rangeControl: { flexDirection: 'row', gap: 4, marginTop: 14, padding: 4, borderRadius: 11, backgroundColor: '#e9eef1' },
  rangeButton: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  rangeButtonActive: { backgroundColor: '#07885f' },
  rangeText: { color: '#63758b', fontSize: 9, fontWeight: '800' },
  rangeTextActive: { color: '#fff' },
  searchRow: { marginTop: 10 },
  searchField: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderWidth: 1, borderColor: '#dce5eb', borderRadius: 10, backgroundColor: '#fff' },
  searchInput: { flex: 1, minWidth: 0, color: '#25364a', fontSize: 10 },
  filters: { flexDirection: 'row', gap: 7, marginTop: 11, marginBottom: 5 },
  filter: { minHeight: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#edf2f5' },
  filterActive: { backgroundColor: '#07885b' },
  filterText: { color: '#60758a', fontSize: 9, fontWeight: '800' },
  filterTextActive: { color: '#fff' },
  transactionCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8, padding: 10, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' },
  transactionIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  inIcon: { backgroundColor: '#e4f7ee' }, outIcon: { backgroundColor: '#fff0ed' },
  transactionText: { flex: 1, minWidth: 0 },
  transactionTitle: { color: '#25364a', fontSize: 10, fontWeight: '900' },
  transactionMeta: { marginTop: 4, color: '#71839a', fontSize: 9 },
  transactionDate: { marginTop: 3, color: '#91a0ad', fontSize: 9 },
  amount: { maxWidth: 92, fontSize: 10, fontWeight: '900', textAlign: 'right' },
  inAmount: { color: '#07885b' }, outAmount: { color: '#c23a36' },
  createButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginHorizontal: 14, marginTop: 7, borderRadius: 10, backgroundColor: '#07885b' },
  createButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  error: { marginTop: 11, padding: 11, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10 },
  loader: { padding: 22 },
  empty: { marginTop: 18, padding: 16, color: '#8191a3', fontSize: 10, textAlign: 'center' },
  noAccess: { marginTop: 20, padding: 16, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' },
  noAccessTitle: { color: '#25364a', fontSize: 12, fontWeight: '900' },
  noAccessText: { marginTop: 5, color: '#8191a3', fontSize: 10 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  branchSheet: { paddingHorizontal: 16, paddingTop: 15, borderTopLeftRadius: 17, borderTopRightRadius: 17, backgroundColor: '#fff' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { color: '#25364a', fontSize: 12, fontWeight: '900' },
  closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' },
  branchOption: { minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#edf1f4' },
  branchOptionText: { color: '#53677e', fontSize: 11 },
});
