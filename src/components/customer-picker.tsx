import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronLeft, Search, UserPlus, UserRound, X } from 'lucide-react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ApiError } from '../lib/api';
import { customerHint, type CustomerSearchRow, type PosCustomer } from '../lib/customers';
import { useDebouncedValue } from '../lib/infinite-list';
import { CustomerForm, customerSheetStyles } from './customer-form';

type Props = {
  request: <R>(path: string, init?: RequestInit) => Promise<R>;
  /** The POS branch; search results and quick adds are always scoped to it. */
  branchId: string;
  /** Id of the customer currently on the sale, or empty for Guest. */
  selectedId: string;
  /** Shows "Tambah Customer Baru" (customer.create). */
  canCreate: boolean;
  bottomInset: number;
  onSelect: (customer: PosCustomer) => void;
  onGuest: () => void;
  onClose: () => void;
};

const looksLikePhone = (value: string) => /^[\d\s+\-]{4,}$/.test(value);

/** POS customer lookup with quick add; mount it only while it is shown. The cart is never touched here. */
export function CustomerPickerSheet(props: Props) {
  const [mode, setMode] = useState<'search' | 'add'>('search');
  const [searchInput, setSearchInput] = useState('');
  const query = useDebouncedValue(searchInput.trim(), 300);
  // Results are cached per branch and query, so a branch never sees another branch's customers.
  const [cache, setCache] = useState<Record<string, CustomerSearchRow[]>>({});
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { branchId, request } = props;
  const key = `${branchId}\n${query}`;
  const cached = Object.prototype.hasOwnProperty.call(cache, key);

  useEffect(() => {
    if (!branchId || cached) return;
    // `active` drops responses for a query the cashier has already typed past.
    let active = true;
    const params = new URLSearchParams({ branchId, limit: '20' });
    if (query) params.set('q', query);
    void request<CustomerSearchRow[]>(`customers/search?${params.toString()}`)
      .then((result) => { if (active) setCache((current) => ({ ...current, [key]: result })); })
      .catch((cause: unknown) => {
        if (active) setFailure({ key, message: cause instanceof ApiError && cause.status === 403 ? 'Akun ini belum memiliki izin melihat customer.' : cause instanceof Error ? cause.message : 'Customer belum dapat dimuat.' });
      });
    return () => { active = false; };
  }, [branchId, cached, key, query, request, retryKey]);

  const error = failure?.key === key ? failure.message : '';
  const rows = cache[key] ?? [];
  const loading = (!cached && !error) || searchInput.trim() !== query;
  const pick = (customer: PosCustomer) => { props.onSelect(customer); props.onClose(); };
  const quickAddInitial = looksLikePhone(searchInput.trim()) ? { initialPhone: searchInput.trim() } : { initialName: searchInput.trim() };

  return <Modal visible transparent animationType="slide" onRequestClose={mode === 'add' ? () => setMode('search') : props.onClose}>
    <KeyboardAvoidingView behavior="padding" style={customerSheetStyles.backdrop}>
      <View style={[customerSheetStyles.sheet, styles.sheet, { paddingBottom: Math.max(props.bottomInset + 8, 20) }]}>
        <View style={customerSheetStyles.header}>
          {mode === 'add' ? <Pressable accessibilityRole="button" accessibilityLabel="Kembali ke pencarian" onPress={() => setMode('search')} style={customerSheetStyles.close}><ChevronLeft size={20} color="#435a72" /></Pressable> : null}
          <View style={customerSheetStyles.headerText}><Text style={customerSheetStyles.title}>{mode === 'add' ? 'Tambah Customer Baru' : 'Pilih Customer'}</Text><Text style={customerSheetStyles.subtitle}>{mode === 'add' ? 'Customer langsung dipilih untuk pesanan ini.' : 'Cari nama atau No. HP customer cabang ini.'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={props.onClose} style={customerSheetStyles.close}><X size={19} color="#435a72" /></Pressable>
        </View>

        {mode === 'add' ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.addBody}>
          <CustomerForm
            request={props.request}
            branchId={props.branchId}
            variant="quick"
            {...quickAddInitial}
            onSaved={(customer) => pick({ id: customer.id, name: customer.name, phone: customer.phone, transactionCount: 0 })}
            onPickExisting={(customer) => pick({ id: customer.id, name: customer.name, phone: customer.phone })}
          />
        </ScrollView> : <>
          <View style={styles.searchBox}><Search size={18} color="#78889c" /><TextInput accessibilityLabel="Cari customer" autoFocus value={searchInput} onChangeText={setSearchInput} placeholder="Nama atau No. HP..." placeholderTextColor="#8290a2" returnKeyType="search" autoCorrect={false} style={styles.searchInput} />{searchInput ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" hitSlop={8} onPress={() => setSearchInput('')}><X size={17} color="#78889c" /></Pressable> : null}</View>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: !props.selectedId }} onPress={() => { props.onGuest(); props.onClose(); }} style={[styles.row, styles.guestRow, !props.selectedId && styles.rowActive]}>
            <View style={styles.avatar}><UserRound size={18} color="#61738a" /></View>
            <View style={styles.rowText}><Text style={styles.rowName}>Lanjut tanpa customer (Guest)</Text><Text style={styles.rowHint}>Transaksi tidak dicatat ke customer mana pun.</Text></View>
            {!props.selectedId ? <Check size={18} color="#07956f" /> : null}
          </Pressable>
          {error ? <Pressable accessibilityRole="button" onPress={() => { setFailure(null); setRetryKey((value) => value + 1); }}><Text style={styles.error}>{error} Ketuk untuk coba lagi.</Text></Pressable> : null}
          <FlatList
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            data={loading ? [] : rows}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={!loading && rows.length ? <Text style={styles.sectionLabel}>{query ? 'HASIL PENCARIAN' : 'CUSTOMER TERBARU'}</Text> : null}
            ListEmptyComponent={loading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : !error ? <Text style={styles.empty}>{query ? `Tidak ada customer aktif yang cocok dengan "${query}".` : 'Belum ada customer di cabang ini.'}</Text> : null}
            renderItem={({ item }) => {
              const active = item.id === props.selectedId;
              return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${item.name}, ${customerHint(item)}`} onPress={() => pick({ id: item.id, name: item.name, phone: item.phone, transactionCount: item.transactionCount })} style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.pressed]}>
                <View style={[styles.avatar, styles.avatarCustomer]}><Text style={styles.avatarText}>{item.name.trim().charAt(0).toUpperCase() || '?'}</Text></View>
                <View style={styles.rowText}><Text numberOfLines={1} style={styles.rowName}>{item.name}</Text><Text numberOfLines={1} style={styles.rowHint}>{customerHint(item)}</Text></View>
                {active ? <Check size={18} color="#07956f" /> : null}
              </Pressable>;
            }}
          />
          {props.canCreate ? <Pressable accessibilityRole="button" onPress={() => setMode('add')} style={styles.addButton}><UserPlus size={17} color="#fff" /><Text style={styles.addText}>Tambah Customer Baru</Text></Pressable> : null}
        </>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  sheet: { height: '85%' },
  addBody: { paddingBottom: 12 },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e4eaf0', borderRadius: 12, backgroundColor: '#fff' },
  searchInput: { flex: 1, minHeight: 46, color: '#172338', fontSize: 14 },
  list: { flex: 1, marginTop: 4 },
  sectionLabel: { marginTop: 10, marginBottom: 4, color: '#687b91', fontSize: 10, fontWeight: '900' },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#edf1f4', borderRadius: 12 },
  guestRow: { marginTop: 10, borderWidth: 1, borderColor: '#e7edef' },
  rowActive: { borderColor: '#9fdcc5', backgroundColor: '#effbf5' },
  pressed: { backgroundColor: '#f6f9f8' },
  avatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#eef2f5' },
  avatarCustomer: { backgroundColor: '#ddf7ed' },
  avatarText: { color: '#07885b', fontSize: 14, fontWeight: '900' },
  rowText: { flex: 1, minWidth: 0, paddingVertical: 9 },
  rowName: { color: '#172338', fontSize: 13, fontWeight: '800' },
  rowHint: { marginTop: 3, color: '#74869d', fontSize: 11 },
  loader: { padding: 18 },
  empty: { paddingVertical: 18, color: '#75869a', fontSize: 12, textAlign: 'center' },
  error: { marginTop: 10, padding: 10, borderRadius: 9, overflow: 'hidden', color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 11 },
  addButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, borderRadius: 12, backgroundColor: '#07956f' },
  addText: { color: '#fff', fontSize: 13, fontWeight: '900' },
});
