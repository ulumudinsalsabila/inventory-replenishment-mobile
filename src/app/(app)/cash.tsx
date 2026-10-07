import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatStatus } from '../../lib/display';

type Branch = { id: string; name: string; code: string };
type Page<T> = { data: T[]; meta?: { totalPages: number } };
type CashRow = { id: string; amount?: string; type?: string; category?: string; reason?: string; closingNumber?: string; expectedCash?: string; actualCash?: string; difference?: string; status?: string; createdAt?: string; closedAt?: string; branch?: Branch };
type Preview = { expectedCash: string; cashSales: string; cashIn: string; cashOut: string; cashRefund: string; transactionCount: number; periodStart: string | null };
const money = (value?: string | number | null) => `Rp ${Number(value ?? 0).toLocaleString('id-ID')}`;

export default function CashScreen() {
  const { user, authorizedRequest } = useAuth();
  const canRead = user?.permissions.includes('cash_closing.read') ?? false;
  const canTransact = user?.permissions.includes('cash_transaction.create') ?? false;
  const canClose = user?.permissions.includes('cash_closing.create') ?? false;
  const assignedBranchId = user?.branchId ?? null;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(user?.branchId ?? '');
  const [transactions, setTransactions] = useState<CashRow[]>([]);
  const [closings, setClosings] = useState<CashRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [type, setType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const branchResult = assignedBranchId ? { data: [] as Branch[] } : await authorizedRequest<Page<Branch>>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc');
      const availableBranches = assignedBranchId ? [] : branchResult.data;
      setBranches(availableBranches);
      const selectedBranch = assignedBranchId ?? branchId ?? availableBranches[0]?.id ?? '';
      setBranchId(selectedBranch);
      const jobs: Promise<unknown>[] = [];
      if (canRead) jobs.push(authorizedRequest<Page<CashRow>>('cash-transactions?page=1&perPage=10').then((r) => setTransactions(r.data)), authorizedRequest<Page<CashRow>>('cash-closings?page=1&perPage=10').then((r) => setClosings(r.data)));
      if (canClose && selectedBranch) jobs.push(authorizedRequest<Preview>(`cash-closing/preview?branchId=${encodeURIComponent(selectedBranch)}`).then(setPreview));
      await Promise.all(jobs);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Data kas belum dapat dimuat.'); }
    finally { setLoading(false); }
  }, [authorizedRequest, assignedBranchId, branchId, canClose, canRead]);

  // Refresh when the route opens and after each successful cash mutation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load, reload]);

  const submitTransaction = async () => {
    if (!branchId || !category.trim() || !reason.trim() || !(Number(amount) > 0)) return setError('Cabang, kategori, jumlah positif, dan alasan wajib diisi.');
    setSaving(true); setError('');
    try {
      await authorizedRequest('cash-transactions', { method: 'POST', body: JSON.stringify({ branchId, type, category: category.trim(), amount, reason: reason.trim() }) });
      setCategory(''); setAmount(''); setReason(''); setReload((n) => n + 1);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Transaksi kas gagal disimpan.'); }
    finally { setSaving(false); }
  };

  const submitClosing = async () => {
    if (!branchId || actualCash === '' || Number(actualCash) < 0) return setError('Pilih cabang dan masukkan jumlah kas aktual.');
    setSaving(true); setError('');
    try {
      await authorizedRequest('cash-closing', { method: 'POST', body: JSON.stringify({ branchId, actualCash, ...(note.trim() ? { note: note.trim() } : {}) }) });
      setActualCash(''); setNote(''); setReload((n) => n + 1);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Penutupan kas gagal disimpan.'); }
    finally { setSaving(false); }
  };

  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => setReload((n) => n + 1)} tintColor="#087f5b" />}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹  Operasional</Text></Pressable>
    <Text style={styles.eyebrow}>KONTROL KAS</Text><Text style={styles.title}>Kas masuk / keluar</Text><Text style={styles.subtitle}>Catat pergerakan kas dan rekonsiliasi hasil penjualan.</Text>
    {branches.length ? <View style={styles.card}><Text style={styles.label}>Cabang</Text><View style={styles.chips}>{branches.map((b) => <Pressable key={b.id} onPress={() => setBranchId(b.id)} style={[styles.chip, branchId === b.id && styles.chipActive]}><Text style={[styles.chipText, branchId === b.id && styles.chipTextActive]}>{b.name}</Text></Pressable>)}</View></View> : null}
    {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
    {loading ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : null}
    {canTransact ? <View style={styles.card}><Text style={styles.section}>Catat kas</Text><View style={styles.chips}>{(['CASH_IN', 'CASH_OUT'] as const).map((v) => <Pressable key={v} accessibilityRole="button" onPress={() => setType(v)} style={[styles.chip, type === v && styles.chipActive]}><Text style={[styles.chipText, type === v && styles.chipTextActive]}>{v === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'}</Text></Pressable>)}</View>
      <TextInput accessibilityLabel="Kategori" placeholder="Kategori, mis. setoran" value={category} onChangeText={setCategory} style={styles.input} /><TextInput accessibilityLabel="Jumlah" placeholder="Jumlah rupiah" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} style={styles.input} /><TextInput accessibilityLabel="Alasan" placeholder="Alasan transaksi" value={reason} onChangeText={setReason} style={[styles.input, styles.multiline]} multiline />
      <Pressable accessibilityRole="button" disabled={saving} onPress={() => void submitTransaction()} style={[styles.primary, saving && styles.dim]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Simpan transaksi kas</Text>}</Pressable>
    </View> : null}
    {canClose ? <View style={styles.card}><Text style={styles.section}>Penutupan kas</Text>{preview ? <><Text style={styles.expected}>Kas seharusnya  {money(preview.expectedCash)}</Text><Text style={styles.detail}>Penjualan tunai {money(preview.cashSales)}  ·  Masuk {money(preview.cashIn)}  ·  Keluar {money(preview.cashOut)}  ·  Refund {money(preview.cashRefund)}</Text><Text style={styles.detail}>{preview.transactionCount} catatan belum ditutup</Text></> : <Text style={styles.detail}>Pilih cabang untuk melihat ringkasan.</Text>}
      <TextInput accessibilityLabel="Kas aktual" placeholder="Kas aktual dihitung" keyboardType="decimal-pad" value={actualCash} onChangeText={setActualCash} style={styles.input} /><TextInput accessibilityLabel="Catatan penutupan" placeholder="Catatan (opsional)" value={note} onChangeText={setNote} style={styles.input} />
      <Pressable accessibilityRole="button" disabled={saving || !preview?.transactionCount} onPress={() => void submitClosing()} style={[styles.primary, (saving || !preview?.transactionCount) && styles.dim]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Tutup kas</Text>}</Pressable>
    </View> : null}
    {canRead ? <><Text style={styles.sectionTitle}>Transaksi terbaru</Text>{transactions.length ? transactions.map((row) => <View key={row.id} style={styles.row}><View style={styles.rowText}><Text style={styles.rowTitle}>{row.category} · {row.type === 'CASH_IN' ? 'Masuk' : 'Keluar'}</Text><Text style={styles.detail}>{row.reason}</Text></View><Text style={styles.rowAmount}>{money(row.amount)}</Text></View>) : <Text style={styles.empty}>Belum ada transaksi kas.</Text>}
      <Text style={styles.sectionTitle}>Penutupan terbaru</Text>{closings.length ? closings.map((row) => <View key={row.id} style={styles.row}><View style={styles.rowText}><Text style={styles.rowTitle}>{row.closingNumber} · {formatStatus(row.status ?? '-')}</Text><Text style={styles.detail}>Aktual {money(row.actualCash)} · Seharusnya {money(row.expectedCash)}</Text></View><Text style={[styles.rowAmount, { color: Number(row.difference) === 0 ? '#087f5b' : '#aa6b00' }]}>{money(row.difference)}</Text></View>) : <Text style={styles.empty}>Belum ada penutupan kas.</Text>}</> : null}
  </ScrollView></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 20, paddingTop: 18, paddingBottom: 36 }, back: { alignSelf: 'flex-start', marginBottom: 20 }, backText: { color: '#087f5b', fontSize: 13, fontWeight: '800' }, eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '800' }, subtitle: { marginTop: 5, color: '#718078', fontSize: 12 }, card: { marginTop: 16, padding: 15, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 16, backgroundColor: '#fff' }, section: { marginBottom: 11, color: '#26372e', fontSize: 15, fontWeight: '900' }, label: { marginBottom: 8, color: '#718078', fontSize: 11, fontWeight: '700' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11, backgroundColor: '#f1f4f2' }, chipActive: { backgroundColor: '#e7f5ee' }, chipText: { color: '#68766e', fontSize: 11, fontWeight: '800' }, chipTextActive: { color: '#087f5b' }, input: { minHeight: 45, marginTop: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, backgroundColor: '#fff', color: '#26372e', fontSize: 12 }, multiline: { minHeight: 72, paddingTop: 12, textAlignVertical: 'top' }, primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 11, borderRadius: 12, backgroundColor: '#087f5b' }, primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' }, dim: { opacity: 0.55 }, expected: { color: '#087f5b', fontSize: 17, fontWeight: '900' }, detail: { marginTop: 5, color: '#79867f', fontSize: 10, lineHeight: 15 }, sectionTitle: { marginTop: 23, marginBottom: 8, color: '#26372e', fontSize: 15, fontWeight: '900' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7, padding: 13, borderRadius: 13, backgroundColor: '#fff' }, rowText: { flex: 1, paddingRight: 8 }, rowTitle: { color: '#26372e', fontSize: 12, fontWeight: '800' }, rowAmount: { color: '#26372e', fontSize: 12, fontWeight: '900' }, empty: { padding: 16, borderRadius: 13, backgroundColor: '#fff', color: '#84918b', fontSize: 11 }, error: { marginTop: 13, padding: 12, borderRadius: 12, backgroundColor: '#fff1ef' }, errorText: { color: '#a3332a', fontSize: 11 }, loader: { padding: 14 } });
