import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronDown, ChevronRight, Minus, Package, PackagePlus, Plus, Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';

type NamedOption = { id: string; name: string; code?: string; branchId?: string | null };
type ProductOption = { id: string; name: string; sku: string; unit: { code: string }; category?: { name: string } | null };
type RequestOptions = { branches: NamedOption[]; sourceWarehouses: NamedOption[]; destinationWarehouses: NamedOption[]; products: ProductOption[] };
type StockRequest = {
  id: string; requestNumber: string; status: string; note: string | null; reviewNote?: string | null; createdAt: string;
  branch: { name: string }; sourceWarehouse: { id: string; name: string }; destinationWarehouse: { id: string; name: string };
  _count: { items: number; transfers: number }; availableActions: string[];
};
type RequestPage = { data: StockRequest[]; meta: { total: number } };
type RequestDetail = StockRequest & { items: { id: string; productId: string; requestedQty: string; approvedQty?: string | null; allocatedQty: string; remainingTransferQty: string; sourceAvailable: string; product: { id: string; name: string; sku: string; unit?: { code: string } } }[] };
type RequestItem = { productId: string; requestedQty: string; note?: string };
type Selector = 'branch' | 'source' | 'destination' | 'product' | null;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Diajukan', UNDER_REVIEW: 'Ditinjau', APPROVED: 'Disetujui',
  PARTIAL_APPROVED: 'Disetujui sebagian', REJECTED: 'Ditolak', FULFILLED: 'Terpenuhi', CANCELLED: 'Dibatalkan',
};
const requestPath = 'stock-requests?page=1&perPage=20&sortBy=createdAt&sortOrder=desc';

function ShoppingBagIcon() { return <Package size={22} color="#c70d17" />; }

export default function StockRequestsScreen() {
  const { user, authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const canCreate = user?.permissions.includes('stock_request.create') ?? false;
  const canReview = user?.permissions.includes('stock_request.review') ?? false;
  const canRead = user?.permissions.includes('inventory.read') ?? false;
  const userBranchId = user?.branchId ?? '';
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [options, setOptions] = useState<RequestOptions | null>(null);
  const [loading, setLoading] = useState(canRead);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [formVisible, setFormVisible] = useState(false);
  const [selector, setSelector] = useState<Selector>(null);
  const [branchId, setBranchId] = useState(userBranchId);
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [note, setNote] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approvalValues, setApprovalValues] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState('');
  const [transferVisible, setTransferVisible] = useState(false);
  const [transferQuantities, setTransferQuantities] = useState<Record<string, string>>({});
  const [transferNote, setTransferNote] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!canRead) return;
    void authorizedRequest<RequestPage>(requestPath)
      .then((result) => { if (active) { setRequests(result.data); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Permintaan stok belum dapat dimuat.'); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [authorizedRequest, canRead, reloadKey]);

  useEffect(() => {
    let active = true;
    if (!canCreate) return;
    void authorizedRequest<RequestOptions>('stock-requests/options')
      .then((result) => {
        if (!active) return;
        setOptions(result);
        setBranchId((current) => current || userBranchId || result.branches[0]?.id || '');
        setSourceWarehouseId((current) => current || result.sourceWarehouses[0]?.id || '');
        setDestinationWarehouseId((current) => current || result.destinationWarehouses.find((warehouse) => !userBranchId || warehouse.branchId === userBranchId)?.id || result.destinationWarehouses[0]?.id || '');
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Pilihan permintaan stok belum dapat dimuat.'); });
    return () => { active = false; };
  }, [authorizedRequest, canCreate, userBranchId, reloadKey]);

  const branches = options?.branches ?? [];
  const sources = options?.sourceWarehouses ?? [];
  const destinations = (options?.destinationWarehouses ?? []).filter((warehouse) => !branchId || warehouse.branchId === branchId);
  const selectedBranch = branches.find((entry) => entry.id === branchId);
  const selectedSource = sources.find((entry) => entry.id === sourceWarehouseId);
  const selectedDestination = destinations.find((entry) => entry.id === destinationWarehouseId);
  const selectedProducts = options?.products ?? [];
  const availableProducts = selectedProducts;
  const filteredProducts = useMemo(() => availableProducts.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(productSearch.trim().toLowerCase())), [availableProducts, productSearch]);

  function openCreateForm() {
    setError(''); setNotice(''); setItems([]); setNote(''); setFormVisible(true);
  }

  function selectBranch(id: string) {
    setBranchId(id);
    const destination = options?.destinationWarehouses.find((warehouse) => warehouse.branchId === id);
    setDestinationWarehouseId(destination?.id ?? '');
  }

  async function createRequest() {
    if (!branchId || !sourceWarehouseId || !destinationWarehouseId || !items.length || items.some((item) => !Number.isFinite(Number(item.requestedQty)) || Number(item.requestedQty) <= 0)) {
      setError('Lengkapi cabang, gudang asal/tujuan, dan jumlah barang yang valid.'); return;
    }
    setSaving(true); setError('');
    try {
      await authorizedRequest<StockRequest>('stock-requests', { method: 'POST', body: JSON.stringify({ branchId, sourceWarehouseId, destinationWarehouseId, note: note.trim() || undefined, items }) });
      setFormVisible(false); setNotice('Draft permintaan berhasil dibuat. Kirim pengajuan setelah data diperiksa.'); setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Permintaan belum dapat dibuat.');
    } finally { setSaving(false); }
  }

  async function runAction(id: string, action: 'submit' | 'cancel') {
    setSaving(true); setError(''); setNotice('');
    try {
      await authorizedRequest<StockRequest>(`stock-requests/${id}/${action}`, { method: 'POST' });
      setNotice(action === 'submit' ? 'Permintaan berhasil diajukan.' : 'Permintaan dibatalkan.'); setReloadKey((key) => key + 1);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Aksi belum dapat diproses.'); }
    finally { setSaving(false); }
  }

  async function openReview(id: string) {
    setDetailId(id); setDetail(null); setReviewNote(''); setApprovalValues({}); setDetailLoading(true);
    try {
      const result = await authorizedRequest<RequestDetail>(`stock-requests/${id}`);
      setDetail(result);
      setApprovalValues(Object.fromEntries(result.items.map((item) => [item.id, item.approvedQty ?? item.requestedQty])));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Detail permintaan tidak dapat dimuat.'); setDetailId(null); }
    finally { setDetailLoading(false); }
  }

  async function reviewAction(action: 'review' | 'approve' | 'reject') {
    if (!detail) return;
    if (action === 'reject' && !reviewNote.trim()) { setError('Alasan penolakan wajib diisi.'); return; }
    if (action === 'approve' && detail.items.some((item) => !Number.isFinite(Number(approvalValues[item.id])) || Number(approvalValues[item.id]) < 0 || Number(approvalValues[item.id]) > Number(item.requestedQty))) { setError('Jumlah disetujui harus berada di antara 0 dan jumlah yang diminta.'); return; }
    if (action === 'approve' && detail.items.every((item) => Number(approvalValues[item.id] ?? item.requestedQty) === 0) && !reviewNote.trim()) { setError('Catatan wajib diisi jika semua barang ditolak.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const body = action === 'approve'
        ? { items: detail.items.map((item) => ({ itemId: item.id, approvedQty: approvalValues[item.id] ?? item.requestedQty })), reviewNote: reviewNote.trim() || undefined }
        : action === 'reject' ? { reviewNote: reviewNote.trim() } : undefined;
      await authorizedRequest(`stock-requests/${detail.id}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      setNotice(action === 'review' ? 'Peninjauan dimulai. Periksa jumlah lalu setujui atau tolak permintaan.' : action === 'approve' ? 'Keputusan persetujuan berhasil dikirim.' : 'Permintaan berhasil ditolak.');
      setReloadKey((key) => key + 1);
      if (action === 'review' || action === 'approve') {
        const refreshed = await authorizedRequest<RequestDetail>(`stock-requests/${detail.id}`);
        setDetail(refreshed);
        setApprovalValues(Object.fromEntries(refreshed.items.map((item) => [item.id, item.approvedQty ?? item.requestedQty])));
      } else { setDetailId(null); setDetail(null); }
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Aksi review belum dapat diproses.'); }
    finally { setSaving(false); }
  }

  function openTransferForm() {
    if (!detail) return;
    setTransferQuantities(Object.fromEntries(detail.items.filter((item) => Number(item.remainingTransferQty) > 0).map((item) => [item.id, item.remainingTransferQty])));
    setTransferNote(''); setTransferError(''); setTransferVisible(true);
  }

  async function createTransfer() {
    if (!detail) return;
    const selectedItems = detail.items.filter((item) => Number(transferQuantities[item.id] ?? 0) > 0);
    if (!selectedItems.length) { setTransferError('Isi minimal satu jumlah barang yang akan dikirim.'); return; }
    if (selectedItems.some((item) => !Number.isFinite(Number(transferQuantities[item.id])) || Number(transferQuantities[item.id]) > Number(item.remainingTransferQty))) {
      setTransferError('Jumlah kirim harus valid dan tidak boleh melebihi sisa approved.'); return;
    }
    setTransferSaving(true); setTransferError('');
    try {
      await authorizedRequest('warehouse-transfers', {
        method: 'POST',
        body: JSON.stringify({
          stockRequestId: detail.id,
          sourceWarehouseId: detail.sourceWarehouse.id,
          destinationWarehouseId: detail.destinationWarehouse.id,
          note: transferNote.trim() || undefined,
          items: selectedItems.map((item) => ({ productId: item.productId ?? item.product.id, requestedQty: item.requestedQty, sentQty: transferQuantities[item.id] })),
        }),
      });
      setTransferVisible(false); setDetailId(null); setDetail(null); setReloadKey((key) => key + 1);
      router.push('/(app)/(tabs)/warehouse-transfers');
    } catch (cause) { setTransferError(cause instanceof ApiError ? cause.message : 'Transfer gudang belum dapat dibuat.'); }
    finally { setTransferSaving(false); }
  }

  const selectorTitle = selector === 'branch' ? 'Pilih cabang' : selector === 'source' ? 'Pilih gudang asal' : selector === 'destination' ? 'Pilih gudang tujuan' : 'Pilih produk';
  const selectorOptions: NamedOption[] = selector === 'branch' ? branches : selector === 'source' ? sources : selector === 'destination' ? destinations : [];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((key) => key + 1); }} tintColor="#c70d17" />}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹  Operasional</Text></Pressable>
        <Text style={styles.eyebrow}>REPLENISHMENT</Text>
        <View style={styles.headingRow}><View style={styles.heading}><Text style={styles.title}>{canReview ? 'Review permintaan stok' : 'Permintaan stok saya'}</Text><Text style={styles.subtitle}>{canReview ? 'Tinjau pengajuan pegawai dan putuskan jumlah yang disetujui.' : 'Buat draft, lalu ajukan agar admin atau owner dapat meninjau.'}</Text></View>{canCreate ? <Pressable accessibilityRole="button" onPress={openCreateForm} style={styles.createButton}><Text style={styles.createButtonText}>＋ Buat</Text></Pressable> : null}</View>
        {canReview ? <View style={styles.flowHint}><Text style={styles.flowHintTitle}>Alur admin / owner</Text><Text style={styles.flowHintText}>Buka permintaan berstatus Diajukan → Mulai review → atur jumlah → Setujui → buat transfer gudang.</Text></View> : canCreate ? <View style={styles.flowHint}><Text style={styles.flowHintTitle}>Alur pegawai</Text><Text style={styles.flowHintText}>Buat draft → tekan Ajukan. Admin atau owner akan menerima permintaan untuk ditinjau.</Text></View> : null}
        {notice ? <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View> : null}
        {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { setLoading(true); setReloadKey((key) => key + 1); }}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
        {!canRead ? <View style={styles.empty}><Text style={styles.emptyTitle}>Akses daftar tidak tersedia</Text><Text style={styles.emptyText}>Akun ini dapat membuat pengajuan, tetapi perlu permission inventory.read untuk melihat daftar permintaan.</Text></View> : null}
        {loading ? <ActivityIndicator style={styles.loader} color="#c70d17" size="large" /> : null}
        {canRead && !loading && !error && requests.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Belum ada permintaan</Text><Text style={styles.emptyText}>{canCreate ? 'Buat pengajuan pertama untuk mengisi ulang stok cabang.' : 'Permintaan stok akan tampil di sini.'}</Text></View> : null}
        {requests.map((request) => <View key={request.id} style={styles.requestCard}>
          <View style={styles.requestTop}><View style={styles.requestTitle}><Text style={styles.requestNumber}>{request.requestNumber}</Text><Text style={styles.requestDate}>{new Date(request.createdAt).toLocaleDateString('id-ID', { dateStyle: 'medium' })} · {request._count.items} produk</Text></View><Text style={[styles.status, request.status === 'REJECTED' || request.status === 'CANCELLED' ? styles.statusMuted : request.status === 'APPROVED' || request.status === 'FULFILLED' ? styles.statusSuccess : styles.statusPending]}>{STATUS_LABEL[request.status] ?? request.status}</Text></View>
          <Text style={styles.route}>{request.branch.name} · {request.sourceWarehouse.name} → {request.destinationWarehouse.name}</Text>
          {request.reviewNote ? <Text style={styles.reviewNote}>Catatan: {request.reviewNote}</Text> : null}
          <View style={styles.actions}>{canReview || request.availableActions.includes('CREATE_TRANSFER') ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => void openReview(request.id)} style={styles.actionPrimary}><Text style={styles.actionPrimaryText}>{request.status === 'SUBMITTED' ? 'Tinjau permintaan' : request.status === 'UNDER_REVIEW' ? 'Lanjutkan review' : request.availableActions.includes('CREATE_TRANSFER') ? 'Buat transfer' : 'Detail'}</Text></Pressable> : null}{request.availableActions.includes('SUBMIT') ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => void runAction(request.id, 'submit')} style={styles.actionPrimary}><Text style={styles.actionPrimaryText}>Ajukan</Text></Pressable> : null}{request.availableActions.includes('CANCEL') ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => void runAction(request.id, 'cancel')} style={styles.actionSecondary}><Text style={styles.actionSecondaryText}>Batalkan</Text></Pressable> : null}</View>
        </View>)}
        <Text style={styles.footerHint}>Tarik layar ke bawah untuk memperbarui status.</Text>
      </ScrollView>

      <Modal animationType="slide" visible={formVisible} onRequestClose={() => setFormVisible(false)}>
        <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 8, height: 66 + insets.top }]}><Pressable accessibilityRole="button" onPress={() => setFormVisible(false)} style={styles.headerAction}><X size={19} color="#c70d17" /><Text style={styles.backText}>Batal</Text></Pressable><Text style={styles.modalTitle}>Pengajuan stok</Text><View style={{ width: 46 }} /></View>
          <ScrollView contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
            <View style={styles.formIntro}><View style={styles.formIntroIcon}><PackagePlus size={22} color="#c70d17" /></View><View style={styles.formIntroCopy}><Text style={styles.formIntroTitle}>Ajukan kebutuhan stok</Text><Text style={styles.formIntroText}>Tentukan cabang tujuan, lalu cari dan tambah barang seperti saat berbelanja di POS.</Text></View></View>
            <View style={styles.locationCard}>
              <View style={styles.locationColumn}><Text style={styles.locationLabel}>Cabang</Text><Pressable disabled={Boolean(user?.branchId)} onPress={() => setSelector('branch')} style={styles.locationSelect}><Text numberOfLines={1} style={styles.locationValue}>{selectedBranch?.name ?? 'Pilih cabang'}</Text>{user?.branchId ? null : <ChevronDown size={17} color="#718078" />}</Pressable></View>
              <View style={styles.locationDivider} />
              <View style={styles.locationColumn}><Text style={styles.locationLabel}>Gudang tujuan</Text><Pressable onPress={() => setSelector('destination')} style={styles.locationSelect}><Text numberOfLines={1} style={styles.locationValue}>{selectedDestination?.name ?? 'Pilih gudang'}</Text><ChevronDown size={17} color="#718078" /></Pressable></View>
            </View>
            <Text style={styles.fieldLabel}>Gudang asal</Text><Pressable onPress={() => setSelector('source')} style={styles.selectField}><Text numberOfLines={1} style={styles.selectText}>{selectedSource?.name ?? 'Pilih gudang asal'}</Text><ChevronDown size={18} color="#718078" /></Pressable>
            <View style={styles.catalogHeading}><View><Text style={styles.catalogTitle}>Pilih barang</Text><Text style={styles.catalogSubtitle}>{items.length ? items.length + ' jenis barang dipilih' : 'Cari produk yang ingin diajukan'}</Text></View><View style={styles.catalogBadge}><ShoppingBagIcon /></View></View>
            <View style={styles.productSearchRow}><Search size={19} color="#84918b" /><TextInput value={productSearch} onChangeText={setProductSearch} placeholder="Cari nama barang atau SKU..." placeholderTextColor="#87948c" style={styles.productSearchInput} /></View>
            <View style={styles.productGrid}>{filteredProducts.map((product) => { const selected = items.find((item) => item.productId === product.id); return <View key={product.id} style={[styles.stockProductCard, selected && styles.stockProductSelected]}><View style={styles.stockProductArtwork}><PackagePlus size={29} color="#8b45d6" /></View><Text numberOfLines={1} style={styles.stockProductSku}>{product.sku}</Text><Text numberOfLines={2} style={styles.stockProductName}>{product.name}</Text><Text style={styles.stockProductUnit}>Satuan: {product.unit.code}</Text><View style={styles.stockProductBottom}>{selected ? <><Pressable accessibilityRole="button" accessibilityLabel={'Kurangi jumlah ' + product.name} style={styles.quantityButton} onPress={() => setItems((current) => current.flatMap((line) => line.productId !== product.id ? [line] : Number(line.requestedQty) <= 1 ? [] : [{ ...line, requestedQty: String(Number(line.requestedQty) - 1) }]))}><Minus size={16} color="#c70d17" /></Pressable><TextInput accessibilityLabel={'Jumlah ' + product.name} keyboardType="decimal-pad" value={selected.requestedQty} onChangeText={(value) => setItems((current) => current.map((line) => line.productId === product.id ? { ...line, requestedQty: value.replace(',', '.') } : line))} style={styles.catalogQtyInput} /><Pressable accessibilityRole="button" accessibilityLabel={'Tambah jumlah ' + product.name} style={styles.quantityButtonActive} onPress={() => setItems((current) => current.map((line) => line.productId === product.id ? { ...line, requestedQty: String((Number(line.requestedQty) || 0) + 1) } : line))}><Plus size={16} color="#fff" /></Pressable></> : <Pressable accessibilityRole="button" accessibilityLabel={'Tambah ' + product.name} style={styles.addProductCircle} onPress={() => setItems((current) => [...current, { productId: product.id, requestedQty: '1' }])}><Plus size={21} color="#fff" /></Pressable>}</View></View>; })}</View>
            {!filteredProducts.length ? <Text style={styles.noItems}>{productSearch ? 'Barang tidak ditemukan.' : 'Tidak ada barang yang tersedia.'}</Text> : null}
            <View style={styles.noteCard}><Text style={styles.fieldLabel}>Catatan (opsional)</Text><TextInput multiline value={note} onChangeText={setNote} placeholder="Alasan atau informasi tambahan" placeholderTextColor="#8a968f" style={styles.noteInput} /></View>
            <Text style={styles.formHint}>Pengajuan disimpan sebagai draft. Periksa kembali sebelum mengajukannya untuk ditinjau.</Text>
            {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
          </ScrollView><View style={[styles.formFooter, { paddingBottom: Math.max(14, insets.bottom + 8) }]}><View style={styles.requestCartBar}><ShoppingBagIcon /><View style={styles.requestCartCopy}><Text style={styles.requestCartTitle}>{items.reduce((sum, item) => sum + (Number(item.requestedQty) || 0), 0)} barang diminta</Text><Text style={styles.requestCartSubtitle}>{items.length} jenis produk</Text></View><Text style={styles.requestCartCount}>{items.length}</Text></View><Pressable accessibilityRole="button" disabled={saving || !options || !items.length} onPress={() => void createRequest()} style={[styles.submitButton, (saving || !options || !items.length) && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Simpan draft</Text>}</Pressable></View>
        </View>
      </Modal>

      <Modal animationType="slide" visible={Boolean(detailId) && !transferVisible} onRequestClose={() => { setDetailId(null); setDetail(null); }}>
        <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 8, height: 66 + insets.top }]}><Pressable onPress={() => { setDetailId(null); setDetail(null); }} style={styles.headerAction}><X size={19} color="#c70d17" /><Text style={styles.backText}>Tutup</Text></Pressable><Text style={styles.modalTitle}>Review permintaan</Text><View style={{ width: 46 }} /></View>
          {detailLoading || !detail ? <ActivityIndicator style={styles.loader} color="#c70d17" size="large" /> : <ScrollView contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
            <Text style={styles.requestNumber}>{detail.requestNumber}</Text><Text style={styles.route}>{detail.branch.name} · {detail.sourceWarehouse.name} → {detail.destinationWarehouse.name}</Text><Text style={styles.status}>{STATUS_LABEL[detail.status] ?? detail.status}</Text>
            <Text style={styles.fieldLabel}>Barang diminta dan jumlah persetujuan</Text>
            {detail.items.map((item) => <View key={item.id} style={styles.reviewItem}><View style={styles.reviewProduct}><Text style={styles.selectText}>{item.product.name}</Text><Text style={styles.sku}>{item.product.sku} · diminta {item.requestedQty} {item.product.unit?.code ?? ''}</Text></View>{detail.availableActions.includes('APPROVE') ? <TextInput accessibilityLabel={`Jumlah disetujui ${item.product.name}`} keyboardType="decimal-pad" value={approvalValues[item.id] ?? item.requestedQty} onChangeText={(value) => setApprovalValues((current) => ({ ...current, [item.id]: value.replace(',', '.') }))} style={styles.qtyInput} /> : item.approvedQty ? <Text style={styles.approvedQty}>Disetujui {item.approvedQty}</Text> : null}</View>)}
            {detail.availableActions.includes('APPROVE') || detail.availableActions.includes('REJECT') ? <><Text style={styles.fieldLabel}>Catatan review</Text><TextInput multiline value={reviewNote} onChangeText={setReviewNote} placeholder={detail.availableActions.includes('REJECT') ? 'Wajib diisi jika menolak' : 'Catatan untuk pegawai (opsional)'} placeholderTextColor="#8a968f" style={styles.noteInput} /></> : detail.reviewNote ? <Text style={styles.reviewNote}>Catatan: {detail.reviewNote}</Text> : null}
            {detail.availableActions.includes('START_REVIEW') ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => void reviewAction('review')} style={styles.submitButton}><Text style={styles.submitText}>{saving ? 'Memproses...' : 'Mulai review'}</Text></Pressable> : null}
            {detail.availableActions.includes('APPROVE') ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => void reviewAction('approve')} style={styles.submitButton}><Text style={styles.submitText}>{saving ? 'Memproses...' : 'Setujui permintaan'}</Text></Pressable> : null}
            {detail.availableActions.includes('REJECT') ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => void reviewAction('reject')} style={styles.rejectButton}><Text style={styles.rejectButtonText}>Tolak permintaan</Text></Pressable> : null}
            {detail.availableActions.includes('CREATE_TRANSFER') ? <Pressable accessibilityRole="button" disabled={saving} onPress={openTransferForm} style={styles.transferButton}><Text style={styles.submitText}>Buat transfer gudang</Text></Pressable> : null}
            {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
          </ScrollView>}
        </View>
      </Modal>

      <Modal animationType="slide" visible={transferVisible} onRequestClose={() => setTransferVisible(false)}>
        <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 8, height: 66 + insets.top }]}><Pressable accessibilityRole="button" onPress={() => setTransferVisible(false)} style={styles.headerAction}><X size={19} color="#087f5b" /><Text style={styles.transferBackText}>Batal</Text></Pressable><Text style={styles.modalTitle}>Buat transfer gudang</Text><View style={{ width: 46 }} /></View>
          {!detail ? null : <><ScrollView contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
            <Text style={styles.formHint}>Transfer dibuat dari jumlah yang sudah disetujui dan belum dialokasikan.</Text>
            <View style={styles.transferRouteCard}><View style={styles.transferRouteColumn}><Text style={styles.locationLabel}>DARI GUDANG</Text><Text style={styles.transferRouteValue}>{detail.sourceWarehouse.name}</Text></View><Text style={styles.transferArrow}>→</Text><View style={styles.transferRouteColumn}><Text style={styles.locationLabel}>KE GUDANG</Text><Text style={styles.transferRouteValue}>{detail.destinationWarehouse.name}</Text></View></View>
            <Text style={styles.fieldLabel}>Barang yang akan dikirim</Text>
            {detail.items.filter((item) => Number(item.remainingTransferQty) > 0).map((item) => <View key={item.id} style={styles.transferItem}><View style={styles.reviewProduct}><Text style={styles.selectText}>{item.product.name}</Text><Text style={styles.sku}>Approved {item.approvedQty ?? '0'} · dialokasikan {item.allocatedQty} · tersedia {item.sourceAvailable}</Text><Text style={styles.remainingText}>Sisa yang dapat ditransfer: {item.remainingTransferQty} {item.product.unit?.code ?? ''}</Text></View><TextInput accessibilityLabel={`Jumlah kirim ${item.product.name}`} keyboardType="decimal-pad" value={transferQuantities[item.id] ?? ''} onChangeText={(value) => setTransferQuantities((current) => ({ ...current, [item.id]: value.replace(',', '.') }))} style={styles.transferQtyInput} /></View>)}
            <Text style={styles.fieldLabel}>Catatan transfer (opsional)</Text><TextInput multiline value={transferNote} onChangeText={setTransferNote} placeholder="Informasi untuk tim gudang" placeholderTextColor="#8a968f" style={styles.noteInput} />
            {transferError ? <Text accessibilityRole="alert" style={styles.errorText}>{transferError}</Text> : null}
          </ScrollView><View style={[styles.formFooter, { paddingBottom: Math.max(14, insets.bottom + 8) }]}><Pressable accessibilityRole="button" disabled={transferSaving} onPress={() => void createTransfer()} style={[styles.transferSubmitButton, transferSaving && styles.disabled]}>{transferSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Buat transfer</Text>}</Pressable></View></>}
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={selector !== null} onRequestClose={() => setSelector(null)}>
        <View style={styles.selectorBackdrop}><View style={[styles.selectorPanel, { paddingBottom: insets.bottom + 12 }]}><View style={styles.selectorHeader}><Text style={styles.modalTitle}>{selectorTitle}</Text><Pressable onPress={() => setSelector(null)}><Text style={styles.backText}>Tutup</Text></Pressable></View>
          {selector === 'product' ? <TextInput autoFocus value={productSearch} onChangeText={setProductSearch} placeholder="Cari nama atau SKU" placeholderTextColor="#8a968f" style={styles.selectorSearch} /> : null}
          <ScrollView keyboardShouldPersistTaps="handled">
            {selector === 'product' ? filteredProducts.map((product) => <Pressable key={product.id} onPress={() => { setItems((current) => [...current, { productId: product.id, requestedQty: '1' }]); setSelector(null); }} style={styles.optionRow}><View style={styles.optionInfo}><Text style={styles.selectText}>{product.name}</Text><Text style={styles.sku}>{product.sku} · {product.unit.code}</Text></View><Plus size={18} color="#c70d17" /></Pressable>) : selectorOptions.map((option) => <Pressable key={option.id} onPress={() => { if (selector === 'branch') selectBranch(option.id); if (selector === 'source') setSourceWarehouseId(option.id); if (selector === 'destination') setDestinationWarehouseId(option.id); setSelector(null); }} style={styles.optionRow}><View style={styles.optionInfo}><Text style={styles.selectText}>{option.name}</Text>{option.code ? <Text style={styles.sku}>{option.code}</Text> : null}</View><ChevronRight size={18} color="#718078" /></Pressable>)}
            {selector === 'product' && filteredProducts.length === 0 ? <Text style={styles.noItems}>Tidak ada produk lain yang cocok.</Text> : null}
          </ScrollView>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 20, paddingTop: 18, paddingBottom: 32 },
  back: { alignSelf: 'flex-start', marginBottom: 20, paddingVertical: 4 }, backContent: { flexDirection: 'row', alignItems: 'center', gap: 7 }, headerAction: { minWidth: 46, flexDirection: 'row', alignItems: 'center', gap: 4 }, inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 5 }, backText: { color: '#c70d17', fontSize: 13, fontWeight: '800' },
  eyebrow: { color: '#c70d17', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }, heading: { flex: 1 },
  title: { color: '#172820', fontSize: 24, fontWeight: '800' }, subtitle: { marginTop: 5, color: '#718078', fontSize: 12 }, createButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#c70d17' }, createButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  notice: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: '#fbe7e8' }, noticeText: { color: '#c70d17', fontSize: 12, lineHeight: 18, fontWeight: '700' }, flowHint: { marginTop: 14, padding: 13, borderWidth: 1, borderColor: '#f0dadd', borderRadius: 14, backgroundColor: '#fff' }, flowHintTitle: { color: '#172820', fontSize: 12, fontWeight: '900' }, flowHintText: { marginTop: 4, color: '#718078', fontSize: 11, lineHeight: 17 },
  requestCard: { marginTop: 11, padding: 14, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 16, backgroundColor: '#fff' }, requestTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, requestTitle: { flex: 1 }, requestNumber: { color: '#26372e', fontSize: 14, fontWeight: '900' }, requestDate: { marginTop: 4, color: '#89958e', fontSize: 10 }, route: { marginTop: 12, color: '#59685f', fontSize: 11, lineHeight: 16 }, reviewNote: { marginTop: 8, color: '#a3332a', fontSize: 11, lineHeight: 16 },
  status: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, fontSize: 9, fontWeight: '900' }, statusPending: { backgroundColor: '#fff2d8', color: '#a86200' }, statusSuccess: { backgroundColor: '#e7f5ee', color: '#087f5b' }, statusMuted: { backgroundColor: '#f1f4f2', color: '#78857e' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 }, actionPrimary: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, backgroundColor: '#c70d17' }, actionPrimaryText: { color: '#fff', fontSize: 11, fontWeight: '800' }, actionSecondary: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f6f7f6' }, actionSecondaryText: { color: '#67756d', fontSize: 11, fontWeight: '800' },
  errorCard: { marginTop: 14, padding: 14, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 14, backgroundColor: '#fff6f5' }, errorText: { color: '#a3332a', fontSize: 12, lineHeight: 18 }, retry: { marginTop: 7, color: '#c70d17', fontSize: 12, fontWeight: '800' }, loader: { padding: 22 }, empty: { alignItems: 'center', marginTop: 18, padding: 22, borderRadius: 15, backgroundColor: '#fff' }, emptyTitle: { color: '#28372f', fontSize: 14, fontWeight: '800' }, emptyText: { marginTop: 6, color: '#819087', fontSize: 12, lineHeight: 18, textAlign: 'center' }, footerHint: { marginTop: 20, color: '#9aa59f', fontSize: 10, textAlign: 'center' },
  modalScreen: { flex: 1, backgroundColor: '#f5f7f6' }, modalHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#e6ece8', backgroundColor: '#fff' }, modalTitle: { color: '#172820', fontSize: 15, fontWeight: '900' }, formPage: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 20 }, formFooter: { paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e5e9ed', backgroundColor: '#fff' }, formIntro: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, padding: 14, borderWidth: 1, borderColor: '#f0dadd', borderRadius: 17, backgroundColor: '#fff' }, formIntroIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#fbe7e8' }, formIntroCopy: { flex: 1 }, formIntroTitle: { color: '#172820', fontSize: 14, fontWeight: '900' }, formIntroText: { marginTop: 4, color: '#718078', fontSize: 11, lineHeight: 16 }, locationCard: { flexDirection: 'row', alignItems: 'stretch', marginTop: 8, padding: 12, borderWidth: 1, borderColor: '#e4e9ed', borderRadius: 16, backgroundColor: '#fff' }, locationColumn: { flex: 1, minWidth: 0 }, locationLabel: { marginBottom: 7, color: '#718078', fontSize: 10, fontWeight: '800' }, locationSelect: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#f5f7f6' }, locationValue: { flex: 1, color: '#26372e', fontSize: 11, fontWeight: '800' }, locationDivider: { width: 1, marginHorizontal: 10, backgroundColor: '#e7ebee' }, catalogHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 11 }, catalogTitle: { color: '#172820', fontSize: 17, fontWeight: '900' }, catalogSubtitle: { marginTop: 4, color: '#84918b', fontSize: 11 }, catalogBadge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#fbe7e8' }, productSearchRow: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 15, backgroundColor: '#fff' }, productSearchInput: { flex: 1, height: '100%', color: '#172820', fontSize: 13 }, productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 12 }, stockProductCard: { width: '48.5%', minHeight: 210, padding: 10, borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 19, backgroundColor: '#fff' }, stockProductSelected: { borderColor: '#efb8bd' }, stockProductArtwork: { height: 85, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#f3e5fb' }, stockProductSku: { marginTop: 9, color: '#718078', fontSize: 9, fontWeight: '800' }, stockProductName: { minHeight: 34, marginTop: 4, color: '#172033', fontSize: 12, fontWeight: '900' }, stockProductUnit: { marginTop: 4, color: '#8994a0', fontSize: 9 }, stockProductBottom: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 7, marginTop: 9 }, addProductCircle: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#c70d17' }, quantityButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 11, backgroundColor: '#fff' }, quantityButtonActive: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#c70d17' }, catalogQtyInput: { width: 40, height: 34, paddingHorizontal: 2, color: '#172820', textAlign: 'center', fontSize: 13, fontWeight: '900' }, noteCard: { marginTop: 17, padding: 13, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 16, backgroundColor: '#fff' }, requestCartBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, paddingHorizontal: 13, borderWidth: 1, borderColor: '#e3e7eb', borderRadius: 15, backgroundColor: '#fff' }, requestCartCopy: { flex: 1 }, requestCartTitle: { color: '#172033', fontSize: 12, fontWeight: '900' }, requestCartSubtitle: { marginTop: 2, color: '#718078', fontSize: 10 }, requestCartCount: { minWidth: 25, paddingHorizontal: 7, paddingVertical: 4, overflow: 'hidden', borderRadius: 10, backgroundColor: '#fbe7e8', color: '#c70d17', textAlign: 'center', fontSize: 11, fontWeight: '900' }, fieldLabel: { marginTop: 16, marginBottom: 7, color: '#34453b', fontSize: 12, fontWeight: '800' }, selectField: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 15, backgroundColor: '#fff' }, selectText: { flex: 1, color: '#26372e', fontSize: 12, fontWeight: '700' }, chevron: { color: '#c70d17', fontSize: 17, fontWeight: '800' }, itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }, addProduct: { color: '#c70d17', fontSize: 12, fontWeight: '900' },
  formItem: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 15, backgroundColor: '#fff' }, formProduct: { flex: 1, minWidth: 0 }, sku: { marginTop: 3, color: '#89958e', fontSize: 10 }, qtyInput: { width: 62, height: 40, paddingHorizontal: 8, borderWidth: 1, borderColor: '#dce4df', borderRadius: 9, color: '#172820', textAlign: 'center', fontSize: 13 }, unitText: { color: '#718078', fontSize: 10 }, removeItem: { paddingHorizontal: 4, color: '#b42318', fontSize: 22 }, noItems: { paddingVertical: 13, color: '#89958e', fontSize: 11, textAlign: 'center' }, noteInput: { minHeight: 76, padding: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff', color: '#172820', fontSize: 12, textAlignVertical: 'top' }, formHint: { marginTop: 10, color: '#819087', fontSize: 10, lineHeight: 16 }, submitButton: { height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderRadius: 16, backgroundColor: '#c70d17' }, submitText: { color: '#fff', fontSize: 13, fontWeight: '900' }, disabled: { opacity: 0.5 },
  reviewItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, padding: 11, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' }, reviewProduct: { flex: 1, minWidth: 0 }, approvedQty: { color: '#087f5b', fontSize: 11, fontWeight: '800' }, rejectButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 9, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 14, backgroundColor: '#fff6f5' }, rejectButtonText: { color: '#b42318', fontSize: 13, fontWeight: '900' }, transferButton: { height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 12, borderRadius: 16, backgroundColor: '#087f5b' }, transferBackText: { color: '#087f5b', fontSize: 13, fontWeight: '800' }, transferRouteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 14, borderWidth: 1, borderColor: '#d8ebe1', borderRadius: 15, backgroundColor: '#fff' }, transferRouteColumn: { flex: 1, minWidth: 0 }, transferRouteValue: { marginTop: 5, color: '#26372e', fontSize: 12, fontWeight: '900' }, transferArrow: { color: '#087f5b', fontSize: 18, fontWeight: '900' }, transferItem: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9, padding: 12, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 14, backgroundColor: '#fff' }, remainingText: { marginTop: 5, color: '#087f5b', fontSize: 10, fontWeight: '800' }, transferQtyInput: { width: 78, height: 43, paddingHorizontal: 8, borderWidth: 1, borderColor: '#b8ddcd', borderRadius: 10, color: '#172820', textAlign: 'center', fontSize: 13, fontWeight: '900' }, transferSubmitButton: { height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#087f5b' },
  selectorBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }, selectorPanel: { maxHeight: '82%', paddingHorizontal: 17, paddingTop: 15, paddingBottom: 24, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#f8faf9' }, selectorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, selectorSearch: { height: 44, marginBottom: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 12, backgroundColor: '#fff', color: '#172820' }, optionRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#e8eeea' }, optionInfo: { flex: 1 },
});
