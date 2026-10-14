import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { Check, ChevronLeft, ChevronRight, Download, Package, Plus, Search, X } from 'lucide-react-native';
import * as Print from 'expo-print';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatDate, formatStatus } from '../../lib/display';
import { DistributorPurchaseWizard } from '../../components/distributor-purchase-wizard';

type Purchase = {
  id: string;
  status: string;
  invoiceNumber: string | null;
  distributorInvoiceNumber: string | null;
  purchaseDate: string;
  subtotal: string | number;
  discountAmount: string | number;
  additionalCost: string | number;
  grandTotal: string | number;
  distributor: { id: string; name: string };
  warehouse: { id: string; name: string; code: string };
  _count: { items: number; attachments: number };
};
type PurchaseDetail = Purchase & {
  note: string | null;
  items: { id: string; lineType: string; orderedQty: string; receivedQty: string | null; unitPrice: string; subtotal: string; product: { sku: string; name: string }; unit?: { code: string } | null }[];
  attachments?: { id: string; url: string; fileName: string; createdAt: string }[];
};
type Page<T> = { data: T[]; meta: { page: number; totalPages: number; total: number } };

const money = (value: string | number) => `Rp ${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const purchaseDetailStyles = StyleSheet.create({
  detailInfo: { marginTop: 7, padding: 9, borderRadius: 9, backgroundColor: '#fff' }, detailStats: { flexDirection: 'row', gap: 7, marginTop: 8 }, detailStat: { flex: 1, padding: 9, borderRadius: 9, backgroundColor: '#fff' }, detailSectionTitle: { marginTop: 12, marginBottom: 4, color: '#26384a', fontSize: 10, fontWeight: '900' },
  receivedInput: { height: 34, marginTop: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: '#dfe7eb', borderRadius: 8, color: '#26384a', fontSize: 9 }, attachmentList: { gap: 7, paddingVertical: 6 }, attachmentImage: { width: 72, height: 72, borderRadius: 9, backgroundColor: '#edf2f4' },
  receiveError: { marginTop: 8, padding: 9, borderRadius: 8, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 9 }, receiveButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, borderRadius: 10, backgroundColor: '#07885b' }, receiveButtonText: { color: '#fff', fontSize: 9, fontWeight: '900' }, disabled: { opacity: 0.5 },
});
const statusColor = (status: string) => status === 'COMPLETED' ? styles.statusComplete : status === 'SUBMITTED' ? styles.statusSubmitted : status === 'CANCELLED' ? styles.statusCancelled : styles.statusDraft;

export default function DistributorPurchasesScreen() {
  const { user, authorizedRequest } = useAuth();
  const canRead = user?.permissions.includes('purchase.read') ?? false;
  const canManage = user?.permissions.includes('purchase.manage') ?? false;
  const canReceive = user?.permissions.includes('purchase.receive') ?? false;
  const [rows, setRows] = useState<Purchase[]>([]);
  const [selected, setSelected] = useState<PurchaseDetail | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(canRead);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [createVisible, setCreateVisible] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState('');
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    let active = true;
    const params = new URLSearchParams({ page: '1', perPage: '30', sortBy: 'createdAt', sortOrder: 'desc' });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    void authorizedRequest<Page<Purchase>>(`distributor-purchases?${params.toString()}`)
      .then((result) => { if (active) { setRows(result.data); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Pembelian distributor belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [authorizedRequest, canRead, reload, search, statusFilter]);

  async function openDetail(purchase: Purchase) {
    setSelected(null);
    setDetailLoading(true);
    setReceiveError('');
    try {
      const detail = await authorizedRequest<PurchaseDetail>(`distributor-purchases/${purchase.id}`);
      setSelected(detail);
      setReceivedQuantities(Object.fromEntries(detail.items.map((item) => [item.id, item.receivedQty ?? item.orderedQty])));
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Detail pembelian belum dapat dimuat.'); }
    finally { setDetailLoading(false); }
  }

  async function openCreatedPurchase(purchaseId: string) {
    setCreateVisible(false);
    setReload((value) => value + 1);
    setDetailLoading(true);
    try {
      const detail = await authorizedRequest<PurchaseDetail>(`distributor-purchases/${purchaseId}`);
      setSelected(detail);
      setReceivedQuantities(Object.fromEntries(detail.items.map((item) => [item.id, item.receivedQty ?? item.orderedQty])));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Pembelian dibuat, tetapi detail belum dapat dimuat.'); }
    finally { setDetailLoading(false); }
  }

  async function completePurchase() {
    if (!selected) return;
    if (selected.items.some((item) => !(Number(receivedQuantities[item.id]) > 0))) { setReceiveError('Jumlah diterima untuk setiap produk harus lebih dari nol.'); return; }
    setReceiving(true); setReceiveError('');
    try {
      await authorizedRequest(`distributor-purchases/${selected.id}/complete`, { method: 'POST', body: JSON.stringify({ items: selected.items.map((item) => ({ itemId: item.id, receivedQty: receivedQuantities[item.id] })) }) });
      const detail = await authorizedRequest<PurchaseDetail>(`distributor-purchases/${selected.id}`);
      setSelected(detail); setReload((value) => value + 1);
    } catch (cause) { setReceiveError(cause instanceof ApiError ? cause.message : 'Penerimaan belum dapat diselesaikan.'); }
    finally { setReceiving(false); }
  }

  async function downloadPurchasePdf() {
    if (!selected) return;
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
    const lines = selected.items.map((item) => `<div class="row"><span>${escape(item.product.name)} · ${Number(item.orderedQty)} ${escape(item.unit?.code ?? '')} · ${escape(item.lineType)}</span><strong>${money(item.subtotal)}</strong></div>`).join('');
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page{margin:10mm}body{font:12px Arial,sans-serif;color:#172338;max-width:600px;margin:0 auto}.center{text-align:center}.muted{color:#71839a;font-size:10px}.row{display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid #e8edf0}.total{font-weight:bold;font-size:16px;color:#07885b}</style></head><body><div class="center"><h2>${escape(selected.distributor.name)}</h2><div>${escape(selected.invoiceNumber ?? selected.distributorInvoiceNumber ?? 'Draft pembelian')}</div><div class="muted">${formatDate(selected.purchaseDate)} · ${escape(selected.warehouse.name)}</div></div><hr/>${lines}<div class="row"><span>Subtotal</span><span>${money(selected.subtotal)}</span></div><div class="row"><span>Diskon</span><span>-${money(selected.discountAmount)}</span></div><div class="row"><span>Biaya tambahan</span><span>${money(selected.additionalCost)}</span></div><div class="row total"><span>TOTAL</span><span>${money(selected.grandTotal)}</span></div>${selected.note ? `<p class="muted">Catatan: ${escape(selected.note)}</p>` : ''}</body></html>`;
    await Print.printAsync({ html });
  }

  if (createVisible) return <><Stack.Screen options={{ headerShown: false }} /><DistributorPurchaseWizard onCancel={() => setCreateVisible(false)} onCreated={(purchaseId) => void openCreatedPurchase(purchaseId)} /></>;

  return <><Stack.Screen options={{ title: 'Pembelian Distributor' }} /><View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReload((value) => value + 1); }} tintColor="#07885b" />}>
      <View style={styles.titleRow}>{canManage ? <Pressable accessibilityRole="button" onPress={() => setCreateVisible(true)} style={styles.createButton}><Plus size={17} color="#fff" /><Text style={styles.createButtonText}>Buat pembelian</Text></Pressable> : null}</View>
      {canRead ? <>
        <View style={styles.searchRow}><View style={styles.searchBox}><Search size={17} color="#71839a" /><TextInput accessibilityLabel="Cari pembelian" value={searchInput} onChangeText={setSearchInput} onSubmitEditing={() => setSearch(searchInput.trim())} placeholder="Nomor invoice atau distributor" placeholderTextColor="#8b99a8" style={styles.searchInput} returnKeyType="search" /></View><Pressable accessibilityRole="button" onPress={() => setSearch(searchInput.trim())} style={styles.searchButton}><Search size={18} color="#fff" /></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{[{ label: 'Semua', value: '' }, { label: 'Draft', value: 'DRAFT' }, { label: 'Dikonfirmasi', value: 'SUBMITTED' }, { label: 'Selesai', value: 'COMPLETED' }].map((filter) => <Pressable key={filter.value || 'all'} onPress={() => setStatusFilter(filter.value)} style={[styles.filterChip, statusFilter === filter.value && styles.filterChipActive]}><Text style={[styles.filterText, statusFilter === filter.value && styles.filterTextActive]}>{filter.label}</Text></Pressable>)}</ScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : null}
        {!loading && !rows.length ? <View style={styles.empty}><Package size={22} color="#8091a4" /><Text style={styles.emptyTitle}>Belum ada pembelian</Text><Text style={styles.emptyText}>Pembelian distributor akan tampil di sini.</Text></View> : null}
        {rows.map((purchase) => <Pressable key={purchase.id} accessibilityRole="button" onPress={() => void openDetail(purchase)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <View style={styles.rowIcon}><Package size={19} color="#168a68" /></View>
          <View style={styles.rowBody}><View style={styles.rowTitleLine}><Text numberOfLines={1} style={styles.invoice}>{purchase.invoiceNumber ?? purchase.distributorInvoiceNumber ?? 'Draft pembelian'}</Text><Text style={[styles.status, statusColor(purchase.status)]}>{formatStatus(purchase.status)}</Text></View><Text numberOfLines={1} style={styles.distributor}>{purchase.distributor.name}</Text><Text style={styles.meta}>{formatDate(purchase.purchaseDate)} · {purchase.warehouse.name} · {purchase._count.items} item</Text></View>
          <View style={styles.rowRight}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.total}>{money(purchase.grandTotal)}</Text><ChevronRight size={17} color="#91a0ae" /></View>
        </Pressable>)}
      </> : <View style={styles.empty}><Text style={styles.emptyTitle}>Akses tidak tersedia</Text><Text style={styles.emptyText}>Akun ini belum memiliki izin melihat pembelian distributor.</Text></View>}
    </ScrollView>
    <Modal visible={detailLoading || Boolean(selected)} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
      <View style={styles.backdrop}><View style={styles.detailSheet}>
        <View style={styles.detailHeader}><View><Text style={styles.detailTitle}>Detail pembelian</Text>{selected ? <Text style={styles.meta}>{selected.invoiceNumber ?? selected.distributorInvoiceNumber ?? 'Draft pembelian'}</Text> : null}</View><Pressable accessibilityRole="button" accessibilityLabel="Tutup detail" onPress={() => setSelected(null)} style={styles.closeButton}><X size={19} color="#4c5e70" /></Pressable></View>
        {detailLoading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : selected ? <ScrollView style={styles.detailContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.detailMeta}>{selected.distributor.name} · {selected.warehouse.name}</Text><Text style={styles.detailMeta}>{formatDate(selected.purchaseDate)} · {formatStatus(selected.status)}</Text>
          {selected.invoiceNumber ? <View style={purchaseDetailStyles.detailInfo}><Text style={styles.detailMeta}>Nomor pembelian</Text><Text style={styles.detailProduct}>{selected.invoiceNumber}</Text></View> : null}
          {selected.distributorInvoiceNumber ? <View style={purchaseDetailStyles.detailInfo}><Text style={styles.detailMeta}>Invoice distributor</Text><Text style={styles.detailProduct}>{selected.distributorInvoiceNumber}</Text></View> : null}
          <View style={purchaseDetailStyles.detailStats}><View style={purchaseDetailStyles.detailStat}><Text style={styles.detailMeta}>Total</Text><Text style={styles.detailTotalValue}>{money(selected.grandTotal)}</Text></View><View style={purchaseDetailStyles.detailStat}><Text style={styles.detailMeta}>Diskon</Text><Text style={styles.detailProduct}>{money(selected.discountAmount)}</Text></View></View>
          <Text style={purchaseDetailStyles.detailSectionTitle}>Daftar produk ({selected.items.length})</Text>
          {selected.items.map((item) => <View key={item.id} style={styles.detailItem}><View style={styles.detailItemText}><Text style={styles.detailProduct}>{item.product.name}{item.lineType === 'BONUS' ? ' (Bonus)' : ''}</Text><Text style={styles.meta}>{item.product.sku} · {item.orderedQty} {item.unit?.code ?? ''} × {money(item.unitPrice)}</Text>{selected.status === 'SUBMITTED' && canReceive ? <TextInput accessibilityLabel={`Jumlah diterima ${item.product.name}`} value={receivedQuantities[item.id] ?? item.orderedQty} onChangeText={(value) => setReceivedQuantities((current) => ({ ...current, [item.id]: value.replace(',', '.') }))} keyboardType="decimal-pad" style={purchaseDetailStyles.receivedInput} placeholder="Jumlah diterima" /> : item.receivedQty ? <Text style={styles.meta}>Diterima {item.receivedQty} {item.unit?.code ?? ''}</Text> : null}</View><Text style={styles.detailAmount}>{money(item.subtotal)}</Text></View>)}
          {selected.attachments?.length ? <><Text style={purchaseDetailStyles.detailSectionTitle}>Foto invoice</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={purchaseDetailStyles.attachmentList}>{selected.attachments.map((attachment) => <Image key={attachment.id} source={{ uri: attachment.url }} accessibilityLabel={attachment.fileName} style={purchaseDetailStyles.attachmentImage} />)}</ScrollView></> : null}
          {selected.note ? <Text style={styles.detailMeta}>Catatan: {selected.note}</Text> : null}
          <View style={styles.detailTotal}><Text style={styles.detailTotalLabel}>Total pembelian</Text><Text style={styles.detailTotalValue}>{money(selected.grandTotal)}</Text></View>
          <Pressable accessibilityRole="button" onPress={() => void downloadPurchasePdf()} style={styles.pdfButton}><Download size={15} color="#53677e" /><Text style={styles.pdfButtonText}>Download PDF</Text></Pressable>
          {receiveError ? <Text style={purchaseDetailStyles.receiveError}>{receiveError}</Text> : null}
          {selected.status === 'SUBMITTED' && canReceive ? <Pressable accessibilityRole="button" disabled={receiving} onPress={() => void completePurchase()} style={[purchaseDetailStyles.receiveButton, receiving && purchaseDetailStyles.disabled]}>{receiving ? <ActivityIndicator color="#fff" /> : <><Check size={16} color="#fff" /><Text style={purchaseDetailStyles.receiveButtonText}>Selesaikan penerimaan</Text></>}</Pressable> : null}
        </ScrollView> : null}
      </View></View>
    </Modal>
  </View></>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' }, page: { padding: 16, paddingTop: 12, paddingBottom: 24 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 }, backText: { color: '#07885b', fontSize: 11, fontWeight: '800' },
  eyebrow: { color: '#07885b', fontSize: 9, fontWeight: '900' }, title: { marginTop: 5, marginBottom: 14, color: '#172338', fontSize: 23, fontWeight: '900' }, titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 }, createButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#07885b' }, createButtonText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  filters: { gap: 7, paddingBottom: 10 }, filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#edf2f5' }, filterChipActive: { backgroundColor: '#07885b' }, filterText: { color: '#60758a', fontSize: 8, fontWeight: '800' }, filterTextActive: { color: '#fff' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 }, searchBox: { height: 43, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e2e9ed', borderRadius: 11, backgroundColor: '#fff' }, searchInput: { flex: 1, color: '#172338', fontSize: 10 }, searchButton: { width: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#07885b' },
  error: { marginBottom: 9, padding: 10, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10 }, loader: { padding: 20 }, empty: { alignItems: 'center', gap: 7, marginTop: 22, padding: 20, borderWidth: 1, borderColor: '#e5ecef', borderRadius: 13, backgroundColor: '#fff' }, emptyTitle: { color: '#26384a', fontSize: 12, fontWeight: '900' }, emptyText: { color: '#7a8a9b', fontSize: 10, textAlign: 'center' },
  row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8, padding: 10, borderWidth: 1, borderColor: '#e8eef1', borderRadius: 12, backgroundColor: '#fff' }, rowPressed: { opacity: 0.75 }, rowIcon: { width: 37, height: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#e4f7ef' }, rowBody: { flex: 1, minWidth: 0 }, rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 }, invoice: { flex: 1, color: '#25364a', fontSize: 10, fontWeight: '900' }, distributor: { marginTop: 4, color: '#344b5e', fontSize: 10, fontWeight: '700' }, meta: { marginTop: 4, color: '#7b8b9b', fontSize: 8 }, rowRight: { width: 75, alignItems: 'flex-end', gap: 5 }, total: { width: '100%', color: '#07885b', fontSize: 9, fontWeight: '900', textAlign: 'right' }, status: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, fontSize: 7, fontWeight: '900' }, statusDraft: { color: '#6e7680', backgroundColor: '#eff2f4' }, statusSubmitted: { color: '#996400', backgroundColor: '#fff2d5' }, statusComplete: { color: '#087c53', backgroundColor: '#def7eb' }, statusCancelled: { color: '#a53631', backgroundColor: '#ffebe9' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, detailSheet: { maxHeight: '84%', paddingHorizontal: 15, paddingTop: 15, paddingBottom: 24, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#f7f9fa' }, detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }, detailTitle: { color: '#172338', fontSize: 14, fontWeight: '900' }, closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#edf1f4' }, detailContent: { flexGrow: 0 }, detailMeta: { marginTop: 4, color: '#6e7f91', fontSize: 9 }, detailItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: '#fff' }, detailItemText: { flex: 1 }, detailProduct: { color: '#27394c', fontSize: 10, fontWeight: '800' }, detailAmount: { color: '#263a4e', fontSize: 9, fontWeight: '800' }, detailTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#e4f7ef' }, detailTotalLabel: { color: '#3f6959', fontSize: 10, fontWeight: '800' }, detailTotalValue: { color: '#07885b', fontSize: 11, fontWeight: '900' },
  pdfButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 9, borderWidth: 1, borderColor: '#e0e8ed', borderRadius: 9, backgroundColor: '#fff' }, pdfButtonText: { color: '#53677e', fontSize: 8, fontWeight: '900' },
});