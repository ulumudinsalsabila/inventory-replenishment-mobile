import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/auth-provider';

type OrderLine = { id: string; productNameSnapshot: string; variantNameSnapshot?: string | null; quantity: string; totalPrice: string; addons?: { addonNameSnapshot: string; quantity: string }[] };
type Order = { id: string; orderNumber: string; status: string; grandTotal: string; createdAt: string; branch?: { name: string }; items?: OrderLine[]; payments?: { method: string; amount: string; status: string }[]; refunds?: { refundNumber?: string; amount: string; reason: string; createdAt: string; items?: { orderItemId: string; quantity: string }[] }[] };
type PageResult = { data: Order[]; meta: { page: number; perPage: number; total: number; totalPages: number } };
const money = (value: string) => `Rp ${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const paymentMethods = ['CASH', 'QRIS', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'];

export default function OrdersScreen() {
  const { authorizedRequest, user } = useAuth();
  const [result, setResult] = useState<PageResult | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [returnToStock, setReturnToStock] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState('');

  const loadOrders = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page), perPage: '20', sortBy: 'createdAt', sortOrder: 'desc' });
      if (search.trim()) params.set('search', search.trim());
      setResult(await authorizedRequest<PageResult>(`orders?${params.toString()}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat pesanan.'); }
    finally { setLoading(false); }
  }, [authorizedRequest, page, search]);

  // Fetching is intentionally started when the query parameters change.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadOrders(); }, [loadOrders]);

  async function openOrder(order: Order) {
    setSelected(order);
    try { setSelected(await authorizedRequest<Order>(`orders/${order.id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat detail pesanan.'); }
  }

  const refundedAmount = (selected?.refunds ?? []).reduce((total, refund) => total + Number(refund.amount), 0);
  const refundableAmount = Math.max(0, Number(selected?.grandTotal ?? 0) - refundedAmount);
  const canRefund = Boolean(user?.permissions.includes('order.refund') && selected && ['COMPLETED', 'PARTIALLY_REFUNDED'].includes(selected.status) && refundableAmount > 0);
  const alreadyReturned = (lineId: string) => (selected?.refunds ?? []).flatMap((refund) => refund.items ?? []).filter((item) => item.orderItemId === lineId).reduce((total, item) => total + Number(item.quantity), 0);

  async function submitRefund() {
    if (!selected) return;
    setRefundError('');
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > refundableAmount) { setRefundError(`Nominal harus lebih dari 0 dan maksimal ${money(String(refundableAmount))}.`); return; }
    if (!refundReason.trim()) { setRefundError('Alasan pengembalian wajib diisi.'); return; }
    const items = Object.entries(returnQuantities).filter(([, quantity]) => Number(quantity) > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (returnToStock && !items.length) { setRefundError('Isi jumlah item yang dikembalikan ke stok.'); return; }
    setRefunding(true);
    try {
      await authorizedRequest(`orders/${selected.id}/refund`, { method: 'POST', body: JSON.stringify({ method: refundMethod, amount: amount.toFixed(2), reason: refundReason.trim(), returnToStock, ...(returnToStock ? { items } : {}) }) });
      setRefundAmount(''); setRefundReason(''); setReturnToStock(false); setReturnQuantities({});
      setSelected(await authorizedRequest<Order>(`orders/${selected.id}`));
      await loadOrders();
    } catch (e) { setRefundError(e instanceof Error ? e.message : 'Pengembalian gagal diproses.'); }
    finally { setRefunding(false); }
  }

  if (selected) return <ScrollView style={styles.screen} contentContainerStyle={styles.page}>
    <Pressable style={styles.back} onPress={() => setSelected(null)}><Text style={styles.backText}>‹  Kembali ke pesanan</Text></Pressable>
    <Text style={styles.eyebrow}>DETAIL PESANAN</Text><Text style={styles.title}>{selected.orderNumber}</Text>
    <View style={styles.card}><View style={styles.row}><Text style={styles.muted}>Status</Text><Text style={styles.status}>{selected.status}</Text></View><View style={styles.row}><Text style={styles.muted}>Cabang</Text><Text style={styles.value}>{selected.branch?.name ?? '—'}</Text></View><View style={styles.row}><Text style={styles.muted}>Waktu</Text><Text style={styles.value}>{new Date(selected.createdAt).toLocaleString('id-ID')}</Text></View><View style={styles.row}><Text style={styles.muted}>Total</Text><Text style={styles.total}>{money(selected.grandTotal)}</Text></View></View>
    <Text style={styles.sectionTitle}>Item pesanan</Text>
    {(selected.items ?? []).map((item) => <View key={item.id} style={styles.line}><View style={styles.flex}><Text style={styles.value}>{item.productNameSnapshot}{item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ''}</Text><Text style={styles.muted}>{item.quantity} item</Text>{item.addons?.map((addon, i) => <Text key={`${item.id}-${i}`} style={styles.muted}>+ {addon.addonNameSnapshot} × {addon.quantity}</Text>)}</View><Text style={styles.value}>{money(item.totalPrice)}</Text></View>)}
    <Text style={styles.sectionTitle}>Pembayaran</Text>
    {(selected.payments ?? []).map((payment, i) => <View key={`${payment.method}-${i}`} style={styles.line}><Text style={styles.value}>{payment.method} · {payment.status}</Text><Text style={styles.value}>{money(payment.amount)}</Text></View>)}
    {(selected.refunds?.length ?? 0) > 0 ? <><Text style={styles.sectionTitle}>Pengembalian</Text>{selected.refunds?.map((refund, i) => <View key={`${refund.refundNumber ?? i}`} style={styles.line}><View style={styles.flex}><Text style={styles.value}>{refund.refundNumber ?? 'Refund'}</Text><Text style={styles.muted}>{refund.reason}</Text></View><Text style={styles.value}>{money(refund.amount)}</Text></View>)}</> : null}
    {canRefund ? <View style={styles.refundCard}>
      <Text style={styles.sectionTitle}>Proses pengembalian</Text><Text style={styles.muted}>Sisa yang dapat dikembalikan: {money(String(refundableAmount))}</Text>
      <Text style={styles.fieldLabel}>Nominal</Text><TextInput accessibilityLabel="Nominal pengembalian" keyboardType="decimal-pad" style={styles.input} value={refundAmount} onChangeText={setRefundAmount} placeholder={String(refundableAmount)} placeholderTextColor="#87948c" />
      <Text style={styles.fieldLabel}>Metode pengembalian</Text><View style={styles.methodRow}>{paymentMethods.map((method) => <Pressable key={method} onPress={() => setRefundMethod(method)} style={[styles.method, refundMethod === method && styles.methodSelected]}><Text style={[styles.methodText, refundMethod === method && styles.methodTextSelected]}>{method.replace('_', ' ')}</Text></Pressable>)}</View>
      <Text style={styles.fieldLabel}>Alasan</Text><TextInput accessibilityLabel="Alasan pengembalian" style={[styles.input, styles.multiline]} value={refundReason} onChangeText={setRefundReason} placeholder="Tuliskan alasan" placeholderTextColor="#87948c" multiline />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: returnToStock }} onPress={() => setReturnToStock((value) => !value)} style={styles.checkRow}><View style={[styles.checkbox, returnToStock && styles.checkboxChecked]}><Text style={styles.checkMark}>{returnToStock ? '✓' : ''}</Text></View><Text style={styles.value}>Kembalikan item ke stok</Text></Pressable>
      {returnToStock ? (selected.items ?? []).map((item) => { const max = Math.max(0, Number(item.quantity) - alreadyReturned(item.id)); return <View key={item.id} style={styles.returnLine}><Text style={[styles.value, styles.flex]}>{item.productNameSnapshot} (sisa {max})</Text><TextInput accessibilityLabel={`Jumlah retur ${item.productNameSnapshot}`} keyboardType="decimal-pad" style={styles.quantityInput} value={returnQuantities[item.id] ?? ''} onChangeText={(value) => setReturnQuantities((current) => ({ ...current, [item.id]: value }))} placeholder="0" placeholderTextColor="#87948c" /></View>; }) : null}
      {refundError ? <Text style={styles.errorText}>{refundError}</Text> : null}
      <Pressable accessibilityRole="button" disabled={refunding} onPress={() => void submitRefund()} style={[styles.refundButton, refunding && styles.disabled]}>{refunding ? <ActivityIndicator color="#fff" /> : <Text style={styles.refundButtonText}>Simpan pengembalian</Text>}</Pressable>
    </View> : null}
  </ScrollView>;

  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>OPERASIONAL</Text><Text style={styles.title}>Pesanan</Text><Text style={styles.subtitle}>Riwayat transaksi dan rincian pembayaran.</Text>
    <TextInput style={styles.search} value={search} onChangeText={(value) => { setSearch(value); setPage(1); }} placeholder="Cari nomor pesanan" placeholderTextColor="#87948c" autoCapitalize="characters" />
    {loading ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : null}
    {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void loadOrders()}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
    {(result?.data ?? []).map((order) => <Pressable key={order.id} onPress={() => void openOrder(order)} style={({ pressed }) => [styles.orderCard, pressed && styles.pressed]}><View style={styles.row}><Text style={styles.orderNumber}>{order.orderNumber}</Text><Text style={styles.status}>{order.status}</Text></View><Text style={styles.muted}>{order.branch?.name ?? 'Cabang'} · {new Date(order.createdAt).toLocaleString('id-ID')}</Text><View style={[styles.row, styles.orderFooter]}><Text style={styles.total}>{money(order.grandTotal)}</Text><Text style={styles.detailLink}>Lihat detail  ›</Text></View></Pressable>)}
    {!loading && !error && !result?.data.length ? <View style={styles.empty}><Text style={styles.value}>Belum ada pesanan</Text><Text style={styles.muted}>Transaksi akan muncul di sini setelah dibuat.</Text></View> : null}
    <View style={styles.pagination}><Pressable disabled={page <= 1 || loading} onPress={() => setPage((p) => Math.max(1, p - 1))} style={[styles.pageButton, (page <= 1 || loading) && styles.disabled]}><Text style={styles.pageButtonText}>‹ Sebelumnya</Text></Pressable><Text style={styles.muted}>Halaman {result?.meta.page ?? page} dari {result?.meta.totalPages ?? 1}</Text><Pressable disabled={page >= (result?.meta.totalPages ?? 1) || loading} onPress={() => setPage((p) => p + 1)} style={[styles.pageButton, (page >= (result?.meta.totalPages ?? 1) || loading) && styles.disabled]}><Text style={styles.pageButtonText}>Berikutnya ›</Text></Pressable></View>
  </ScrollView></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 18, paddingBottom: 35 }, eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '900' }, subtitle: { marginTop: 5, marginBottom: 14, color: '#718078', fontSize: 12 }, search: { height: 46, marginBottom: 12, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff', color: '#172820' }, loader: { margin: 18 }, orderCard: { marginBottom: 9, padding: 14, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 15, backgroundColor: '#fff' }, pressed: { borderColor: '#a8d7c2', backgroundColor: '#f7fcf9' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, orderNumber: { color: '#172820', fontSize: 14, fontWeight: '900' }, status: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#e7f5ee', color: '#087f5b', fontSize: 9, fontWeight: '900' }, muted: { marginTop: 5, color: '#84918b', fontSize: 10 }, value: { color: '#34453b', fontSize: 12, fontWeight: '700' }, total: { color: '#087f5b', fontSize: 15, fontWeight: '900' }, orderFooter: { marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#edf1ee' }, detailLink: { color: '#087f5b', fontSize: 11, fontWeight: '800' }, empty: { alignItems: 'center', marginTop: 14, padding: 22, borderRadius: 15, backgroundColor: '#fff' }, pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, pageButton: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: '#e7f5ee' }, pageButtonText: { color: '#087f5b', fontSize: 10, fontWeight: '800' }, disabled: { opacity: 0.4 }, errorBox: { padding: 13, borderRadius: 13, backgroundColor: '#fff1f0' }, errorText: { color: '#a3332a', fontSize: 11 }, retry: { marginTop: 8, color: '#087f5b', fontSize: 11, fontWeight: '900' }, card: { marginTop: 16, padding: 14, borderRadius: 15, backgroundColor: '#fff' }, sectionTitle: { marginTop: 19, marginBottom: 7, color: '#172820', fontSize: 14, fontWeight: '900' }, line: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#e8eeea' }, flex: { flex: 1 }, back: { marginBottom: 18 }, backText: { color: '#087f5b', fontSize: 12, fontWeight: '800' }, refundCard: { marginTop: 20, padding: 14, borderRadius: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6ece8' }, fieldLabel: { marginTop: 13, marginBottom: 6, color: '#34453b', fontSize: 11, fontWeight: '800' }, input: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, color: '#172820', backgroundColor: '#fff' }, multiline: { minHeight: 76, paddingTop: 11, textAlignVertical: 'top' }, methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, method: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f1f5f2' }, methodSelected: { backgroundColor: '#e7f5ee' }, methodText: { color: '#718078', fontSize: 9, fontWeight: '800' }, methodTextSelected: { color: '#087f5b' }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16, minHeight: 44 }, checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#b8c8bf', borderRadius: 6 }, checkboxChecked: { borderColor: '#087f5b', backgroundColor: '#087f5b' }, checkMark: { color: '#fff', fontWeight: '900' }, returnLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }, quantityInput: { width: 74, height: 40, textAlign: 'center', borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, color: '#172820' }, refundButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 13, borderRadius: 12, backgroundColor: '#087f5b' }, refundButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' } });
