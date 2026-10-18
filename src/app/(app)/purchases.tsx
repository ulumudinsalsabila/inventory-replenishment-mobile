import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Check, ChevronDown, ChevronRight, Gift, Minus, Package, Plus, Search, X, Camera, ImagePlus } from 'lucide-react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { getRange, rangeOptions, type RangePreset } from '../../lib/date-range';
import { formatDate, formatStatus } from '../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { fetchAllPages } from '../../lib/paging';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { DistributorPurchaseWizard } from '../../components/distributor-purchase-wizard';
import { OptionSheet } from '../../components/option-sheet';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { PreviewImage } from '../../components/image-viewer';

type Purchase = {
  id: string;
  distributorId: string;
  warehouseId: string;
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
  items: { id: string; productId: string; unitId: string | null; lineType: 'PURCHASE' | 'BONUS'; orderedQty: string; receivedQty: string | null; unitPrice: string; discountAmount: string; subtotal: string; beforeStock?: string | null; afterStock?: string | null; product: { sku: string; name: string; unit?: { id: string; code: string } | null }; unit?: { code: string } | null }[];
  attachments?: { id: string; url: string; fileName: string; createdAt: string }[];
};
type Page<T> = { data: T[]; meta: { page: number; totalPages: number; total: number } };
type BonusUnit = { unitId: string; canPurchase: boolean; unit: { code: string } };
type BonusProduct = { id: string; sku: string; name: string; active?: boolean; unitId: string; unit: { code: string }; unitConversions?: BonusUnit[] };
type BonusLine = { productId: string; unitId: string; receivedQty: string };
type DateFilter = RangePreset | 'all';

const money = (value: string | number) => `Rp ${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
// Same four statuses as the web purchase page.
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Diajukan', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan' };
const statusLabel = (status: string) => STATUS_LABEL[status] ?? formatStatus(status);

const purchaseDetailStyles = StyleSheet.create({
  detailInfo: { marginTop: 7, padding: 9, borderRadius: 9, backgroundColor: '#fff' }, detailStats: { flexDirection: 'row', gap: 7, marginTop: 8 }, detailStat: { flex: 1, padding: 9, borderRadius: 9, backgroundColor: '#fff' }, detailSectionTitle: { marginTop: 12, marginBottom: 4, color: '#26384a', fontSize: 10, fontWeight: '900' },
  receivedInput: { height: 34, marginTop: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: '#dfe7eb', borderRadius: 8, color: '#26384a', fontSize: 9 }, attachmentList: { gap: 7, paddingVertical: 6 }, attachmentImage: { width: 72, height: 72, borderRadius: 9, backgroundColor: '#edf2f4' },
  receiveError: { marginTop: 8, padding: 9, borderRadius: 8, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 9 }, receiveButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, borderRadius: 10, backgroundColor: '#07885b' }, receiveButtonText: { color: '#fff', fontSize: 9, fontWeight: '900' }, disabled: { opacity: 0.5 },
});
const statusColor = (status: string) => status === 'COMPLETED' ? styles.statusComplete : status === 'SUBMITTED' ? styles.statusSubmitted : status === 'CANCELLED' ? styles.statusCancelled : styles.statusDraft;

export default function DistributorPurchasesScreen() {
  const { user, authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const canRead = user?.permissions.includes('purchase.read') ?? false;
  const canManage = user?.permissions.includes('purchase.manage') ?? false;
  const canReceive = user?.permissions.includes('purchase.receive') ?? false;
  const [selected, setSelected] = useState<PurchaseDetail | null>(null);
  const [editingDraft, setEditingDraft] = useState<PurchaseDetail | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [statusFilter, setStatusFilter] = useState('');
  const [distributorFilter, setDistributorFilter] = useState('');
  const [distributors, setDistributors] = useState<{ id: string; name: string }[]>([]);
  const [distributorSheet, setDistributorSheet] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [createVisible, setCreateVisible] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState('');
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, string>>({});
  const [bonusLines, setBonusLines] = useState<BonusLine[]>([]);
  const [bonusProducts, setBonusProducts] = useState<BonusProduct[]>([]);
  const [bonusPickerVisible, setBonusPickerVisible] = useState(false);
  const [bonusSearch, setBonusSearch] = useState('');
  const [bonusLoading, setBonusLoading] = useState(false);

  const params = new URLSearchParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  if (search) params.set('search', search);
  if (statusFilter) params.set('status', statusFilter);
  if (distributorFilter) params.set('distributorId', distributorFilter);
  if (dateFilter !== 'all') { const { from, to } = getRange(dateFilter); params.set('dateFrom', from); params.set('dateTo', to); }
  const list = useInfiniteList<Purchase>(authorizedRequest, canRead ? `distributor-purchases?${params.toString()}` : null);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);
  const rows = list.items;

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void authorizedRequest<Page<{ id: string; name: string }>>('distributors?page=1&perPage=100&sortBy=name&sortOrder=asc')
      .then((result) => { if (active) setDistributors(result.data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [authorizedRequest, canRead]);


  function resetBonus() {
    setBonusLines([]); setBonusPickerVisible(false); setBonusSearch('');
  }

  async function openBonusPicker() {
    setBonusPickerVisible(true);
    if (bonusProducts.length) return;
    setBonusLoading(true);
    try {
      const result = await fetchAllPages<BonusProduct>(authorizedRequest, 'products?sortBy=name&sortOrder=asc');
      setBonusProducts(result.data.filter((product) => product.active !== false));
    } catch (cause) { setReceiveError(cause instanceof ApiError ? cause.message : 'Katalog produk belum dapat dimuat.'); }
    finally { setBonusLoading(false); }
  }

  // Same unit options as the purchase wizard: base unit first, then purchasable conversions.
  function bonusUnitOptions(product: BonusProduct): BonusUnit[] {
    return [{ unitId: product.unitId, canPurchase: true, unit: product.unit }, ...(product.unitConversions ?? []).filter((unit) => unit.canPurchase)];
  }

  function changeBonusQuantity(product: BonusProduct, delta: number) {
    setBonusLines((current) => {
      if (!current.some((line) => line.productId === product.id)) return delta > 0 ? [...current, { productId: product.id, unitId: product.unitId, receivedQty: '1' }] : current;
      return current.flatMap((line) => {
        if (line.productId !== product.id) return [line];
        const next = Math.round(((Number(line.receivedQty) || 0) + delta) * 10000) / 10000;
        return next > 0 ? [{ ...line, receivedQty: String(next) }] : [];
      });
    });
  }

  async function openDetail(purchase: Purchase) {
    setSelected(null);
    setDetailLoading(true);
    setReceiveError('');
    resetBonus();
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
    setEditingDraft(null);
    void list.reload();
    setDetailLoading(true);
    resetBonus();
    try {
      const detail = await authorizedRequest<PurchaseDetail>(`distributor-purchases/${purchaseId}`);
      setSelected(detail);
      setReceivedQuantities(Object.fromEntries(detail.items.map((item) => [item.id, item.receivedQty ?? item.orderedQty])));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Pembelian dibuat, tetapi detail belum dapat dimuat.'); }
    finally { setDetailLoading(false); }
  }

  function openDraftForEditing() {
    if (!selected) return;
    setEditingDraft(selected);
    setSelected(null);
    setCreateVisible(true);
  }

  function cancelDraftEditing() {
    setCreateVisible(false);
    if (editingDraft) setSelected(editingDraft);
    setEditingDraft(null);
  }

  async function refreshSelectedPurchase(id: string) {
    const detail = await authorizedRequest<PurchaseDetail>(`distributor-purchases/${id}`);
    setSelected(detail);
    void list.reload();
  }

  async function addAttachments(useCamera: boolean) {
    if (!selected || selected.status !== 'DRAFT' || !canManage) return;
    const currentCount = selected.attachments?.length ?? 0;
    if (currentCount >= 12) { setReceiveError('Maksimal 12 foto untuk satu pembelian.'); return; }
    const permission = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setReceiveError(useCamera ? 'Izin kamera diperlukan untuk mengambil foto.' : 'Izin galeri diperlukan untuk memilih foto.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 12 - currentCount, quality: 0.75, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
    if (result.canceled || !result.assets.length) return;
    if (result.assets.length + currentCount > 12 || result.assets.some((asset) => Number(asset.fileSize ?? 0) > 5 * 1024 * 1024)) { setReceiveError('Maksimal 12 foto dan ukuran tiap foto maksimal 5 MB.'); return; }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (result.assets.some((asset) => asset.mimeType && !allowedTypes.includes(asset.mimeType))) { setReceiveError('Foto harus berformat JPEG, PNG, atau WebP.'); return; }
    setUploadingAttachments(true); setReceiveError('');
    try {
      for (let start = 0; start < result.assets.length; start += 8) {
        const form = new FormData();
        result.assets.slice(start, start + 8).forEach((asset, index) => {
          const name = asset.fileName ?? asset.uri.split('/').pop() ?? `invoice-${start + index}.jpg`;
          if (Platform.OS === 'web') {
            if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
            form.append('images', asset.file, name);
          } else form.append('images', new File(asset.uri), name);
        });
        await authorizedRequest(`distributor-purchases/${selected.id}/attachments`, { method: 'POST', body: form });
      }
      await refreshSelectedPurchase(selected.id);
    } catch (cause) { setReceiveError(cause instanceof Error ? cause.message : 'Lampiran gagal diunggah.'); }
    finally { setUploadingAttachments(false); }
  }

  async function removeAttachment(attachmentId: string) {
    if (!selected || selected.status !== 'DRAFT' || !canManage) return;
    setUploadingAttachments(true); setReceiveError('');
    try {
      await authorizedRequest(`distributor-purchases/${selected.id}/attachments/${attachmentId}`, { method: 'DELETE' });
      await refreshSelectedPurchase(selected.id);
    } catch (cause) { setReceiveError(cause instanceof Error ? cause.message : 'Lampiran gagal dihapus.'); }
    finally { setUploadingAttachments(false); }
  }

  async function runPurchaseTransition(action: 'submit' | 'cancel') {
    if (!selected) return;
    setReceiving(true); setReceiveError('');
    try {
      await authorizedRequest(`distributor-purchases/${selected.id}/${action}`, { method: 'POST' });
      await refreshSelectedPurchase(selected.id);
    } catch (cause) { setReceiveError(cause instanceof Error ? cause.message : 'Status pembelian gagal diperbarui.'); }
    finally { setReceiving(false); }
  }

  function confirmPurchaseTransition(action: 'submit' | 'cancel') {
    if (!selected) return;
    if (action === 'submit' && !selected.attachments?.length) { setReceiveError('Tambahkan minimal satu foto bukti sebelum submit.'); return; }
    Alert.alert(
      action === 'submit' ? 'Submit pembelian?' : 'Batalkan pembelian?',
      action === 'submit' ? 'Invoice akan dibuat dan data utama pembelian dikunci.' : 'Pembelian ini tidak dapat diproses lebih lanjut setelah dibatalkan.',
      [{ text: 'Kembali', style: 'cancel' }, { text: action === 'submit' ? 'Submit' : 'Ya, batalkan', style: action === 'cancel' ? 'destructive' : 'default', onPress: () => void runPurchaseTransition(action) }],
    );
  }

  async function completePurchase() {
    if (!selected) return;
    if (selected.items.some((item) => !(Number(receivedQuantities[item.id]) > 0))) { setReceiveError('Jumlah diterima untuk setiap produk harus lebih dari nol.'); return; }
    if (bonusLines.some((line) => !(Number(line.receivedQty) > 0))) { setReceiveError('Jumlah produk bonus harus lebih dari nol.'); return; }
    Alert.alert('Selesaikan penerimaan?', `Jumlah diterima${bonusLines.length ? ` dan ${bonusLines.length} produk bonus` : ''} akan disimpan dan stok Gudang Pusat akan bertambah.`, [
      { text: 'Kembali', style: 'cancel' },
      { text: 'Selesaikan', onPress: () => void confirmCompletePurchase() },
    ]);
  }

  async function confirmCompletePurchase() {
    if (!selected) return;
    setReceiving(true); setReceiveError('');
    try {
      await authorizedRequest(`distributor-purchases/${selected.id}/complete`, { method: 'POST', body: JSON.stringify({
        items: selected.items.map((item) => ({ itemId: item.id, receivedQty: receivedQuantities[item.id] })),
        ...(bonusLines.length ? { bonusItems: bonusLines } : {}),
      }) });
      const detail = await authorizedRequest<PurchaseDetail>(`distributor-purchases/${selected.id}`);
      setSelected(detail); void list.reload(); resetBonus();
    } catch (cause) { setReceiveError(cause instanceof ApiError ? cause.message : 'Penerimaan belum dapat diselesaikan.'); }
    finally { setReceiving(false); }
  }

  if (createVisible) return <><Tabs.Screen options={{ title: 'Pembelian Distributor', headerShown: false }} /><DistributorPurchaseWizard initialDraft={editingDraft ?? undefined} onCancel={cancelDraftEditing} onSaved={(purchaseId) => void openCreatedPurchase(purchaseId)} /></>;

  // The tab header is a custom component that ignores `headerRight`, so the create action lives in the screen body.
  return <><Tabs.Screen options={{ title: 'Pembelian Distributor', headerShown: true }} /><View style={styles.screen}>
    <KeyboardAwareScrollView {...scrollProps} bottomOffset={24} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor="#07885b" />}>
      {canManage ? <Pressable accessibilityRole="button" onPress={() => { setEditingDraft(null); setCreateVisible(true); }} style={({ pressed }) => [styles.createButton, pressed && styles.rowPressed]}><Plus size={18} color="#fff" /><Text style={styles.createButtonText}>Buat pembelian</Text></Pressable> : null}
      {canRead ? <>
        <View style={styles.searchBox}><Search size={17} color="#71839a" /><TextInput accessibilityLabel="Cari pembelian" autoCapitalize="none" autoCorrect={false} value={searchInput} onChangeText={setSearchInput} placeholder="Nomor invoice atau distributor" placeholderTextColor="#8b99a8" style={styles.searchInput} returnKeyType="search" />{searchInput ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" hitSlop={8} onPress={() => setSearchInput('')}><X size={16} color="#71839a" /></Pressable> : null}</View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{[{ label: 'Semua status', value: '' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))].map((filter) => <Pressable key={filter.value || 'all'} accessibilityRole="button" accessibilityState={{ selected: statusFilter === filter.value }} onPress={() => setStatusFilter(filter.value)} style={[styles.filterChip, statusFilter === filter.value && styles.filterChipActive]}><Text style={[styles.filterText, statusFilter === filter.value && styles.filterTextActive]}>{filter.label}</Text></Pressable>)}</ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <Pressable accessibilityRole="button" accessibilityLabel="Filter distributor" onPress={() => setDistributorSheet(true)} style={[styles.filterChip, styles.filterSelect, distributorFilter ? styles.filterChipActive : null]}><Text numberOfLines={1} style={[styles.filterText, distributorFilter ? styles.filterTextActive : null]}>{distributors.find((item) => item.id === distributorFilter)?.name ?? 'Semua distributor'}</Text><ChevronDown size={12} color={distributorFilter ? '#fff' : '#60758a'} /></Pressable>
          {[{ id: 'all' as const, label: 'Semua tanggal' }, ...rangeOptions].map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: dateFilter === option.id }} onPress={() => setDateFilter(option.id)} style={[styles.filterChip, dateFilter === option.id && styles.filterChipActive]}><Text style={[styles.filterText, dateFilter === option.id && styles.filterTextActive]}>{option.label}</Text></Pressable>)}
        </ScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {list.error && !rows.length ? <View style={styles.errorCard}><Text style={styles.errorText}>{list.error}</Text><Pressable accessibilityRole="button" onPress={() => void list.reload()}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
        {list.loading && !rows.length ? <ActivityIndicator style={styles.loader} color="#07885b" /> : null}
        {!list.loading && !list.error && !rows.length ? <View style={styles.empty}><Package size={22} color="#8091a4" /><Text style={styles.emptyTitle}>Belum ada pembelian</Text><Text style={styles.emptyText}>Pembelian distributor akan tampil di sini.</Text></View> : null}
        {rows.map((purchase) => <Pressable key={purchase.id} accessibilityRole="button" onPress={() => void openDetail(purchase)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <View style={styles.rowIcon}><Package size={19} color="#168a68" /></View>
          <View style={styles.rowBody}><View style={styles.rowTitleLine}><Text numberOfLines={1} style={styles.invoice}>{purchase.invoiceNumber ?? purchase.distributorInvoiceNumber ?? 'Draft pembelian'}</Text><Text style={[styles.status, statusColor(purchase.status)]}>{statusLabel(purchase.status)}</Text></View><Text numberOfLines={1} style={styles.distributor}>{purchase.distributor.name}</Text><Text style={styles.meta}>{formatDate(purchase.purchaseDate)} · {purchase.warehouse.name} · {purchase._count.items} item</Text></View>
          <View style={styles.rowRight}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.total}>{money(purchase.grandTotal)}</Text><ChevronRight size={17} color="#91a0ae" /></View>
        </Pressable>)}
        <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={rows.length} error={list.error} onRetry={list.loadMore} />
      </> : <View style={styles.empty}><Text style={styles.emptyTitle}>Akses tidak tersedia</Text><Text style={styles.emptyText}>Akun ini belum memiliki izin melihat pembelian distributor.</Text></View>}
    </KeyboardAwareScrollView>
    <Modal visible={detailLoading || Boolean(selected)} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}><View style={[styles.detailSheet, { paddingBottom: Math.max(insets.bottom + 8, 24) }]}>
        <View style={styles.detailHeader}><View><Text style={styles.detailTitle}>Detail pembelian</Text>{selected ? <Text style={styles.meta}>{selected.invoiceNumber ?? selected.distributorInvoiceNumber ?? 'Draft pembelian'}</Text> : null}</View><Pressable accessibilityRole="button" accessibilityLabel="Tutup detail" onPress={() => setSelected(null)} style={styles.closeButton}><X size={19} color="#4c5e70" /></Pressable></View>
        {detailLoading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : selected ? <KeyboardAwareScrollView bottomOffset={24} style={styles.detailContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.detailMeta}>{selected.distributor.name} · {selected.warehouse.name}</Text>
          <View style={purchaseDetailStyles.detailStats}><View style={purchaseDetailStyles.detailStat}><Text style={styles.detailMeta}>Status</Text><Text style={[styles.status, styles.detailStatus, statusColor(selected.status)]}>{statusLabel(selected.status)}</Text></View><View style={purchaseDetailStyles.detailStat}><Text style={styles.detailMeta}>Tanggal</Text><Text style={styles.detailProduct}>{formatDate(selected.purchaseDate)}</Text></View></View>
          <View style={purchaseDetailStyles.detailStats}><View style={purchaseDetailStyles.detailStat}><Text style={styles.detailMeta}>Invoice distributor</Text><Text style={styles.detailProduct}>{selected.distributorInvoiceNumber || '—'}</Text></View><View style={purchaseDetailStyles.detailStat}><Text style={styles.detailMeta}>Total</Text><Text style={styles.detailTotalValue}>{money(selected.grandTotal)}</Text></View></View>
          <Text style={purchaseDetailStyles.detailSectionTitle}>Daftar produk ({selected.items.length})</Text>
          {selected.items.map((item) => <View key={item.id} style={styles.detailItem}><View style={styles.detailItemText}><View style={styles.lineTitle}><Text style={[styles.lineType, item.lineType === 'BONUS' && styles.lineTypeBonus]}>{item.lineType === 'BONUS' ? 'Bonus' : 'Beli'}</Text><Text numberOfLines={2} style={[styles.detailProduct, styles.flexText]}>{item.product.name}</Text></View><Text style={styles.meta}>{item.product.sku} · {item.orderedQty} {item.unit?.code ?? item.product.unit?.code ?? ''} × {money(item.unitPrice)}{Number(item.discountAmount) > 0 ? ` · diskon ${money(item.discountAmount)}` : ''}</Text>{selected.status === 'SUBMITTED' && canReceive ? <TextInput accessibilityLabel={`Jumlah diterima ${item.product.name}`} value={receivedQuantities[item.id] ?? item.orderedQty} onChangeText={(value) => setReceivedQuantities((current) => ({ ...current, [item.id]: value.replace(',', '.') }))} keyboardType="decimal-pad" style={purchaseDetailStyles.receivedInput} placeholder="Jumlah diterima" /> : item.receivedQty ? <Text style={styles.meta}>Diterima {item.receivedQty} {item.unit?.code ?? ''}</Text> : null}{item.beforeStock != null ? <Text style={styles.meta}>Stok dasar {item.beforeStock} → {item.afterStock}</Text> : null}</View><Text style={styles.detailAmount}>{money(item.subtotal)}</Text></View>)}
          {selected.status === 'SUBMITTED' && canReceive ? <>
            <View style={styles.attachmentHeading}><View><Text style={purchaseDetailStyles.detailSectionTitle}>Produk bonus ({bonusLines.length})</Text><Text style={styles.meta}>Tambahkan bonus dari distributor yang ikut diterima</Text></View></View>
            {bonusLines.map((line) => {
              const product = bonusProducts.find((entry) => entry.id === line.productId);
              if (!product) return null;
              const units = bonusUnitOptions(product);
              return <View key={line.productId} style={styles.detailItem}>
                <View style={styles.detailItemText}><View style={styles.lineTitle}><Text style={[styles.lineType, styles.lineTypeBonus]}>Bonus</Text><Text numberOfLines={2} style={[styles.detailProduct, styles.flexText]}>{product.name}</Text></View><Text style={styles.meta}>{product.sku}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bonusUnits}>{units.map((unit) => <Pressable key={unit.unitId} accessibilityRole="button" accessibilityState={{ selected: line.unitId === unit.unitId }} onPress={() => setBonusLines((current) => current.map((entry) => entry.productId === line.productId ? { ...entry, unitId: unit.unitId } : entry))} style={[styles.bonusUnitChip, line.unitId === unit.unitId && styles.bonusUnitChipActive]}><Text style={[styles.bonusUnitText, line.unitId === unit.unitId && styles.bonusUnitTextActive]}>{unit.unit.code}</Text></Pressable>)}</ScrollView>
                </View>
                <View style={styles.bonusStepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Kurangi bonus ${product.name}`} hitSlop={6} onPress={() => changeBonusQuantity(product, -1)} style={styles.bonusStepButton}><Minus size={14} color="#07885b" /></Pressable>
                  <TextInput accessibilityLabel={`Jumlah bonus ${product.name}`} keyboardType="decimal-pad" value={line.receivedQty} onChangeText={(value) => setBonusLines((current) => current.map((entry) => entry.productId === line.productId ? { ...entry, receivedQty: value.replace(',', '.') } : entry))} style={styles.bonusQtyInput} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`Tambah bonus ${product.name}`} hitSlop={6} onPress={() => changeBonusQuantity(product, 1)} style={styles.bonusStepButton}><Plus size={14} color="#07885b" /></Pressable>
                </View>
              </View>;
            })}
            {bonusPickerVisible ? <View style={styles.bonusPicker}>
              <View style={styles.bonusPickerHeader}><View style={styles.bonusSearchBox}><Search size={15} color="#71839a" /><TextInput accessibilityLabel="Cari produk bonus" value={bonusSearch} onChangeText={setBonusSearch} placeholder="Cari produk atau SKU" placeholderTextColor="#8b99a8" style={styles.searchInput} /></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup pilihan bonus" onPress={() => { setBonusPickerVisible(false); setBonusSearch(''); }} style={styles.closeButton}><X size={16} color="#4c5e70" /></Pressable></View>
              {bonusLoading ? <ActivityIndicator style={styles.loader} color="#07885b" /> : bonusProducts
                .filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(bonusSearch.trim().toLowerCase()))
                .slice(0, 30)
                .map((product) => {
                  const qty = Number(bonusLines.find((line) => line.productId === product.id)?.receivedQty ?? 0);
                  return <Pressable key={product.id} accessibilityRole="button" accessibilityLabel={`Tambah bonus ${product.name}`} onPress={() => changeBonusQuantity(product, 1)} style={({ pressed }) => [styles.bonusRow, pressed && styles.rowPressed]}>
                    <View style={styles.detailItemText}><Text numberOfLines={1} style={styles.detailProduct}>{product.name}</Text><Text style={styles.meta}>{product.sku} · {product.unit.code}</Text></View>
                    {qty > 0 ? <Text style={styles.bonusBadge}>{qty}</Text> : <Plus size={16} color="#07885b" />}
                  </Pressable>;
                })}
            </View> : <Pressable accessibilityRole="button" disabled={receiving} onPress={() => void openBonusPicker()} style={styles.bonusAddButton}><Gift size={15} color="#087f5b" /><Text style={styles.attachmentButtonText}>Tambah produk bonus</Text></Pressable>}
          </> : null}
          {(selected.status === 'DRAFT' || selected.attachments?.length) ? <><View style={styles.attachmentHeading}><View><Text style={purchaseDetailStyles.detailSectionTitle}>Foto invoice</Text><Text style={styles.meta}>{selected.attachments?.length ?? 0}/12 foto · minimal 1 sebelum submit</Text></View>{uploadingAttachments ? <ActivityIndicator color="#07885b" /> : null}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={purchaseDetailStyles.attachmentList}>{selected.attachments?.map((attachment) => <View key={attachment.id} style={styles.attachmentWrap}><PreviewImage uri={attachment.url} images={selected.attachments?.map((entry) => entry.url)} index={selected.attachments?.indexOf(attachment)} accessibilityLabel={attachment.fileName} style={purchaseDetailStyles.attachmentImage} />{selected.status === 'DRAFT' && canManage ? <Pressable accessibilityRole="button" accessibilityLabel={`Hapus foto ${attachment.fileName}`} disabled={uploadingAttachments} onPress={() => void removeAttachment(attachment.id)} style={styles.removeAttachment}><X size={12} color="#fff" /></Pressable> : null}</View>)}</ScrollView>{selected.status === 'DRAFT' && canManage && (selected.attachments?.length ?? 0) < 12 ? <View style={styles.attachmentActions}><Pressable accessibilityRole="button" disabled={uploadingAttachments} onPress={() => void addAttachments(true)} style={styles.attachmentButton}><Camera size={15} color="#087f5b" /><Text style={styles.attachmentButtonText}>Ambil foto</Text></Pressable><Pressable accessibilityRole="button" disabled={uploadingAttachments} onPress={() => void addAttachments(false)} style={styles.attachmentButton}><ImagePlus size={15} color="#087f5b" /><Text style={styles.attachmentButtonText}>Pilih galeri</Text></Pressable></View> : null}{!selected.attachments?.length ? <Text style={styles.emptyText}>Belum ada bukti dipilih.</Text> : null}</> : null}
          {selected.note ? <Text style={styles.detailMeta}>Catatan: {selected.note}</Text> : null}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}><Text style={styles.detailMeta}>Subtotal</Text><Text style={styles.detailProduct}>{money(selected.subtotal)}</Text></View>
            <View style={styles.summaryRow}><Text style={styles.detailMeta}>Diskon transaksi</Text><Text style={styles.detailProduct}>- {money(selected.discountAmount)}</Text></View>
            <View style={styles.summaryRow}><Text style={styles.detailMeta}>Biaya tambahan</Text><Text style={styles.detailProduct}>{money(selected.additionalCost)}</Text></View>
          </View>
          <View style={styles.detailTotal}><Text style={styles.detailTotalLabel}>Total pembelian</Text><Text style={styles.detailTotalValue}>{money(selected.grandTotal)}</Text></View>
          {receiveError ? <Text style={purchaseDetailStyles.receiveError}>{receiveError}</Text> : null}
          {selected.status === 'DRAFT' && canManage ? <View style={styles.draftActions}><Pressable accessibilityRole="button" disabled={receiving || uploadingAttachments} onPress={openDraftForEditing} style={styles.draftSecondary}><Text style={styles.draftSecondaryText}>Edit draft</Text></Pressable><Pressable accessibilityRole="button" disabled={receiving || uploadingAttachments || !(selected.attachments?.length)} onPress={() => confirmPurchaseTransition('submit')} style={[purchaseDetailStyles.receiveButton, (receiving || uploadingAttachments || !selected.attachments?.length) && purchaseDetailStyles.disabled]}><Text style={purchaseDetailStyles.receiveButtonText}>Submit & buat invoice</Text></Pressable><Pressable accessibilityRole="button" disabled={receiving || uploadingAttachments} onPress={() => confirmPurchaseTransition('cancel')} style={styles.draftCancel}><Text style={styles.draftCancelText}>Batalkan</Text></Pressable></View> : null}
          {selected.status === 'SUBMITTED' && canManage ? <Pressable accessibilityRole="button" disabled={receiving} onPress={() => confirmPurchaseTransition('cancel')} style={styles.draftCancel}><Text style={styles.draftCancelText}>Batalkan pembelian</Text></Pressable> : null}
          {selected.status === 'SUBMITTED' && canReceive ? <Pressable accessibilityRole="button" disabled={receiving} onPress={() => void completePurchase()} style={[purchaseDetailStyles.receiveButton, receiving && purchaseDetailStyles.disabled]}>{receiving ? <ActivityIndicator color="#fff" /> : <><Check size={16} color="#fff" /><Text style={purchaseDetailStyles.receiveButtonText}>Selesaikan penerimaan</Text></>}</Pressable> : null}
        </KeyboardAwareScrollView> : null}
      </View></KeyboardAvoidingView>
    </Modal>
    <OptionSheet visible={distributorSheet} title="Filter distributor" selectedId={distributorFilter} onSelect={setDistributorFilter} onClose={() => setDistributorSheet(false)}
      options={[{ id: '', label: 'Semua distributor' }, ...distributors.map((item) => ({ id: item.id, label: item.name }))]} />
  </View></>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' }, page: { padding: 16, paddingTop: 12, paddingBottom: 24 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 }, backText: { color: '#07885b', fontSize: 11, fontWeight: '800' },
  eyebrow: { color: '#07885b', fontSize: 9, fontWeight: '900' }, title: { marginTop: 5, marginBottom: 14, color: '#172338', fontSize: 25, fontWeight: '900' }, headerCreateButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#e4f7ef' },
  filters: { gap: 7, paddingBottom: 10 }, filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#edf2f5' }, filterChipActive: { backgroundColor: '#07885b' }, filterText: { color: '#60758a', fontSize: 9, fontWeight: '800' }, filterTextActive: { color: '#fff' },
  searchBox: { height: 43, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e2e9ed', borderRadius: 11, backgroundColor: '#fff' }, searchInput: { flex: 1, color: '#172338', fontSize: 10 },
  error: { marginBottom: 9, padding: 10, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10 }, errorCard: { marginBottom: 9, padding: 12, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 11, backgroundColor: '#fff6f5' }, errorText: { color: '#a3332a', fontSize: 10, lineHeight: 15 }, retry: { marginTop: 7, color: '#07885b', fontSize: 10, fontWeight: '800' }, loader: { padding: 20 }, empty: { alignItems: 'center', gap: 7, marginTop: 22, padding: 20, borderWidth: 1, borderColor: '#e5ecef', borderRadius: 13, backgroundColor: '#fff' }, emptyTitle: { color: '#26384a', fontSize: 12, fontWeight: '900' }, emptyText: { color: '#7a8a9b', fontSize: 10, textAlign: 'center' },
  row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8, padding: 10, borderWidth: 1, borderColor: '#e8eef1', borderRadius: 12, backgroundColor: '#fff' }, rowPressed: { opacity: 0.75 }, rowIcon: { width: 37, height: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#e4f7ef' }, rowBody: { flex: 1, minWidth: 0 }, rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 5 }, invoice: { flex: 1, color: '#25364a', fontSize: 10, fontWeight: '900' }, distributor: { marginTop: 4, color: '#344b5e', fontSize: 10, fontWeight: '700' }, meta: { marginTop: 4, color: '#7b8b9b', fontSize: 9 }, rowRight: { width: 75, alignItems: 'flex-end', gap: 5 }, total: { width: '100%', color: '#07885b', fontSize: 9, fontWeight: '900', textAlign: 'right' }, status: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, fontSize: 9, fontWeight: '900' }, statusDraft: { color: '#6e7680', backgroundColor: '#eff2f4' }, statusSubmitted: { color: '#996400', backgroundColor: '#fff2d5' }, statusComplete: { color: '#087c53', backgroundColor: '#def7eb' }, statusCancelled: { color: '#a53631', backgroundColor: '#ffebe9' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, detailSheet: { maxHeight: '84%', paddingHorizontal: 15, paddingTop: 15, paddingBottom: 24, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#f7f9fa' }, detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }, detailTitle: { color: '#172338', fontSize: 14, fontWeight: '900' }, closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#edf1f4' }, detailContent: { flexGrow: 0 }, detailMeta: { marginTop: 4, color: '#6e7f91', fontSize: 9 }, detailItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: '#fff' }, detailItemText: { flex: 1 }, detailProduct: { color: '#27394c', fontSize: 10, fontWeight: '800' }, detailAmount: { color: '#263a4e', fontSize: 9, fontWeight: '800' }, detailTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#e4f7ef' }, detailTotalLabel: { color: '#3f6959', fontSize: 10, fontWeight: '800' }, detailTotalValue: { color: '#07885b', fontSize: 11, fontWeight: '900' },
  attachmentHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }, attachmentWrap: { position: 'relative' }, removeAttachment: { position: 'absolute', top: 3, right: 3, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#a3332a' }, attachmentActions: { flexDirection: 'row', gap: 7, marginTop: 7 }, attachmentButton: { minHeight: 38, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 9, backgroundColor: '#e5f7ee' }, attachmentButtonText: { color: '#087c53', fontSize: 9, fontWeight: '900' }, draftActions: { gap: 8, marginTop: 12 }, draftSecondary: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dce4df', borderRadius: 9, backgroundColor: '#fff' }, draftSecondaryText: { color: '#53677e', fontSize: 9, fontWeight: '800' }, draftCancel: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 8, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 9, backgroundColor: '#fff6f5' }, draftCancelText: { color: '#a3332a', fontSize: 9, fontWeight: '900' },
  filterSelect: { maxWidth: 190, flexDirection: 'row', alignItems: 'center', gap: 4 },  detailStatus: { alignSelf: 'flex-start', marginTop: 4 }, lineTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 }, flexText: { flex: 1 }, lineType: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, color: '#53677e', backgroundColor: '#eef2f5', fontSize: 9, fontWeight: '900' }, lineTypeBonus: { color: '#7a3fc0', backgroundColor: '#f1e7fc' },
  bonusStepper: { flexDirection: 'row', alignItems: 'center', gap: 4 }, bonusStepButton: { width: 28, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#e5f7ee' }, bonusQtyInput: { width: 46, height: 30, padding: 0, borderWidth: 1, borderColor: '#dfe7eb', borderRadius: 8, color: '#26384a', fontSize: 10, textAlign: 'center' },
  bonusUnits: { gap: 5, paddingTop: 6 }, bonusUnitChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: '#edf2f5' }, bonusUnitChipActive: { backgroundColor: '#d9f3e8' }, bonusUnitText: { color: '#61748a', fontSize: 9, fontWeight: '800' }, bonusUnitTextActive: { color: '#087c53' },
  bonusAddButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#9fd8bf', borderRadius: 9, backgroundColor: '#f3fbf7' }, bonusPicker: { gap: 6, marginTop: 8, padding: 9, borderRadius: 10, backgroundColor: '#fff' }, bonusPickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 }, bonusSearchBox: { height: 36, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, borderWidth: 1, borderColor: '#e2e9ed', borderRadius: 9 }, bonusRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f0f2f4' }, bonusBadge: { minWidth: 24, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 12, color: '#fff', backgroundColor: '#07885b', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  summaryCard: { gap: 6, marginTop: 10, padding: 11, borderRadius: 10, backgroundColor: '#fff' }, summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  createButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12, borderRadius: 12, backgroundColor: '#07885b' }, createButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  pdfButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 9, borderWidth: 1, borderColor: '#e0e8ed', borderRadius: 9, backgroundColor: '#fff' }, pdfButtonText: { color: '#53677e', fontSize: 9, fontWeight: '900' },
});
