import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Check, ChevronDown, ChevronRight, ImagePlus, Minus, Package, PackagePlus, Plus, Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatDate, formatStatus } from '../../lib/display';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type NamedOption = { id: string; name: string; code?: string; branchId?: string | null };
type ProductUnit = { unitId: string; conversionFactor: string; unit: { id: string; code: string; name: string } };
type ProductOption = { id: string; name: string; sku: string; unitId: string; unit: { id: string; code: string; name: string }; unitConversions: ProductUnit[]; category?: { name: string } | null };
type RequestOptions = { branches: NamedOption[]; sourceWarehouses: NamedOption[]; destinationWarehouses: NamedOption[]; products: ProductOption[]; sourceStock: { warehouseId: string; productId: string; available: string }[] };
type Actor = { id: string; name: string };
type StockRequest = {
  id: string; requestNumber: string; status: string; note: string | null; reviewNote?: string | null; createdAt: string;
  branch: { name: string }; sourceWarehouse: { id: string; name: string }; destinationWarehouse: { id: string; name: string };
  _count: { items: number; transfers: number }; availableActions: string[];
  requestedBy?: Actor | null; reviewedBy?: Actor | null;
};
type RequestPage = { data: StockRequest[]; meta: { total: number } };
type RequestAction = 'PROCESS' | 'SEND' | 'RECEIVE';
type RequestDetail = StockRequest & {
  items: { id: string; productId: string; transferItemId?: string; requestedQty: string; sentQty?: string | null; receivedQty?: string | null; product: { id: string; name: string; sku: string }; unit?: { code: string } | null }[];
  evidenceImages?: { id: string; url: string; stage?: string | null; uploadedBy?: Actor | null }[];
  history?: { id: string; action: string; createdAt: string; actor?: Actor | null }[];
};
type RequestItem = { productId: string; unitId?: string; requestedQty: string; note?: string };
type Selector = 'branch' | 'source' | 'destination' | 'product' | null;

const WORKFLOW = ['SUBMITTED', 'PROCESSING', 'IN_TRANSIT', 'RECEIVED'] as const;
const STATUS_LABEL: Record<string, string> = { SUBMITTED: 'Permintaan masuk', PROCESSING: 'Diproses', IN_TRANSIT: 'Dikirim', RECEIVED: 'Diterima' };
// READY is the step name recorded for requests created before the four-step workflow.
const HISTORY_LABEL: Record<string, string> = { SUBMITTED: 'Permintaan masuk', READY: 'Permintaan masuk', PROCESSED: 'Diproses', SENT: 'Dikirim', RECEIVED: 'Diterima' };
const ACTION_COPY: Record<RequestAction, { button: string; done: string }> = {
  PROCESS: { button: 'Proses permintaan', done: 'Permintaan diproses. Cabang sudah diberi tahu.' },
  SEND: { button: 'Kirim barang', done: 'Barang dikirim. Stok gudang pusat sudah dikurangi.' },
  RECEIVE: { button: 'Konfirmasi diterima', done: 'Penerimaan barang tersimpan.' },
};
const MAX_PHOTOS = 12;
const requestPath = 'stock-requests?page=1&perPage=20&sortBy=createdAt&sortOrder=desc';

function ShoppingBagIcon() { return <Package size={22} color="#c70d17" />; }

export default function StockRequestsScreen() {
  const { user, authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const canCreate = user?.permissions.includes('stock_request.create') ?? false;
  const canProcess = user?.permissions.includes('transfer.send') ?? false;
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
  const [receiveValues, setReceiveValues] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const previousSourceWarehouseId = useRef('');


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
  const sourceAvailable = (productId: string, warehouseId = sourceWarehouseId) => Number(options?.sourceStock.find((stock) => stock.productId === productId && stock.warehouseId === warehouseId)?.available ?? 0);
  const quantityLabel = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 3 });

  useEffect(() => {
    const previousId = previousSourceWarehouseId.current;
    previousSourceWarehouseId.current = sourceWarehouseId;
    if (previousId && sourceWarehouseId && previousId !== sourceWarehouseId && items.length) {
      setItems([]);
      setNotice('Gudang asal berubah. Pilih ulang barang agar jumlah sesuai stok gudang tersebut.');
    }
  }, [items, sourceWarehouseId]);

  function addRequestProduct(product: ProductOption) {
    const maximum = sourceAvailable(product.id);
    if (maximum <= 0) { setError(`Stok gudang asal untuk ${product.name} kosong.`); return; }
    setError('');
    setItems((current) => current.some((item) => item.productId === product.id) ? current : [...current, { productId: product.id, requestedQty: String(Math.min(1, maximum)) }]);
  }

  function updateRequestQuantity(productId: string, value: string) {
    const normalized = value.replace(',', '.');
    const maximum = sourceAvailable(productId);
    if (normalized !== '' && Number.isFinite(Number(normalized)) && Number(normalized) > maximum) {
      setError(`Jumlah melebihi stok tersedia. Maksimal ${quantityLabel(maximum)}.`);
      setItems((current) => current.map((item) => item.productId === productId ? { ...item, requestedQty: String(maximum) } : item));
      return;
    }
    setError('');
    setItems((current) => current.map((item) => item.productId === productId ? { ...item, requestedQty: normalized } : item));
  }

  function incrementRequestQuantity(productId: string) {
    const maximum = sourceAvailable(productId);
    const current = Number(items.find((item) => item.productId === productId)?.requestedQty ?? 0);
    if (current >= maximum) { setError(`Jumlah sudah mencapai stok tersedia (${quantityLabel(maximum)}).`); return; }
    setError('');
    setItems((lines) => lines.map((item) => item.productId === productId ? { ...item, requestedQty: String(Math.min(current + 1, maximum)) } : item));
  }

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
    const overStock = items.find((item) => Number(item.requestedQty) > sourceAvailable(item.productId) + 0.000001);
    if (overStock) { setError(`Jumlah ${selectedProducts.find((product) => product.id === overStock.productId)?.name ?? 'barang'} melebihi stok gudang asal yang tersedia.`); return; }
    setSaving(true); setError('');
    try {
      await authorizedRequest<StockRequest>('stock-requests', { method: 'POST', body: JSON.stringify({ branchId, sourceWarehouseId, destinationWarehouseId, note: note.trim() || undefined, items }) });
      setFormVisible(false); setNotice('Permintaan terkirim dan menunggu diproses gudang pusat.'); setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Permintaan belum dapat dibuat.');
    } finally { setSaving(false); }
  }

  async function openDetail(id: string) {
    setDetailId(id); setDetail(null); setReceiveValues({}); setPhotos([]); setActionError(''); setDetailLoading(true);
    try {
      setDetail(await authorizedRequest<RequestDetail>(`stock-requests/${id}`));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Detail permintaan tidak dapat dimuat.'); setDetailId(null); }
    finally { setDetailLoading(false); }
  }

  function closeDetail() {
    if (actionSaving) return;
    setDetailId(null); setDetail(null); setPhotos([]); setActionError('');
  }

  async function pickPhotos(useCamera: boolean) {
    const remaining = MAX_PHOTOS - (detail?.evidenceImages?.length ?? 0) - photos.length;
    if (remaining <= 0) { setActionError(`Maksimal ${MAX_PHOTOS} foto untuk satu permintaan.`); return; }
    const permission = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setActionError(useCamera ? 'Izin kamera diperlukan untuk mengambil foto.' : 'Izin galeri diperlukan untuk memilih foto.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    if (result.assets.some((asset) => Number(asset.fileSize ?? 0) > 5 * 1024 * 1024)) { setActionError('Ukuran setiap foto maksimal 5 MB.'); return; }
    setPhotos((current) => [...current, ...result.assets].slice(0, remaining + current.length));
    setActionError('');
  }

  async function uploadPhotos(id: string) {
    const form = new FormData();
    photos.forEach((asset, index) => {
      const name = asset.fileName ?? asset.uri.split('/').pop() ?? `stock-request-${index}.jpg`;
      if (Platform.OS === 'web') {
        if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
        form.append('images', asset.file, name);
      } else form.append('images', new File(asset.uri), name);
    });
    await authorizedRequest(`stock-requests/${id}/evidence`, { method: 'POST', body: form });
  }

  async function runStep(action: RequestAction) {
    if (!detail) return;
    const id = detail.id;
    let body: string | undefined;
    if (action === 'RECEIVE') {
      const lines = detail.items.map((item) => {
        const expected = item.sentQty ?? item.requestedQty;
        const receivedQty = (receiveValues[item.id] ?? expected).replace(',', '.');
        return { item, expected, receivedQty };
      });
      if (lines.some((line) => line.receivedQty === '' || !Number.isFinite(Number(line.receivedQty)) || Number(line.receivedQty) < 0)) { setActionError('Isi jumlah diterima yang valid untuk setiap barang.'); return; }
      body = JSON.stringify({
        items: lines.map(({ item, expected, receivedQty }) => ({
          itemId: item.transferItemId,
          receivedQty,
          ...(Number(receivedQty) !== Number(expected) ? { discrepancyReason: 'QUANTITY_ERROR', discrepancyNote: 'Selisih dicatat saat penerimaan permintaan stok.' } : {}),
        })),
      });
    }
    setActionSaving(true); setActionError('');
    let stepDone = false;
    try {
      await authorizedRequest(`stock-requests/${id}/${action.toLowerCase()}`, { method: 'POST', ...(body ? { body } : {}) });
      stepDone = true;
      // Upload after the step succeeds so the photos are filed under the new status.
      if (photos.length) await uploadPhotos(id);
      setPhotos([]); setReceiveValues({});
      setNotice(ACTION_COPY[action].done);
      setDetail(await authorizedRequest<RequestDetail>(`stock-requests/${id}`));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Aksi belum dapat diproses.';
      setActionError(stepDone ? `Status sudah diperbarui, tetapi foto gagal diunggah: ${message}` : message);
      if (stepDone) setDetail(await authorizedRequest<RequestDetail>(`stock-requests/${id}`).catch(() => detail));
    } finally {
      setActionSaving(false);
      setReloadKey((key) => key + 1);
    }
  }

  const selectorTitle = selector === 'branch' ? 'Pilih cabang' : selector === 'source' ? 'Pilih gudang asal' : selector === 'destination' ? 'Pilih gudang tujuan' : 'Pilih produk';
  const selectorOptions: NamedOption[] = selector === 'branch' ? branches : selector === 'source' ? sources : selector === 'destination' ? destinations : [];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReloadKey((key) => key + 1); }} tintColor="#c70d17" />}>
        <View style={styles.headingRow}><View style={styles.heading}><Text style={styles.subtitle}>{canProcess ? 'Proses, kirim, dan pantau permintaan stok dari cabang.' : 'Ajukan kebutuhan stok ke gudang pusat dan pantau prosesnya.'}</Text></View>{canCreate ? <Pressable accessibilityRole="button" onPress={openCreateForm} style={styles.createButton}><Text style={styles.createButtonText}>＋ Buat</Text></Pressable> : null}</View>
        <View style={styles.flowHint}><Text style={styles.flowHintTitle}>Alur permintaan stok</Text><Text style={styles.flowHintText}>Permintaan masuk → Diproses → Dikirim → Diterima. {canProcess ? 'Buka permintaan untuk memproses atau mengirim, dan lampirkan foto bila perlu.' : 'Konfirmasi penerimaan saat barang tiba di cabang.'}</Text></View>
        {notice ? <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View> : null}
        {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { setLoading(true); setReloadKey((key) => key + 1); }}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
        {!canRead ? <View style={styles.empty}><Text style={styles.emptyTitle}>Akses daftar tidak tersedia</Text><Text style={styles.emptyText}>Akun ini dapat membuat pengajuan, tetapi perlu permission inventory.read untuk melihat daftar permintaan.</Text></View> : null}
        {loading ? <ActivityIndicator style={styles.loader} color="#c70d17" size="large" /> : null}
        {canRead && !loading && !error && requests.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Belum ada permintaan</Text><Text style={styles.emptyText}>{canCreate ? 'Buat pengajuan pertama untuk mengisi ulang stok cabang.' : 'Permintaan stok akan tampil di sini.'}</Text></View> : null}
        {requests.map((request) => <View key={request.id} style={styles.requestCard}>
          <View style={styles.requestTop}><View style={styles.requestTitle}><Text style={styles.requestNumber}>{request.requestNumber}</Text><Text style={styles.requestDate}>{formatDate(request.createdAt)} · {request._count.items} produk</Text></View><Text style={[styles.status, request.status === 'RECEIVED' ? styles.statusSuccess : request.status === 'SUBMITTED' ? styles.statusPending : styles.statusActive]}>{STATUS_LABEL[request.status] ?? formatStatus(request.status)}</Text></View>
          <Text style={styles.route}>{request.branch.name} · {request.sourceWarehouse.name} → {request.destinationWarehouse.name}</Text>
          <Text style={styles.actorLine}>Pemohon: {request.requestedBy?.name ?? '-'} · Diproses oleh: {request.reviewedBy?.name ?? '-'}</Text>
          <View style={styles.actions}>{(() => {
            const next = (['PROCESS', 'SEND', 'RECEIVE'] as const).find((name) => request.availableActions?.includes(name));
            return <Pressable accessibilityRole="button" onPress={() => void openDetail(request.id)} style={next ? styles.actionPrimary : styles.actionSecondary}><Text style={next ? styles.actionPrimaryText : styles.actionSecondaryText}>{next ? ACTION_COPY[next].button : 'Lihat detail'}</Text></Pressable>;
          })()}</View>
        </View>)}
        <Text style={styles.footerHint}>Tarik layar ke bawah untuk memperbarui status.</Text>
      </ScrollView>

      <Modal animationType="slide" visible={formVisible} onRequestClose={() => setFormVisible(false)}>
        <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 8, minHeight: 66 + insets.top }]}><Pressable accessibilityRole="button" onPress={() => setFormVisible(false)} style={styles.headerAction}><X size={19} color="#c70d17" /><Text style={styles.backText}>Batal</Text></Pressable><Text style={styles.modalTitle}>Pengajuan stok</Text><View style={{ width: 46 }} /></View>
          <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
            <View style={styles.formIntro}><View style={styles.formIntroIcon}><PackagePlus size={22} color="#c70d17" /></View><View style={styles.formIntroCopy}><Text style={styles.formIntroTitle}>Ajukan kebutuhan stok</Text><Text style={styles.formIntroText}>Tentukan cabang tujuan, lalu cari dan tambah barang seperti saat berbelanja di POS.</Text></View></View>
            <View style={styles.locationCard}>
              <View style={styles.locationColumn}><Text style={styles.locationLabel}>Cabang</Text><Pressable disabled={Boolean(user?.branchId)} onPress={() => setSelector('branch')} style={styles.locationSelect}><Text numberOfLines={1} style={styles.locationValue}>{selectedBranch?.name ?? 'Pilih cabang'}</Text>{user?.branchId ? null : <ChevronDown size={17} color="#718078" />}</Pressable></View>
              <View style={styles.locationDivider} />
              <View style={styles.locationColumn}><Text style={styles.locationLabel}>Gudang tujuan</Text><Pressable onPress={() => setSelector('destination')} style={styles.locationSelect}><Text numberOfLines={1} style={styles.locationValue}>{selectedDestination?.name ?? 'Pilih gudang'}</Text><ChevronDown size={17} color="#718078" /></Pressable></View>
            </View>
            <Text style={styles.fieldLabel}>Gudang asal</Text><Pressable onPress={() => setSelector('source')} style={styles.selectField}><Text numberOfLines={1} style={styles.selectText}>{selectedSource?.name ?? 'Pilih gudang asal'}</Text><ChevronDown size={18} color="#718078" /></Pressable>
            <View style={styles.catalogHeading}><View><Text style={styles.catalogTitle}>Pilih barang</Text><Text style={styles.catalogSubtitle}>{items.length ? items.length + ' jenis barang dipilih' : 'Cari produk yang ingin diajukan'}</Text></View><View style={styles.catalogBadge}><ShoppingBagIcon /></View></View>
            <View style={styles.productSearchRow}><Search size={19} color="#84918b" /><TextInput value={productSearch} onChangeText={setProductSearch} placeholder="Cari nama barang atau SKU..." placeholderTextColor="#87948c" style={styles.productSearchInput} /></View>
            <View style={styles.productGrid}>{filteredProducts.map((product) => {
              const selected = items.find((item) => item.productId === product.id);
              const maximum = sourceAvailable(product.id);
              const atLimit = !sourceWarehouseId || maximum <= 0 || Number(selected?.requestedQty ?? 0) >= maximum;
              return <View key={product.id} style={[styles.stockProductCard, selected && styles.stockProductSelected]}>
                <View style={styles.stockProductArtwork}><PackagePlus size={29} color="#8b45d6" /></View>
                <Text numberOfLines={1} style={styles.stockProductSku}>{product.sku}</Text>
                <Text numberOfLines={2} style={styles.stockProductName}>{product.name}</Text>
                <Text style={styles.stockProductUnit}>Satuan: {product.unit.code}</Text>
                <Text style={styles.stockProductUnit}>Tersedia: {quantityLabel(maximum)} {product.unit.code}</Text>
                <View style={styles.stockProductBottom}>{selected ? <>
                  <Pressable accessibilityRole="button" accessibilityLabel={'Kurangi jumlah ' + product.name} style={styles.quantityButton} onPress={() => setItems((current) => current.flatMap((line) => line.productId !== product.id ? [line] : Number(line.requestedQty) <= 1 ? [] : [{ ...line, requestedQty: String(Number(line.requestedQty) - 1) }]))}><Minus size={16} color="#c70d17" /></Pressable>
                  <TextInput accessibilityLabel={'Jumlah ' + product.name} keyboardType="decimal-pad" value={selected.requestedQty} onChangeText={(value) => updateRequestQuantity(product.id, value)} style={styles.catalogQtyInput} />
                  <Pressable accessibilityRole="button" accessibilityLabel={'Tambah jumlah ' + product.name} disabled={atLimit} style={[styles.quantityButtonActive, atLimit && styles.disabled]} onPress={() => incrementRequestQuantity(product.id)}><Plus size={16} color="#fff" /></Pressable>
                </> : <Pressable accessibilityRole="button" accessibilityLabel={'Tambah ' + product.name} disabled={!sourceWarehouseId || maximum <= 0} style={[styles.addProductCircle, (!sourceWarehouseId || maximum <= 0) && styles.disabled]} onPress={() => addRequestProduct(product)}><Plus size={21} color="#fff" /></Pressable>}</View>
              </View>;
            })}</View>
            {!filteredProducts.length ? <Text style={styles.noItems}>{productSearch ? 'Barang tidak ditemukan.' : 'Tidak ada barang yang tersedia.'}</Text> : null}
            <View style={styles.noteCard}><Text style={styles.fieldLabel}>Catatan (opsional)</Text><TextInput multiline value={note} onChangeText={setNote} placeholder="Alasan atau informasi tambahan" placeholderTextColor="#8a968f" style={styles.noteInput} /></View>
            <Text style={styles.formHint}>Permintaan langsung masuk ke gudang pusat dengan status Permintaan masuk.</Text>
            {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
          </KeyboardAwareScrollView><View style={[styles.formFooter, { paddingBottom: Math.max(14, insets.bottom + 8) }]}><View style={styles.requestCartBar}><ShoppingBagIcon /><View style={styles.requestCartCopy}><Text style={styles.requestCartTitle}>{items.reduce((sum, item) => sum + (Number(item.requestedQty) || 0), 0)} barang diminta</Text><Text style={styles.requestCartSubtitle}>{items.length} jenis produk</Text></View><Text style={styles.requestCartCount}>{items.length}</Text></View><Pressable accessibilityRole="button" disabled={saving || !options || !items.length} onPress={() => void createRequest()} style={[styles.submitButton, (saving || !options || !items.length) && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Kirim permintaan</Text>}</Pressable></View>
        </View>
      </Modal>

      <Modal animationType="slide" visible={Boolean(detailId)} onRequestClose={closeDetail}>
        <View style={styles.modalScreen}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 8, minHeight: 66 + insets.top }]}><Pressable accessibilityRole="button" disabled={actionSaving} onPress={closeDetail} style={styles.headerAction}><X size={19} color="#c70d17" /><Text style={styles.backText}>Tutup</Text></Pressable><Text style={styles.modalTitle}>Detail permintaan</Text><View style={{ width: 46 }} /></View>
          {detailLoading || !detail ? <ActivityIndicator style={styles.loader} color="#c70d17" size="large" /> : (() => {
            const currentStep = WORKFLOW.indexOf(detail.status as (typeof WORKFLOW)[number]);
            const nextAction = (['PROCESS', 'SEND', 'RECEIVE'] as const).find((name) => detail.availableActions.includes(name));
            const savedPhotos = detail.evidenceImages ?? [];
            const canAddPhoto = Boolean(nextAction) && savedPhotos.length + photos.length < MAX_PHOTOS;
            return <>
              <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled">
                <Text style={styles.requestNumber}>{detail.requestNumber}</Text>
                <Text style={styles.route}>{detail.branch.name} · {detail.sourceWarehouse.name} → {detail.destinationWarehouse.name}</Text>

                <View accessibilityLabel={`Tahap: ${STATUS_LABEL[detail.status] ?? detail.status}`} style={styles.stepper}>{WORKFLOW.map((step, index) => {
                  const done = index < currentStep || (index === currentStep && step === 'RECEIVED');
                  const active = index === currentStep && !done;
                  return <View key={step} style={styles.step}>
                    <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>{done ? <Check size={13} color="#fff" /> : <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>{index + 1}</Text>}</View>
                    <Text numberOfLines={2} style={[styles.stepLabel, index <= currentStep && styles.stepLabelReached]}>{STATUS_LABEL[step]}</Text>
                  </View>;
                })}</View>

                <View style={styles.actorCard}><View><Text style={styles.actorLabel}>PEMOHON</Text><Text style={styles.actorName}>{detail.requestedBy?.name ?? '-'}</Text></View><View><Text style={styles.actorLabel}>DIPROSES OLEH</Text><Text style={styles.actorName}>{detail.reviewedBy?.name ?? '-'}</Text></View></View>
                {detail.note ? <Text style={styles.detailNote}>Catatan: {detail.note}</Text> : null}

                <Text style={styles.fieldLabel}>Barang</Text>
                {detail.items.map((item) => {
                  const unit = item.unit?.code ?? '';
                  const expected = item.sentQty ?? item.requestedQty;
                  return <View key={item.id} style={styles.reviewItem}>
                    <View style={styles.reviewProduct}><Text style={styles.selectText}>{item.product.name}</Text><Text style={styles.sku}>Diminta {item.requestedQty} {unit}{item.sentQty != null && detail.status !== 'SUBMITTED' && detail.status !== 'PROCESSING' ? ` · dikirim ${item.sentQty} ${unit}` : ''}{item.receivedQty != null ? ` · diterima ${item.receivedQty} ${unit}` : ''}</Text></View>
                    {nextAction === 'RECEIVE' ? <TextInput accessibilityLabel={`Jumlah diterima ${item.product.name}`} keyboardType="decimal-pad" value={receiveValues[item.id] ?? expected} onChangeText={(value) => setReceiveValues((current) => ({ ...current, [item.id]: value }))} style={styles.qtyInput} /> : null}
                  </View>;
                })}

                <Text style={styles.fieldLabel}>Foto bukti {nextAction ? '(opsional)' : ''}</Text>
                {savedPhotos.length || photos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                  {savedPhotos.map((image) => <View key={image.id} style={styles.photoTile}><Image source={{ uri: image.url }} style={styles.photo} /><Text numberOfLines={1} style={styles.photoStage}>{image.stage ? STATUS_LABEL[image.stage] ?? image.stage : 'Bukti'}</Text></View>)}
                  {photos.map((asset, index) => <View key={`${asset.assetId ?? asset.uri}-${index}`} style={[styles.photoTile, styles.photoTileNew]}><Image source={{ uri: asset.uri }} style={styles.photo} /><Text style={[styles.photoStage, styles.photoStageNew]}>BARU</Text><Pressable accessibilityRole="button" accessibilityLabel={`Hapus foto ${index + 1}`} onPress={() => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.photoRemove}><X size={13} color="#fff" /></Pressable></View>)}
                </ScrollView> : <Text style={styles.noItems}>{nextAction ? 'Belum ada foto. Lampirkan bila perlu.' : 'Belum ada foto bukti.'}</Text>}
                {canAddPhoto ? <View style={styles.photoButtons}>
                  <Pressable accessibilityRole="button" disabled={actionSaving} onPress={() => void pickPhotos(true)} style={styles.photoButton}><Camera size={17} color="#087f5b" /><Text style={styles.photoButtonText}>Kamera</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={actionSaving} onPress={() => void pickPhotos(false)} style={styles.photoButton}><ImagePlus size={17} color="#087f5b" /><Text style={styles.photoButtonText}>Galeri</Text></Pressable>
                </View> : null}
                {nextAction && photos.length ? <Text style={styles.formHint}>Foto disimpan sebagai bukti tahap {STATUS_LABEL[WORKFLOW[currentStep + 1] ?? detail.status]}.</Text> : null}

                {detail.history?.length ? <><Text style={styles.fieldLabel}>Riwayat</Text>{detail.history.map((entry) => <View key={entry.id} style={styles.historyRow}><View style={styles.historyDot} /><View style={styles.reviewProduct}><Text style={styles.historyAction}>{HISTORY_LABEL[entry.action] ?? formatStatus(entry.action)}</Text><Text style={styles.sku}>{entry.actor?.name ?? 'Sistem'} · {formatDate(entry.createdAt)}</Text></View></View>)}</> : null}
                {actionError ? <Text accessibilityRole="alert" style={[styles.errorText, styles.actionError]}>{actionError}</Text> : null}
              </KeyboardAwareScrollView>
              {nextAction ? <View style={[styles.formFooter, { paddingBottom: Math.max(14, insets.bottom + 8) }]}><Pressable accessibilityRole="button" disabled={actionSaving} onPress={() => void runStep(nextAction)} style={[styles.stepButton, actionSaving && styles.disabled]}>{actionSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{ACTION_COPY[nextAction].button}{photos.length ? ` + ${photos.length} foto` : ''}</Text>}</Pressable></View> : null}
            </>;
          })()}
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={selector !== null} onRequestClose={() => setSelector(null)}>
        <KeyboardAvoidingView behavior="padding" style={styles.selectorBackdrop}><View style={[styles.selectorPanel, { paddingBottom: insets.bottom + 12 }]}><View style={styles.selectorHeader}><Text style={styles.modalTitle}>{selectorTitle}</Text><Pressable onPress={() => setSelector(null)}><Text style={styles.backText}>Tutup</Text></Pressable></View>
          {selector === 'product' ? <TextInput autoFocus value={productSearch} onChangeText={setProductSearch} placeholder="Cari nama atau SKU" placeholderTextColor="#8a968f" style={styles.selectorSearch} /> : null}
          <ScrollView keyboardShouldPersistTaps="handled">
            {selector === 'product' ? filteredProducts.map((product) => <Pressable key={product.id} onPress={() => { setItems((current) => [...current, { productId: product.id, requestedQty: '1' }]); setSelector(null); }} style={styles.optionRow}><View style={styles.optionInfo}><Text style={styles.selectText}>{product.name}</Text><Text style={styles.sku}>{product.sku} · {product.unit.code}</Text></View><Plus size={18} color="#c70d17" /></Pressable>) : selectorOptions.map((option) => <Pressable key={option.id} onPress={() => { if (selector === 'branch') selectBranch(option.id); if (selector === 'source') setSourceWarehouseId(option.id); if (selector === 'destination') setDestinationWarehouseId(option.id); setSelector(null); }} style={styles.optionRow}><View style={styles.optionInfo}><Text style={styles.selectText}>{option.name}</Text>{option.code ? <Text style={styles.sku}>{option.code}</Text> : null}</View><ChevronRight size={18} color="#718078" /></Pressable>)}
            {selector === 'product' && filteredProducts.length === 0 ? <Text style={styles.noItems}>Tidak ada produk lain yang cocok.</Text> : null}
          </ScrollView>
        </View></KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 20, paddingTop: 18, paddingBottom: 32 },
  back: { alignSelf: 'flex-start', marginBottom: 20, paddingVertical: 4 }, backContent: { flexDirection: 'row', alignItems: 'center', gap: 7 }, headerAction: { minWidth: 46, flexDirection: 'row', alignItems: 'center', gap: 4 }, inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 5 }, backText: { color: '#c70d17', fontSize: 12, fontWeight: '800' },
  eyebrow: { color: '#c70d17', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }, heading: { flex: 1 },
  title: { color: '#172820', fontSize: 25, fontWeight: '800' }, subtitle: { marginTop: 5, color: '#718078', fontSize: 12 }, createButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#c70d17' }, createButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  notice: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: '#fbe7e8' }, noticeText: { color: '#c70d17', fontSize: 12, lineHeight: 18, fontWeight: '700' }, flowHint: { marginTop: 14, padding: 13, borderWidth: 1, borderColor: '#f0dadd', borderRadius: 14, backgroundColor: '#fff' }, flowHintTitle: { color: '#172820', fontSize: 12, fontWeight: '900' }, flowHintText: { marginTop: 4, color: '#718078', fontSize: 11, lineHeight: 17 },
  requestCard: { marginTop: 11, padding: 14, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 16, backgroundColor: '#fff' }, requestTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, requestTitle: { flex: 1 }, requestNumber: { color: '#26372e', fontSize: 14, fontWeight: '900' }, requestDate: { marginTop: 4, color: '#89958e', fontSize: 10 }, route: { marginTop: 12, color: '#59685f', fontSize: 11, lineHeight: 16 }, reviewNote: { marginTop: 8, color: '#a3332a', fontSize: 11, lineHeight: 16 },
  status: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, fontSize: 9, fontWeight: '900' }, statusPending: { backgroundColor: '#fff2d8', color: '#a86200' }, statusSuccess: { backgroundColor: '#e7f5ee', color: '#087f5b' }, statusActive: { backgroundColor: '#e6effc', color: '#2659b5' }, statusMuted: { backgroundColor: '#f1f4f2', color: '#78857e' },
  actorLine: { marginTop: 7, color: '#718078', fontSize: 10, lineHeight: 15 }, actorCard: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, marginTop: 14, padding: 13, borderRadius: 13, backgroundColor: '#e7f5ee' }, actorLabel: { color: '#087f5b', fontSize: 9, fontWeight: '900' }, actorName: { marginTop: 4, color: '#26372e', fontSize: 12, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 }, actionPrimary: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, backgroundColor: '#c70d17' }, actionPrimaryText: { color: '#fff', fontSize: 11, fontWeight: '800' }, actionSecondary: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f6f7f6' }, actionSecondaryText: { color: '#67756d', fontSize: 11, fontWeight: '800' },
  errorCard: { marginTop: 14, padding: 14, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 14, backgroundColor: '#fff6f5' }, errorText: { color: '#a3332a', fontSize: 12, lineHeight: 18 }, retry: { marginTop: 7, color: '#c70d17', fontSize: 12, fontWeight: '800' }, loader: { padding: 22 }, empty: { alignItems: 'center', marginTop: 18, padding: 22, borderRadius: 15, backgroundColor: '#fff' }, emptyTitle: { color: '#28372f', fontSize: 14, fontWeight: '800' }, emptyText: { marginTop: 6, color: '#819087', fontSize: 12, lineHeight: 18, textAlign: 'center' }, footerHint: { marginTop: 20, color: '#9aa59f', fontSize: 10, textAlign: 'center' },
  modalScreen: { flex: 1, backgroundColor: '#f5f7f6' }, modalHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#e6ece8', backgroundColor: '#fff' }, modalTitle: { color: '#172820', fontSize: 15, fontWeight: '900' }, formPage: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 20 }, formFooter: { paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e5e9ed', backgroundColor: '#fff' }, formIntro: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, padding: 14, borderWidth: 1, borderColor: '#f0dadd', borderRadius: 17, backgroundColor: '#fff' }, formIntroIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#fbe7e8' }, formIntroCopy: { flex: 1 }, formIntroTitle: { color: '#172820', fontSize: 14, fontWeight: '900' }, formIntroText: { marginTop: 4, color: '#718078', fontSize: 11, lineHeight: 16 }, locationCard: { flexDirection: 'row', alignItems: 'stretch', marginTop: 8, padding: 12, borderWidth: 1, borderColor: '#e4e9ed', borderRadius: 16, backgroundColor: '#fff' }, locationColumn: { flex: 1, minWidth: 0 }, locationLabel: { marginBottom: 7, color: '#718078', fontSize: 10, fontWeight: '800' }, locationSelect: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#f5f7f6' }, locationValue: { flex: 1, color: '#26372e', fontSize: 11, fontWeight: '800' }, locationDivider: { width: 1, marginHorizontal: 10, backgroundColor: '#e7ebee' }, catalogHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 11 }, catalogTitle: { color: '#172820', fontSize: 14, fontWeight: '900' }, catalogSubtitle: { marginTop: 4, color: '#84918b', fontSize: 11 }, catalogBadge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#fbe7e8' }, productSearchRow: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 15, backgroundColor: '#fff' }, productSearchInput: { flex: 1, height: '100%', color: '#172820', fontSize: 12 }, productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 12 }, stockProductCard: { width: '48.5%', minHeight: 210, padding: 10, borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 19, backgroundColor: '#fff' }, stockProductSelected: { borderColor: '#efb8bd' }, stockProductArtwork: { height: 85, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#f3e5fb' }, stockProductSku: { marginTop: 9, color: '#718078', fontSize: 9, fontWeight: '800' }, stockProductName: { minHeight: 34, marginTop: 4, color: '#172033', fontSize: 12, fontWeight: '900' }, stockProductUnit: { marginTop: 4, color: '#8994a0', fontSize: 9 }, stockProductBottom: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 7, marginTop: 9 }, addProductCircle: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#c70d17' }, quantityButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 11, backgroundColor: '#fff' }, quantityButtonActive: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#c70d17' }, catalogQtyInput: { width: 40, height: 34, paddingHorizontal: 2, color: '#172820', textAlign: 'center', fontSize: 12, fontWeight: '900' }, noteCard: { marginTop: 17, padding: 13, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 16, backgroundColor: '#fff' }, requestCartBar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, paddingHorizontal: 13, borderWidth: 1, borderColor: '#e3e7eb', borderRadius: 15, backgroundColor: '#fff' }, requestCartCopy: { flex: 1 }, requestCartTitle: { color: '#172033', fontSize: 12, fontWeight: '900' }, requestCartSubtitle: { marginTop: 2, color: '#718078', fontSize: 10 }, requestCartCount: { minWidth: 25, paddingHorizontal: 7, paddingVertical: 4, overflow: 'hidden', borderRadius: 10, backgroundColor: '#fbe7e8', color: '#c70d17', textAlign: 'center', fontSize: 11, fontWeight: '900' }, fieldLabel: { marginTop: 16, marginBottom: 7, color: '#34453b', fontSize: 12, fontWeight: '800' }, selectField: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 15, backgroundColor: '#fff' }, selectText: { flex: 1, color: '#26372e', fontSize: 12, fontWeight: '700' }, chevron: { color: '#c70d17', fontSize: 17, fontWeight: '800' }, itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }, addProduct: { color: '#c70d17', fontSize: 12, fontWeight: '900' },
  formItem: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 15, backgroundColor: '#fff' }, formProduct: { flex: 1, minWidth: 0 }, sku: { marginTop: 3, color: '#89958e', fontSize: 10 }, qtyInput: { width: 62, height: 40, paddingHorizontal: 8, borderWidth: 1, borderColor: '#dce4df', borderRadius: 9, color: '#172820', textAlign: 'center', fontSize: 12 }, unitText: { color: '#718078', fontSize: 10 }, removeItem: { paddingHorizontal: 4, color: '#b42318', fontSize: 22 }, noItems: { paddingVertical: 13, color: '#89958e', fontSize: 11, textAlign: 'center' }, noteInput: { minHeight: 76, padding: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff', color: '#172820', fontSize: 12, textAlignVertical: 'top' }, formHint: { marginTop: 10, color: '#819087', fontSize: 10, lineHeight: 16 }, submitButton: { height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderRadius: 16, backgroundColor: '#c70d17' }, submitText: { color: '#fff', fontSize: 12, fontWeight: '900' }, disabled: { opacity: 0.5 },
  reviewItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, padding: 11, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' }, reviewProduct: { flex: 1, minWidth: 0 }, approvedQty: { color: '#087f5b', fontSize: 11, fontWeight: '800' }, rejectButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 9, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 14, backgroundColor: '#fff6f5' }, rejectButtonText: { color: '#b42318', fontSize: 12, fontWeight: '900' }, transferButton: { height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 12, borderRadius: 16, backgroundColor: '#087f5b' }, transferBackText: { color: '#087f5b', fontSize: 12, fontWeight: '800' }, transferRouteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 14, borderWidth: 1, borderColor: '#d8ebe1', borderRadius: 15, backgroundColor: '#fff' }, transferRouteColumn: { flex: 1, minWidth: 0 }, transferRouteValue: { marginTop: 5, color: '#26372e', fontSize: 12, fontWeight: '900' }, transferArrow: { color: '#087f5b', fontSize: 18, fontWeight: '900' }, transferItem: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9, padding: 12, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 14, backgroundColor: '#fff' }, remainingText: { marginTop: 5, color: '#087f5b', fontSize: 10, fontWeight: '800' }, transferQtyInput: { width: 78, height: 43, paddingHorizontal: 8, borderWidth: 1, borderColor: '#b8ddcd', borderRadius: 10, color: '#172820', textAlign: 'center', fontSize: 12, fontWeight: '900' }, transferSubmitButton: { height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#087f5b' },
  stepper: { flexDirection: 'row', marginTop: 16, padding: 12, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 14, backgroundColor: '#fff' }, step: { flex: 1, alignItems: 'center', gap: 6 },
  stepDot: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#eef1ef' }, stepDotDone: { backgroundColor: '#087f5b' }, stepDotActive: { borderWidth: 2, borderColor: '#087f5b', backgroundColor: '#e7f5ee' },
  stepNumber: { color: '#9aa59f', fontSize: 11, fontWeight: '900' }, stepNumberActive: { color: '#087f5b' }, stepLabel: { color: '#9aa59f', fontSize: 9, fontWeight: '800', textAlign: 'center' }, stepLabelReached: { color: '#26372e' },
  detailNote: { marginTop: 10, color: '#59685f', fontSize: 11, lineHeight: 16 },
  photoRow: { gap: 8, paddingVertical: 2 }, photoTile: { width: 84, overflow: 'hidden', borderWidth: 1, borderColor: '#e1e7e3', borderRadius: 12, backgroundColor: '#fff' }, photoTileNew: { borderWidth: 2, borderColor: '#5fc39b' }, photo: { width: '100%', height: 70, backgroundColor: '#eef1ef' },
  photoStage: { paddingHorizontal: 5, paddingVertical: 4, color: '#59685f', fontSize: 9, fontWeight: '800', textAlign: 'center' }, photoStageNew: { color: '#087f5b' }, photoRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#0a1729b3' },
  photoButtons: { flexDirection: 'row', gap: 8, marginTop: 10 }, photoButton: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: '#b8ddcd', borderRadius: 12, backgroundColor: '#f1faf6' }, photoButtonText: { color: '#087f5b', fontSize: 12, fontWeight: '800' },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 7 }, historyDot: { width: 8, height: 8, marginTop: 5, borderRadius: 4, backgroundColor: '#087f5b' }, historyAction: { color: '#26372e', fontSize: 12, fontWeight: '800' },
  actionError: { marginTop: 14 }, stepButton: { height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#087f5b' },
  selectorBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }, selectorPanel: { maxHeight: '82%', paddingHorizontal: 17, paddingTop: 15, paddingBottom: 24, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#f8faf9' }, selectorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, selectorSearch: { height: 44, marginBottom: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 12, backgroundColor: '#fff', color: '#172820' }, optionRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#e8eeea' }, optionInfo: { flex: 1 },
});
