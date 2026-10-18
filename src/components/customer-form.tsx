import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TriangleAlert, UserPlus, X } from 'lucide-react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import type { BranchOption } from '../auth/branch-filter';
import { customerErrorMessage, duplicatePhoneCustomer, isPlausiblePhone, type Customer, type CustomerDuplicates, type CustomerMatch } from '../lib/customers';
import { useDebouncedValue } from '../lib/infinite-list';

type Request = <R>(path: string, init?: RequestInit) => Promise<R>;

/** Exact-phone and similar-name matches in a branch, re-checked while the cashier types. Stale answers are dropped. */
function useCustomerDuplicates(request: Request, branchId: string, name: string, phone: string, excludeId?: string) {
  const query = useDebouncedValue(`${name.trim()}\n${phone.trim()}`, 400);
  const [result, setResult] = useState<{ query: string; value: CustomerDuplicates } | null>(null);
  useEffect(() => {
    const [checkName, checkPhone] = query.split('\n');
    const params = new URLSearchParams();
    if (checkName.length >= 2) params.set('name', checkName);
    if (checkPhone && isPlausiblePhone(checkPhone)) params.set('phone', checkPhone);
    if (!branchId || !params.toString()) return;
    params.set('branchId', branchId);
    if (excludeId) params.set('excludeId', excludeId);
    let active = true;
    void request<CustomerDuplicates>(`customers/check-duplicates?${params.toString()}`)
      .then((value) => { if (active) setResult({ query: `${branchId}\n${query}`, value }); })
      // The check only warns early; saving re-validates on the server, so a failed check is not shown.
      .catch(() => undefined);
    return () => { active = false; };
  }, [branchId, excludeId, query, request]);
  // Only trust a result for the values that are still in the form.
  return result?.query === `${branchId}\n${name.trim()}\n${phone.trim()}` ? result.value : null;
}

type CustomerFormProps = {
  request: Request;
  /** Branch the customer belongs to; empty for head-office users who still have to pick one from `branches`. */
  branchId: string;
  branches?: BranchOption[];
  /** The customer being edited; omitted when creating. */
  customer?: Customer;
  /** `quick` is the POS quick add (name and phone only); `full` also asks for email, address, and notes. */
  variant: 'quick' | 'full';
  initialName?: string;
  initialPhone?: string;
  onSaved: (customer: Customer) => void;
  /** Lets the cashier take an existing (active) customer instead of creating a duplicate. */
  onPickExisting?: (customer: CustomerMatch) => void;
};

/** Create/edit form with an early duplicate check: similar names only warn, an existing phone number blocks saving. */
export function CustomerForm(props: CustomerFormProps) {
  const { customer } = props;
  const [name, setName] = useState(customer?.name ?? props.initialName ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? props.initialPhone ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [chosenBranchId, setChosenBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The customer the server reported for a duplicate phone on save, kept until the phone is edited.
  const [conflict, setConflict] = useState<{ phone: string; match: CustomerMatch } | null>(null);
  const branchId = customer?.branchId ?? (props.branchId || chosenBranchId);
  const duplicates = useCustomerDuplicates(props.request, branchId, name, phone, customer?.id);
  const phoneMatch = conflict?.phone === phone.trim() ? conflict.match : phone.trim() ? duplicates?.phoneMatch ?? null : null;
  const similarNames = (duplicates?.similarNames ?? []).filter((match) => match.id !== phoneMatch?.id);

  const save = async () => {
    if (!name.trim()) { setError('Nama customer wajib diisi.'); return; }
    if (phone.trim() && !isPlausiblePhone(phone)) { setError('No. HP tidak valid. Gunakan format 08…, 628…, atau +62 8….'); return; }
    if (props.variant === 'full' && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Format email tidak valid.'); return; }
    if (!branchId) { setError('Pilih cabang customer terlebih dahulu.'); return; }
    if (phoneMatch) return;
    setSaving(true); setError('');
    const fields = { name: name.trim(), phone: phone.trim(), ...(props.variant === 'full' ? { email: email.trim(), address: address.trim(), notes: notes.trim() } : {}) };
    try {
      const saved = customer
        ? { ...customer, ...await props.request<Customer>(`customers/${customer.id}`, { method: 'PATCH', body: JSON.stringify(fields) }) }
        : await props.request<Customer>('customers', { method: 'POST', body: JSON.stringify({ ...fields, branchId }) });
      props.onSaved(saved);
    } catch (cause) {
      const match = duplicatePhoneCustomer(cause);
      if (match) setConflict({ phone: phone.trim(), match });
      setError(match ? '' : customerErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const pickable = (match: CustomerMatch) => match.active && Boolean(props.onPickExisting);
  return <View>
    {!customer && !props.branchId && props.branches?.length ? <>
      <Text style={styles.label}>CABANG *</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.branchChoices}>{props.branches.map((branch) => {
        const active = branch.id === chosenBranchId;
        return <Pressable key={branch.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setChosenBranchId(branch.id)} style={[styles.branchChip, active && styles.branchChipActive]}><Text numberOfLines={1} style={[styles.branchChipText, active && styles.branchChipTextActive]}>{branch.name}</Text></Pressable>;
      })}</ScrollView>
    </> : null}
    <Text style={styles.label}>NAMA CUSTOMER *</Text>
    <TextInput accessibilityLabel="Nama customer" autoFocus={!name} value={name} onChangeText={(value) => { setName(value); setError(''); }} maxLength={100} placeholder="Nama customer" placeholderTextColor="#8a97a8" style={styles.input} />
    {similarNames.length ? <View style={styles.warning}>
      <View style={styles.warningHeader}><TriangleAlert size={15} color="#8a5a08" /><Text style={styles.warningText}>Sudah ada customer dengan nama mirip. Pastikan bukan orang yang sama.</Text></View>
      {similarNames.map((match) => <View key={match.id} style={styles.matchRow}>
        <View style={styles.matchText}><Text numberOfLines={1} style={styles.matchName}>{match.name}{match.active ? '' : ' (nonaktif)'}</Text><Text numberOfLines={1} style={styles.matchHint}>{match.phone || 'Tanpa No. HP'}</Text></View>
        {pickable(match) ? <Pressable accessibilityRole="button" accessibilityLabel={`Pilih ${match.name}`} onPress={() => props.onPickExisting?.(match)} style={styles.matchButton}><Text style={styles.matchButtonText}>Pilih</Text></Pressable> : null}
      </View>)}
    </View> : null}
    <Text style={styles.label}>NO. HP</Text>
    <TextInput accessibilityLabel="Nomor HP customer" value={phone} onChangeText={(value) => { setPhone(value); setError(''); }} maxLength={20} keyboardType="phone-pad" placeholder="08xxxxxxxxxx (opsional)" placeholderTextColor="#8a97a8" style={styles.input} />
    {phoneMatch ? <View style={styles.blocking}>
      <Text style={styles.blockingText}>No. HP ini sudah terdaftar atas nama {phoneMatch.name}{phoneMatch.active ? '' : ' (nonaktif)'} di cabang ini.{pickable(phoneMatch) ? '' : ' Gunakan No. HP lain atau kosongkan.'}</Text>
      {pickable(phoneMatch) ? <Pressable accessibilityRole="button" onPress={() => props.onPickExisting?.(phoneMatch)} style={styles.blockingButton}><Text style={styles.blockingButtonText}>Pilih customer ini</Text></Pressable> : null}
    </View> : null}
    {props.variant === 'full' ? <>
      <Text style={styles.label}>EMAIL</Text>
      <TextInput accessibilityLabel="Email customer" value={email} onChangeText={setEmail} maxLength={120} keyboardType="email-address" autoCapitalize="none" placeholder="Opsional" placeholderTextColor="#8a97a8" style={styles.input} />
      <Text style={styles.label}>ALAMAT</Text>
      <TextInput accessibilityLabel="Alamat customer" value={address} onChangeText={setAddress} maxLength={300} multiline placeholder="Opsional" placeholderTextColor="#8a97a8" style={[styles.input, styles.multiline]} />
      <Text style={styles.label}>CATATAN</Text>
      <TextInput accessibilityLabel="Catatan customer" value={notes} onChangeText={setNotes} maxLength={500} multiline placeholder="Opsional" placeholderTextColor="#8a97a8" style={[styles.input, styles.multiline]} />
    </> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={saving || Boolean(phoneMatch)} onPress={() => void save()} style={[styles.primaryButton, (saving || phoneMatch) && styles.disabled]}>
      {saving ? <ActivityIndicator color="#fff" /> : <><UserPlus size={16} color="#fff" /><Text style={styles.primaryText}>{customer ? 'Simpan Perubahan' : props.variant === 'quick' ? 'Simpan & Pilih' : 'Simpan Customer'}</Text></>}
    </Pressable>
  </View>;
}

/** Bottom sheet around CustomerForm for the Customer screen; mount it only while it is shown. */
export function CustomerFormSheet({ bottomInset, onClose, ...form }: Omit<CustomerFormProps, 'variant'> & { bottomInset: number; onClose: () => void }) {
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
      <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset + 8, 20) }]}>
        <View style={styles.header}>
          <View style={styles.headerText}><Text style={styles.title}>{form.customer ? 'Ubah customer' : 'Tambah customer'}</Text><Text style={styles.subtitle}>{form.customer ? form.customer.branch?.name ?? '' : 'Customer terdaftar di satu cabang.'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={onClose} style={styles.close}><X size={19} color="#435a72" /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <CustomerForm {...form} variant="full" />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

export const customerSheetStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  sheet: { maxHeight: '90%', paddingHorizontal: 16, paddingTop: 16, borderTopLeftRadius: 19, borderTopRightRadius: 19, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: '#172338', fontSize: 15, fontWeight: '900' },
  subtitle: { marginTop: 3, color: '#71839a', fontSize: 11 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f0f4f7' },
});

const styles = StyleSheet.create({
  ...customerSheetStyles,
  body: { paddingBottom: 8 },
  label: { marginTop: 12, marginBottom: 6, color: '#687b91', fontSize: 10, fontWeight: '900' },
  input: { minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 11, color: '#172338', fontSize: 13, fontWeight: '700' },
  multiline: { minHeight: 70, paddingTop: 11, textAlignVertical: 'top' },
  branchChoices: { gap: 7 },
  branchChip: { maxWidth: 160, minHeight: 40, justifyContent: 'center', paddingHorizontal: 13, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 11, backgroundColor: '#fff' },
  branchChipActive: { borderColor: '#07956f', backgroundColor: '#07956f' },
  branchChipText: { color: '#536a80', fontSize: 12, fontWeight: '800' },
  branchChipTextActive: { color: '#fff' },
  warning: { gap: 6, marginTop: 8, padding: 10, borderWidth: 1, borderColor: '#f6d79b', borderRadius: 11, backgroundColor: '#fff8e8' },
  warningHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  warningText: { flex: 1, color: '#8a5a08', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  matchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f3e2bf' },
  matchText: { flex: 1, minWidth: 0 },
  matchName: { color: '#26344a', fontSize: 12, fontWeight: '800' },
  matchHint: { marginTop: 2, color: '#7a6a4b', fontSize: 11 },
  matchButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#9bd9bf' },
  matchButtonText: { color: '#07885b', fontSize: 12, fontWeight: '900' },
  blocking: { gap: 8, marginTop: 8, padding: 10, borderWidth: 1, borderColor: '#f3c5c1', borderRadius: 11, backgroundColor: '#fff1ef' },
  blockingText: { color: '#a3332a', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  blockingButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#07956f' },
  blockingButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  error: { marginTop: 10, padding: 10, borderRadius: 9, overflow: 'hidden', color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 11, lineHeight: 16 },
  primaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 14, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#07956f' },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.5 },
});
