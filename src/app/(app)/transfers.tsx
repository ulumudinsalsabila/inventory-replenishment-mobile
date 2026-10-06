import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';

type TransferSummary = {
  id: string; transferNumber: string; status: string; createdAt: string; sentAt: string | null;
  sourceWarehouse: { name: string }; destinationWarehouse: { name: string };
  _count: { items: number }; availableActions: string[];
};
type TransferItem = {
  id: string; sentQty: string; receivedQty: string | null; discrepancyQty: string | null;
  discrepancyReason: string | null; discrepancyNote: string | null;
  product: { name: string; sku: string };
};
type TransferEvidence = { id: string; url: string; createdAt: string };
type TransferDetail = TransferSummary & { note: string | null; items: TransferItem[]; evidenceImages?: TransferEvidence[]; history?: { step: string; createdAt: string }[] };
type TransferPage = { data: TransferSummary[]; meta: { page: number; total: number; totalPages: number } };
type ReceiveLine = { receivedQty: string; discrepancyReason: string; discrepancyNote: string };

const reasons = ['MISSING', 'DAMAGED', 'WRONG_ITEM', 'QUANTITY_ERROR', 'OTHER'];
const reasonLabels: Record<string, string> = { MISSING: 'Barang kurang', DAMAGED: 'Barang rusak', WRONG_ITEM: 'Barang tertukar', QUANTITY_ERROR: 'Selisih jumlah', OTHER: 'Lainnya' };
const statusLabels: Record<string, string> = { DRAFT: 'Draft', PREPARING: 'Disiapkan', READY: 'Siap dikirim', IN_TRANSIT: 'Dalam perjalanan', RECEIVED: 'Diterima', PARTIALLY_RECEIVED: 'Diterima dengan selisih', CANCELLED: 'Dibatalkan' };
const moneyless = (value: string | number) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 4 });

export default function TransfersScreen() {
  const { user, authorizedRequest } = useAuth();
  const canRead = user?.permissions.includes('inventory.read') ?? false;
  const [rows, setRows] = useState<TransferSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(canRead);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<TransferDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [receiveLines, setReceiveLines] = useState<Record<string, ReceiveLine>>({});
  const [receiving, setReceiving] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!canRead) return;
    const params = new URLSearchParams({ page: String(page), perPage: '20', sortBy: 'createdAt', sortOrder: 'desc' });
    if (search) params.set('search', search);
    void authorizedRequest<TransferPage>(`warehouse-transfers?${params.toString()}`)
      .then((result) => { if (active) { setRows(result.data); setTotalPages(Math.max(1, result.meta.totalPages)); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Data transfer belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [authorizedRequest, canRead, page, reloadKey, search]);

  async function openTransfer(id: string) {
    setSelected(null); setDetailLoading(true); setError('');
    try {
      const detail = await authorizedRequest<TransferDetail>(`warehouse-transfers/${id}`);
      setSelected(detail);
      setReceiveLines(Object.fromEntries(detail.items.map((item) => [item.id, { receivedQty: item.sentQty, discrepancyReason: 'MISSING', discrepancyNote: '' }])));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Detail transfer belum dapat dimuat.'); }
    finally { setDetailLoading(false); }
  }

  async function refreshSelected() {
    if (selected) await openTransfer(selected.id);
  }

  async function transition(action: string) {
    if (!selected) return;
    setActionLoading(true); setError('');
    try {
      await authorizedRequest<TransferDetail>(`warehouse-transfers/${selected.id}/${action.toLowerCase()}`, { method: 'POST' });
      setReloadKey((key) => key + 1);
      await openTransfer(selected.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Aksi transfer belum dapat diproses.'); }
    finally { setActionLoading(false); }
  }

  async function receiveTransfer() {
    if (!selected) return;
    const items = selected.items.map((item) => {
      const line = receiveLines[item.id];
      const different = Number(line.receivedQty) !== Number(item.sentQty);
      return { itemId: item.id, receivedQty: line.receivedQty, ...(different ? { discrepancyReason: line.discrepancyReason, ...(line.discrepancyNote.trim() ? { discrepancyNote: line.discrepancyNote.trim() } : {}) } : {}) };
    });
    if (items.some((item) => !Number.isFinite(Number(item.receivedQty)) || Number(item.receivedQty) < 0)) { setError('Jumlah diterima harus berupa angka nol atau lebih.'); return; }
    if (selected.items.some((item) => Number(receiveLines[item.id].receivedQty) !== Number(item.sentQty) && receiveLines[item.id].discrepancyReason === 'OTHER' && !receiveLines[item.id].discrepancyNote.trim())) { setError('Catatan wajib diisi untuk alasan selisih Lainnya.'); return; }
    setReceiving(true); setError('');
    try {
      await authorizedRequest<TransferDetail>(`warehouse-transfers/${selected.id}/receive`, { method: 'POST', body: JSON.stringify({ items }) });
      setReloadKey((key) => key + 1);
      await openTransfer(selected.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Penerimaan transfer belum dapat disimpan.'); }
    finally { setReceiving(false); }
  }

  async function addEvidence(useCamera: boolean) {
    if (!selected) return;
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(useCamera ? 'Izin kamera diperlukan untuk mengambil foto.' : 'Izin foto diperlukan untuk memilih bukti.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 8, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    setEvidenceBusy(true); setError('');
    try {
      const form = new FormData();
      result.assets.forEach((asset, index) => {
        const uriParts = asset.uri.split('/');
        const name = asset.fileName ?? uriParts[uriParts.length - 1] ?? `evidence-${index}.jpg`;
        const type = asset.mimeType ?? 'image/jpeg';
        form.append('images', { uri: asset.uri, name, type } as unknown as Blob);
      });
      await authorizedRequest<TransferEvidence[]>(`warehouse-transfers/${selected.id}/evidence`, { method: 'POST', body: form });
      await openTransfer(selected.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Foto bukti belum dapat diunggah.'); }
    finally { setEvidenceBusy(false); }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((key) => key + 1); }} tintColor="#087f5b" />}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹  Operasional</Text></Pressable>
        <Text style={styles.eyebrow}>PERSEDIAAN ANTAR GUDANG</Text><Text style={styles.title}>Transfer gudang</Text><Text style={styles.subtitle}>Pantau pengiriman dan konfirmasi barang yang diterima.</Text>
        <View style={styles.searchRow}><TextInput accessibilityLabel="Cari nomor transfer" returnKeyType="search" onSubmitEditing={() => { setPage(1); setSearch(searchInput.trim()); }} value={searchInput} onChangeText={setSearchInput} placeholder="Cari nomor transfer" placeholderTextColor="#8a968f" style={styles.searchInput} /><Pressable accessibilityRole="button" onPress={() => { setPage(1); setSearch(searchInput.trim()); }} style={styles.searchButton}><Text style={styles.searchButtonText}>Cari</Text></Pressable></View>
        {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => setReloadKey((key) => key + 1)}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
        {!canRead ? <View style={styles.empty}><Text style={styles.emptyTitle}>Akses transfer tidak tersedia</Text><Text style={styles.emptyText}>Akun ini perlu permission inventory.read untuk melihat transfer.</Text></View> : null}
        {loading ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : null}
        {canRead && !loading && !error && !rows.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Belum ada transfer</Text><Text style={styles.emptyText}>Transfer yang masuk ke cabang atau dibuat pusat akan tampil di sini.</Text></View> : null}
        {rows.map((row) => <Pressable accessibilityRole="button" key={row.id} onPress={() => void openTransfer(row.id)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.rowTop}><View style={styles.rowTitle}><Text style={styles.transferNumber}>{row.transferNumber}</Text><Text style={styles.date}>{new Date(row.createdAt).toLocaleDateString('id-ID', { dateStyle: 'medium' })} · {row._count.items} produk</Text></View><Text style={[styles.status, row.status === 'RECEIVED' ? styles.statusDone : row.status === 'CANCELLED' ? styles.statusMuted : styles.statusActive]}>{statusLabels[row.status] ?? row.status}</Text></View>
          <Text style={styles.route}>{row.sourceWarehouse.name}  →  {row.destinationWarehouse.name}</Text>
          <Text style={styles.openHint}>Buka detail  ›</Text>
        </Pressable>)}
        {rows.length > 0 ? <View style={styles.pagination}><Pressable disabled={page <= 1} onPress={() => setPage((value) => value - 1)} style={[styles.pageButton, page <= 1 && styles.disabled]}><Text style={styles.pageText}>‹ Sebelumnya</Text></Pressable><Text style={styles.pageCount}>{page} / {totalPages}</Text><Pressable disabled={page >= totalPages} onPress={() => setPage((value) => value + 1)} style={[styles.pageButton, page >= totalPages && styles.disabled]}><Text style={styles.pageText}>Berikutnya ›</Text></Pressable></View> : null}
      </ScrollView>

      <Modal animationType="slide" visible={detailLoading || selected !== null} onRequestClose={() => setSelected(null)}>
        <View style={styles.modalScreen}><View style={styles.modalHeader}><Pressable onPress={() => setSelected(null)}><Text style={styles.backText}>Tutup</Text></Pressable><Text style={styles.modalTitle}>Detail transfer</Text><Pressable onPress={() => void refreshSelected()}><Text style={styles.backText}>↻</Text></Pressable></View>
          {detailLoading ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : selected ? <ScrollView contentContainerStyle={styles.detailPage}>
            <Text style={styles.eyebrow}>{selected.transferNumber}</Text><Text style={styles.detailStatus}>{statusLabels[selected.status] ?? selected.status}</Text>
            <View style={styles.routeCard}><Text style={styles.routeLabel}>Gudang asal</Text><Text style={styles.routeValue}>{selected.sourceWarehouse.name}</Text><Text style={styles.routeArrow}>↓</Text><Text style={styles.routeLabel}>Gudang tujuan</Text><Text style={styles.routeValue}>{selected.destinationWarehouse.name}</Text></View>
            {selected.note ? <Text style={styles.noteText}>Catatan: {selected.note}</Text> : null}
            <Text style={styles.sectionTitle}>Foto bukti penerimaan</Text>
            <View style={styles.evidenceActions}>
              <Pressable disabled={evidenceBusy} onPress={() => void addEvidence(true)} style={styles.evidenceButton}><Text style={styles.evidenceButtonText}>Ambil foto</Text></Pressable>
              <Pressable disabled={evidenceBusy} onPress={() => void addEvidence(false)} style={styles.evidenceButton}><Text style={styles.evidenceButtonText}>Pilih foto</Text></Pressable>
            </View>
            {evidenceBusy ? <ActivityIndicator color="#087f5b" /> : null}
            {(selected.evidenceImages ?? []).length ? <ScrollView horizontal contentContainerStyle={styles.evidenceList}>{selected.evidenceImages!.map((photo) => <Image key={photo.id} source={{ uri: photo.url }} resizeMode="cover" style={styles.evidenceImage} />)}</ScrollView> : <Text style={styles.hint}>Belum ada foto bukti.</Text>}
            <Text style={styles.sectionTitle}>Daftar barang</Text>
            {selected.items.map((item) => { const line = receiveLines[item.id]; const differs = line && Number(line.receivedQty) !== Number(item.sentQty); return <View key={item.id} style={styles.itemCard}>
              <Text style={styles.productName}>{item.product.name}</Text><Text style={styles.sku}>{item.product.sku}</Text>
              <View style={styles.qtyRow}><Text style={styles.qtyLabel}>Dikirim</Text><Text style={styles.qtyValue}>{moneyless(item.sentQty)}</Text></View>
              {selected.availableActions.includes('RECEIVE') ? <><View style={styles.receiveRow}><Text style={styles.qtyLabel}>Diterima</Text><TextInput accessibilityLabel={`Jumlah diterima ${item.product.name}`} keyboardType="decimal-pad" value={line?.receivedQty ?? item.sentQty} onChangeText={(value) => setReceiveLines((current) => ({ ...current, [item.id]: { ...current[item.id], receivedQty: value.replace(',', '.') } }))} style={styles.receiveInput} /></View>
                {differs ? <><Pressable onPress={() => setReceiveLines((current) => ({ ...current, [item.id]: { ...current[item.id], discrepancyReason: reasons[(reasons.indexOf(current[item.id].discrepancyReason) + 1) % reasons.length] } }))} style={styles.reasonButton}><Text style={styles.reasonText}>Alasan selisih: {reasonLabels[line.discrepancyReason] ?? line.discrepancyReason} · Ubah</Text></Pressable>{line.discrepancyReason === 'OTHER' ? <TextInput value={line.discrepancyNote} onChangeText={(value) => setReceiveLines((current) => ({ ...current, [item.id]: { ...current[item.id], discrepancyNote: value } }))} placeholder="Catatan wajib untuk alasan Lainnya" placeholderTextColor="#8a968f" style={styles.discrepancyNote} /> : null}</> : null}</> : item.receivedQty !== null ? <View style={styles.qtyRow}><Text style={styles.qtyLabel}>Diterima</Text><Text style={styles.qtyValue}>{moneyless(item.receivedQty)}</Text></View> : null}
              {item.discrepancyReason ? <Text style={styles.discrepancy}>{reasonLabels[item.discrepancyReason] ?? item.discrepancyReason}{item.discrepancyNote ? ` · ${item.discrepancyNote}` : ''}</Text> : null}
            </View>; })}
            {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View> : null}
            {selected.availableActions.includes('RECEIVE') ? <Pressable accessibilityRole="button" disabled={receiving} onPress={() => void receiveTransfer()} style={[styles.primaryAction, receiving && styles.disabled]}>{receiving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryActionText}>Konfirmasi penerimaan</Text>}</Pressable> : null}
            {selected.availableActions.filter((action) => action !== 'RECEIVE').map((action) => <Pressable key={action} accessibilityRole="button" disabled={actionLoading} onPress={() => void transition(action)} style={[action === 'CANCEL' ? styles.secondaryAction : styles.primaryAction, actionLoading && styles.disabled]}>{actionLoading ? <ActivityIndicator color={action === 'CANCEL' ? '#087f5b' : '#fff'} /> : <Text style={action === 'CANCEL' ? styles.secondaryActionText : styles.primaryActionText}>{action === 'PREPARE' ? 'Mulai siapkan' : action === 'READY' ? 'Tandai siap dikirim' : action === 'SEND' ? 'Kirim transfer' : 'Batalkan transfer'}</Text>}</Pressable>)}
          </ScrollView> : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 20, paddingTop: 18, paddingBottom: 32 }, back: { alignSelf: 'flex-start', marginBottom: 20, paddingVertical: 4 }, backText: { color: '#087f5b', fontSize: 13, fontWeight: '800' }, eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 26, fontWeight: '800' }, subtitle: { marginTop: 5, color: '#718078', fontSize: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 19, marginBottom: 8 }, searchInput: { height: 47, flex: 1, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff', color: '#172820', fontSize: 13 }, searchButton: { minWidth: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#087f5b' }, searchButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  evidenceActions: { flexDirection: 'row', gap: 8, marginBottom: 9 }, evidenceButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#e7f5ee' }, evidenceButtonText: { color: '#087f5b', fontSize: 11, fontWeight: '800' }, evidenceList: { gap: 8, paddingVertical: 4 }, evidenceImage: { width: 88, height: 88, borderRadius: 12, backgroundColor: '#edf1ee' }, hint: { color: '#89958e', fontSize: 11, paddingVertical: 8 },
  card: { marginTop: 10, padding: 14, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 16, backgroundColor: '#fff' }, pressed: { backgroundColor: '#f8fcfa' }, rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, rowTitle: { flex: 1 }, transferNumber: { color: '#26372e', fontSize: 14, fontWeight: '900' }, date: { marginTop: 4, color: '#89958e', fontSize: 10 }, status: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, fontSize: 9, fontWeight: '900' }, statusActive: { backgroundColor: '#fff2d8', color: '#a86200' }, statusDone: { backgroundColor: '#e7f5ee', color: '#087f5b' }, statusMuted: { backgroundColor: '#f1f4f2', color: '#78857e' }, route: { marginTop: 13, color: '#59685f', fontSize: 11 }, openHint: { marginTop: 11, color: '#087f5b', fontSize: 10, fontWeight: '800', textAlign: 'right' },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 17 }, pageButton: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, backgroundColor: '#e7f5ee' }, pageText: { color: '#087f5b', fontSize: 10, fontWeight: '800' }, pageCount: { color: '#68766e', fontSize: 11, fontWeight: '700' }, disabled: { opacity: 0.5 }, errorCard: { marginTop: 14, padding: 13, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 14, backgroundColor: '#fff6f5' }, errorText: { color: '#a3332a', fontSize: 12, lineHeight: 18 }, retry: { marginTop: 7, color: '#087f5b', fontSize: 12, fontWeight: '800' }, loader: { padding: 24 }, empty: { alignItems: 'center', marginTop: 18, padding: 22, borderRadius: 15, backgroundColor: '#fff' }, emptyTitle: { color: '#28372f', fontSize: 14, fontWeight: '800' }, emptyText: { marginTop: 6, color: '#819087', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  modalScreen: { flex: 1, backgroundColor: '#f5f7f6' }, modalHeader: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#e6ece8', backgroundColor: '#fff' }, modalTitle: { color: '#172820', fontSize: 15, fontWeight: '900' }, detailPage: { padding: 20, paddingBottom: 40 }, detailStatus: { marginTop: 7, color: '#26372e', fontSize: 19, fontWeight: '900' }, routeCard: { marginTop: 18, padding: 15, borderRadius: 15, backgroundColor: '#fff' }, routeLabel: { color: '#89958e', fontSize: 10, fontWeight: '700' }, routeValue: { marginTop: 4, color: '#26372e', fontSize: 13, fontWeight: '800' }, routeArrow: { marginVertical: 5, color: '#087f5b', fontSize: 17, fontWeight: '900' }, noteText: { marginTop: 12, color: '#59685f', fontSize: 11, lineHeight: 17 }, sectionTitle: { marginTop: 22, marginBottom: 10, color: '#26372e', fontSize: 15, fontWeight: '900' }, itemCard: { marginBottom: 9, padding: 13, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 14, backgroundColor: '#fff' }, productName: { color: '#26372e', fontSize: 13, fontWeight: '800' }, sku: { marginTop: 4, color: '#89958e', fontSize: 10 }, qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, qtyLabel: { color: '#718078', fontSize: 11, fontWeight: '700' }, qtyValue: { color: '#26372e', fontSize: 12, fontWeight: '900' }, receiveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 9 }, receiveInput: { width: 98, height: 39, paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, backgroundColor: '#fff', color: '#172820', textAlign: 'right', fontSize: 13, fontWeight: '800' }, reasonButton: { alignSelf: 'flex-start', marginTop: 9, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: '#fff2d8' }, reasonText: { color: '#a86200', fontSize: 10, fontWeight: '800' }, discrepancyNote: { minHeight: 39, marginTop: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: '#dce4df', borderRadius: 9, color: '#26372e', fontSize: 11 }, discrepancy: { marginTop: 8, color: '#a86200', fontSize: 10, lineHeight: 15 }, primaryAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 14, borderRadius: 13, backgroundColor: '#087f5b' }, primaryActionText: { color: '#fff', fontSize: 12, fontWeight: '900' }, secondaryAction: { minHeight: 45, alignItems: 'center', justifyContent: 'center', marginTop: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff' }, secondaryActionText: { color: '#68766e', fontSize: 12, fontWeight: '800' },
});
