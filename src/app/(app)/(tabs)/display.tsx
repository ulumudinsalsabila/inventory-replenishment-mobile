import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Image as ImageIcon, Minus, Package, Plus, Search, Store, Undo2, X } from 'lucide-react-native';
import { LoadMoreFooter } from '../../../components/load-more-footer';
import { useAuth } from '../../../auth/auth-provider';
import { ApiError } from '../../../lib/api';
import { formatDate } from '../../../lib/display';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../../lib/infinite-list';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type Warehouse = { id: string; code: string; name: string; branchId: string | null };
type Page<T> = { data: T[]; meta: { total: number; totalPages: number } };
type Unit = { id: string; code: string; name: string; conversionFactor: string };
type CatalogProduct = { productId: string; sku: string; name: string; warehouseAvailable: string; displayQuantity: string; units: Unit[] };
type DisplayStock = { id: string; quantity: string; warehouseAvailable: string; updatedAt: string; product: { id: string; sku: string; name: string; unit: { code: string; name: string } }; warehouse: { id: string; name: string; code: string } };
type MovementType = 'DISPLAY_IN' | 'DISPLAY_RETURN' | 'DISPLAY_SALE' | 'DISPLAY_ADJUSTMENT';
type Movement = { id: string; movementNumber: string; type: MovementType; status: 'COMPLETED' | 'VOIDED'; note?: string | null; voidReason?: string | null; createdAt: string; createdBy?: { name: string } | null; warehouse: { name: string; code: string }; order?: { orderNumber: string } | null; _count?: { items: number; evidenceImages: number }; items?: { id: string; quantity: string; beforeQuantity: string; afterQuantity: string; product: { name: string; sku: string; unit: { code: string } } }[]; evidenceImages?: { id: string; url: string; fileName: string }[] };
type DraftLine = { productId: string; unitId: string; quantity: string };
type Evidence = { uri: string; name: string; size: number; asset: ImagePicker.ImagePickerAsset };

const movementLabels: Record<MovementType, string> = { DISPLAY_IN: 'Masuk display', DISPLAY_RETURN: 'Kembali ke gudang', DISPLAY_SALE: 'Terjual', DISPLAY_ADJUSTMENT: 'Penyesuaian' };
const quantity = (value: string | number) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 4 });

export default function DisplayScreen() {
  const { user, authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const canRead = user?.permissions.includes('display.read') ?? false;
  const canCreate = user?.permissions.includes('display.create') ?? false;
  const canVoid = user?.permissions.includes('display.void') ?? false;
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [activeTab, setActiveTab] = useState<'stock' | 'history'>('stock');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [warehouseLoading, setWarehouseLoading] = useState(canRead);
  const [error, setError] = useState('');
  const [wizardVisible, setWizardVisible] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [movementType, setMovementType] = useState<'DISPLAY_IN' | 'DISPLAY_RETURN'>('DISPLAY_IN');
  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Movement | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Movement | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const allowedWarehouses = warehouses.filter((warehouse) => warehouse.branchId && (!user?.branchId || warehouse.branchId === user.branchId));
  const warehouseId = allowedWarehouses.find((warehouse) => warehouse.id === selectedWarehouseId)?.id ?? allowedWarehouses[0]?.id ?? '';

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void authorizedRequest<Page<Warehouse>>('catalog/warehouses?page=1&perPage=100&sortBy=name&sortOrder=asc')
      .then((result) => {
        if (!active) return;
        setWarehouses(result.data);
        setSelectedWarehouseId((current) => result.data.some((warehouse) => warehouse.id === current) ? current : result.data.find((warehouse) => warehouse.branchId === user?.branchId)?.id ?? result.data.find((warehouse) => warehouse.branchId)?.id ?? '');
        setError('');
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Daftar gudang toko belum dapat dimuat.'); })
      .finally(() => { if (active) setWarehouseLoading(false); });
    return () => { active = false; };
  }, [authorizedRequest, canRead, user?.branchId]);

  // Both lists are filtered on the server (warehouse + search); both stay loaded so the metric totals stay current.
  const query = new URLSearchParams({ warehouseId });
  if (search) query.set('search', search);
  const stockList = useInfiniteList<DisplayStock>(authorizedRequest, canRead && warehouseId ? `display/stocks?${query.toString()}` : null);
  const movementList = useInfiniteList<Movement>(authorizedRequest, canRead && warehouseId ? `display/movements?${query.toString()}` : null);
  const activeList = activeTab === 'stock' ? stockList : movementList;
  const scrollProps = useLoadMoreOnScroll(activeList.loadMore);
  const stocks = stockList.items;
  const movements = movementList.items;
  const listError = activeList.items.length ? '' : activeList.error;
  const reloadLists = () => { void stockList.reload(); void movementList.reload(); };

  useEffect(() => {
    if (!wizardVisible || !warehouseId || !canRead) return;
    let active = true;
    void authorizedRequest<CatalogProduct[]>(`display/catalog?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((result) => { if (active) setCatalog(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Katalog display belum dapat dimuat.'); });
    return () => { active = false; };
  }, [authorizedRequest, canRead, warehouseId, wizardVisible]);

  function openWizard(type: 'DISPLAY_IN' | 'DISPLAY_RETURN') {
    setMovementType(type); setWizardStep(1); setProductSearch(''); setLines([]); setNote(''); setEvidence([]); setError(''); setWizardVisible(true);
  }

  function toggleProduct(product: CatalogProduct) {
    setLines((current) => current.some((line) => line.productId === product.productId)
      ? current.filter((line) => line.productId !== product.productId)
      : [...current, { productId: product.productId, unitId: product.units[0]?.id ?? '', quantity: '1' }]);
  }

  function updateLine(productId: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.productId === productId ? { ...line, ...patch } : line));
  }

  function maxFor(line: DraftLine) {
    const product = catalog.find((item) => item.productId === line.productId);
    const factor = Number(product?.units.find((unit) => unit.id === line.unitId)?.conversionFactor ?? 1);
    if (!product || !factor) return 0;
    const available = movementType === 'DISPLAY_IN'
      ? Math.max(0, Number(product.warehouseAvailable) - Number(product.displayQuantity))
      : Math.max(0, Number(product.displayQuantity));
    return available / factor;
  }

  async function chooseEvidence(useCamera: boolean) {
    const permission = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(useCamera ? 'Izin kamera dibutuhkan untuk mengambil foto.' : 'Izin galeri dibutuhkan untuk memilih foto.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 8 - evidence.length, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    const selected = result.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName ?? asset.uri.split('/').pop() ?? `display-${index + 1}.jpg`, size: asset.fileSize ?? 0, asset }));
    if (selected.some((file) => file.size > 5 * 1024 * 1024)) { setError('Ukuran setiap foto maksimal 5 MB.'); return; }
    setEvidence((current) => [...current, ...selected].slice(0, 8));
    setError('');
  }

  async function submitMovement() {
    if (!warehouseId) { setError('Pilih gudang toko terlebih dahulu.'); return; }
    if (!lines.length || lines.some((line) => !line.unitId || !(Number(line.quantity) > 0) || Number(line.quantity) > maxFor(line))) { setError('Periksa produk dan jumlah. Jumlah tidak boleh melebihi stok yang tersedia.'); return; }
    if (!evidence.length) { setError('Minimal satu foto bukti wajib diunggah.'); return; }
    setSaving(true); setError('');
    try {
      const form = new FormData();
      form.append('type', movementType); form.append('warehouseId', warehouseId); form.append('note', note.trim());
      form.append('items', JSON.stringify(lines.map(({ productId, unitId, quantity: amount }) => ({ productId, unitId, quantity: amount }))));
      evidence.forEach(({ asset, name }, index) => {
        if (Platform.OS === 'web') {
          if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
          form.append('images', asset.file, name);
        } else form.append('images', new File(asset.uri), name);
        if (index > 7) throw new Error('Maksimal 8 foto bukti.');
      });
      await authorizedRequest('display/movements', { method: 'POST', body: form });
      setWizardVisible(false); reloadLists();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Aktivitas display gagal disimpan.'); }
    finally { setSaving(false); }
  }

  async function openDetail(movement: Movement) {
    setDetailLoading(true); setDetail(movement);
    try { setDetail(await authorizedRequest<Movement>(`display/movements/${movement.id}`)); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Detail aktivitas belum dapat dimuat.'); }
    finally { setDetailLoading(false); }
  }

  async function voidMovement() {
    if (!voidTarget || !voidReason.trim()) return;
    setSaving(true);
    try {
      await authorizedRequest(`display/movements/${voidTarget.id}/void`, { method: 'POST', body: JSON.stringify({ reason: voidReason.trim() }) });
      setVoidTarget(null); setVoidReason(''); setDetail(null); reloadLists();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Aktivitas belum dapat di-void.'); }
    finally { setSaving(false); }
  }

  const visibleProducts = catalog.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(productSearch.trim().toLowerCase()) && (movementType === 'DISPLAY_IN' ? Number(product.warehouseAvailable) > Number(product.displayQuantity) : Number(product.displayQuantity) > 0));

  if (!canRead) return <View style={styles.center}><Text style={styles.emptyTitle}>Akses Display Toko tidak tersedia</Text><Text style={styles.muted}>Minta admin memeriksa permission display.read.</Text></View>;

  return <View style={styles.screen}>
    <KeyboardAwareScrollView {...scrollProps} bottomOffset={24} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={stockList.refreshing || movementList.refreshing} onRefresh={() => { void stockList.refresh(); void movementList.refresh(); }} tintColor="#07885b" />}>
      <Text style={styles.subtitle}>Pantau barang yang siap dijual dari display toko.</Text>
      <View style={styles.warehouseCard}><View style={styles.warehouseIcon}><Store size={20} color="#087f5b" /></View><View style={styles.warehouseInfo}><Text style={styles.smallLabel}>GUDANG TOKO</Text>{warehouseLoading ? <ActivityIndicator color="#087f5b" /> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.warehouseChoices}>{allowedWarehouses.map((warehouse) => <Pressable key={warehouse.id} onPress={() => setSelectedWarehouseId(warehouse.id)} style={[styles.warehouseChoice, warehouseId === warehouse.id && styles.warehouseChoiceActive]}><Text numberOfLines={1} style={[styles.warehouseText, warehouseId === warehouse.id && styles.warehouseTextActive]}>{warehouse.name}</Text><ChevronDown size={14} color={warehouseId === warehouse.id ? '#087f5b' : '#83918a'} /></Pressable>)}</ScrollView>}</View></View>
      <View style={styles.metrics}><View style={styles.metric}><Package size={18} color="#347ff0" /><Text style={styles.metricLabel}>Produk di display</Text><Text style={styles.metricValue}>{stockList.total}</Text></View><View style={styles.metric}><ClipboardList size={18} color="#9a4be3" /><Text style={styles.metricLabel}>Aktivitas tercatat</Text><Text style={styles.metricValue}>{movementList.total}</Text></View></View>
      <View style={styles.noteBanner}><Text style={styles.noteBannerTitle}>Catatan display</Text><Text style={styles.noteBannerText}>Barang display tetap bagian dari stok gudang. Stok resmi berkurang saat transaksi POS selesai.</Text></View>
      {canCreate ? <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => openWizard('DISPLAY_IN')} style={styles.primaryAction}><Plus size={17} color="#fff" /><Text style={styles.primaryActionText}>Tambah ke display</Text></Pressable><Pressable accessibilityRole="button" onPress={() => openWizard('DISPLAY_RETURN')} style={styles.secondaryAction}><Undo2 size={17} color="#087f5b" /><Text style={styles.secondaryActionText}>Kembalikan</Text></Pressable></View> : null}
      <View style={styles.tabs}><Pressable onPress={() => setActiveTab('stock')} style={[styles.tab, activeTab === 'stock' && styles.tabActive]}><Text style={[styles.tabText, activeTab === 'stock' && styles.tabTextActive]}>Saldo display</Text></Pressable><Pressable onPress={() => setActiveTab('history')} style={[styles.tab, activeTab === 'history' && styles.tabActive]}><Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>Riwayat aktivitas</Text></Pressable></View>
      <View style={styles.searchRow}><Search size={17} color="#78889c" /><TextInput accessibilityLabel="Cari produk atau aktivitas display" value={searchInput} onChangeText={setSearchInput} placeholder={activeTab === 'stock' ? 'Cari produk...' : 'Cari aktivitas...'} placeholderTextColor="#87948c" style={styles.searchInput} /></View>
      {error || listError ? <View style={styles.errorCard}><Text style={styles.errorText}>{error || listError}</Text><Pressable onPress={() => { setError(''); reloadLists(); }}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
      {activeList.loading || warehouseLoading ? <ActivityIndicator style={styles.loader} color="#087f5b" size="large" /> : null}
      {!warehouseLoading && !allowedWarehouses.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Gudang toko tidak ditemukan</Text><Text style={styles.muted}>Pastikan akun memiliki gudang cabang aktif.</Text></View> : null}
      {activeTab === 'stock' ? stocks.map((item) => <View key={item.id} style={styles.rowCard}><View style={styles.productIcon}><Package size={21} color="#087f5b" /></View><View style={styles.rowInfo}><Text numberOfLines={2} style={styles.productName}>{item.product.name}</Text><Text style={styles.sku}>{item.product.sku} · {item.warehouse.name}</Text><Text style={styles.updated}>Terakhir diperbarui {formatDate(item.updatedAt)}</Text></View><View style={styles.rowRight}><Text style={styles.stockQty}>{quantity(item.quantity)} {item.product.unit.code}</Text><Text style={styles.available}>Gudang {quantity(item.warehouseAvailable)}</Text></View></View>) : movements.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void openDetail(item)} style={({ pressed }) => [styles.movementCard, pressed && styles.pressed]}><View style={styles.movementTop}><View style={styles.rowInfo}><Text style={styles.productName}>{item.movementNumber}</Text><Text style={styles.sku}>{item.order?.orderNumber ?? item.createdBy?.name ?? '-'}</Text></View><Text style={[styles.typeBadge, item.type === 'DISPLAY_RETURN' ? styles.returnBadge : item.type === 'DISPLAY_SALE' ? styles.saleBadge : styles.inBadge]}>{movementLabels[item.type]}</Text></View><Text style={styles.updated}>{formatDate(item.createdAt)} · {item._count?.items ?? 0} produk · {item.status === 'VOIDED' ? 'Dibatalkan' : 'Selesai'}</Text></Pressable>)}
      <LoadMoreFooter loadingMore={activeList.loadingMore} hasMore={activeList.hasMore} count={activeList.items.length} error={activeList.error} onRetry={activeList.loadMore} />
      {!activeList.loading && !listError && warehouseId && activeTab === 'stock' && !stocks.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Display masih kosong</Text><Text style={styles.muted}>Tambahkan barang beserta foto bukti pengambilan.</Text></View> : null}
      {!activeList.loading && !listError && warehouseId && activeTab === 'history' && !movements.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>Belum ada aktivitas</Text><Text style={styles.muted}>Aktivitas display akan tampil di sini.</Text></View> : null}
    </KeyboardAwareScrollView>

    <Modal visible={wizardVisible} animationType="slide" onRequestClose={() => { if (!saving) setWizardVisible(false); }}>
      <View style={[styles.modalScreen, { paddingTop: insets.top + 8 }]}>
        <View style={styles.modalHeader}><Pressable accessibilityRole="button" accessibilityLabel={wizardStep === 1 ? 'Tutup' : 'Kembali'} onPress={() => wizardStep === 1 ? setWizardVisible(false) : setWizardStep((step) => step - 1)} style={styles.backButton}>{wizardStep === 1 ? <X size={20} color="#26372e" /> : <ChevronLeft size={22} color="#26372e" />}</Pressable><Text style={styles.modalTitle}>{movementType === 'DISPLAY_IN' ? 'Tambah ke display' : 'Kembalikan ke gudang'}</Text><View style={styles.headerSpacer} /></View>
        <View style={styles.stepper}>{['Produk', 'Detail', 'Konfirmasi'].map((label, index) => <View key={label} style={styles.stepItem}><View style={[styles.stepCircle, wizardStep > index + 1 && styles.stepDone, wizardStep === index + 1 && styles.stepCurrent]}>{wizardStep > index + 1 ? <Check size={14} color="#fff" /> : <Text style={[styles.stepNumber, wizardStep === index + 1 && styles.stepNumberCurrent]}>{index + 1}</Text>}</View><Text style={[styles.stepLabel, wizardStep === index + 1 && styles.stepLabelCurrent]}>{label}</Text></View>)}</View>
        {wizardStep === 1 ? <><View style={styles.modalSearch}><Search size={17} color="#8290a2" /><TextInput accessibilityLabel="Cari produk display" value={productSearch} onChangeText={setProductSearch} placeholder="Cari produk atau SKU" placeholderTextColor="#87948c" style={styles.searchInput} /></View><ScrollView contentContainerStyle={styles.productList}>{visibleProducts.map((product) => { const selected = lines.some((line) => line.productId === product.productId); return <Pressable key={product.productId} onPress={() => toggleProduct(product)} style={[styles.catalogRow, selected && styles.catalogRowSelected]}><View style={styles.productIcon}><Package size={21} color="#087f5b" /></View><View style={styles.rowInfo}><Text numberOfLines={1} style={styles.productName}>{product.name}</Text><Text style={styles.sku}>{product.sku}</Text><Text style={styles.available}>Display {quantity(product.displayQuantity)} · Gudang {quantity(product.warehouseAvailable)}</Text></View><View style={[styles.addButton, selected && styles.addButtonSelected]}>{selected ? <Check size={19} color="#fff" /> : <Plus size={19} color="#087f5b" />}</View></Pressable>; })}{!visibleProducts.length ? <Text style={styles.emptyText}>Produk tidak ditemukan atau tidak memiliki jumlah yang bisa dipindahkan.</Text> : null}</ScrollView><View style={[styles.modalFooter, { paddingBottom: Math.max(insets.bottom + 8, 18) }]}><Text style={styles.selectionCount}>{lines.length} produk dipilih</Text><Pressable disabled={!lines.length} onPress={() => setWizardStep(2)} style={[styles.primaryAction, !lines.length && styles.disabled]}><Text style={styles.primaryActionText}>Lanjut</Text><ChevronRight size={17} color="#fff" /></Pressable></View></> : null}
        {wizardStep === 2 ? <><KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled"><Text style={styles.fieldLabel}>JENIS AKTIVITAS</Text><View style={styles.typeChoices}><Pressable onPress={() => setMovementType('DISPLAY_IN')} style={[styles.typeChoice, movementType === 'DISPLAY_IN' && styles.typeChoiceActive]}><Text style={[styles.typeChoiceText, movementType === 'DISPLAY_IN' && styles.typeChoiceTextActive]}>Masuk display</Text></Pressable><Pressable onPress={() => setMovementType('DISPLAY_RETURN')} style={[styles.typeChoice, movementType === 'DISPLAY_RETURN' && styles.typeChoiceActive]}><Text style={[styles.typeChoiceText, movementType === 'DISPLAY_RETURN' && styles.typeChoiceTextActive]}>Kembali ke gudang</Text></Pressable></View><Text style={styles.fieldLabel}>DAFTAR PRODUK ({lines.length})</Text>{lines.map((line) => { const product = catalog.find((item) => item.productId === line.productId); if (!product) return null; const maximum = maxFor(line); return <View key={line.productId} style={styles.lineCard}><View style={styles.movementTop}><View style={styles.rowInfo}><Text style={styles.productName}>{product.name}</Text><Text style={styles.sku}>{product.sku}</Text></View><Pressable accessibilityLabel={`Hapus ${product.name}`} onPress={() => setLines((current) => current.filter((item) => item.productId !== line.productId))}><X size={18} color="#a3332a" /></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitChoices}>{product.units.map((unit) => <Pressable key={unit.id} onPress={() => updateLine(line.productId, { unitId: unit.id, quantity: '1' })} style={[styles.unitChoice, unit.id === line.unitId && styles.unitChoiceActive]}><Text style={[styles.unitText, unit.id === line.unitId && styles.unitTextActive]}>{unit.code}</Text></Pressable>)}</ScrollView><View style={styles.qtyRow}><Text style={styles.available}>Maksimal {quantity(maximum)} {product.units.find((unit) => unit.id === line.unitId)?.code}</Text><View style={styles.qtyControl}><Pressable accessibilityLabel={`Kurangi ${product.name}`} onPress={() => updateLine(line.productId, { quantity: String(Math.max(0, Number(line.quantity) - 1)) })} style={styles.qtyButton}><Minus size={16} color="#087f5b" /></Pressable><TextInput accessibilityLabel={`Jumlah ${product.name}`} keyboardType="decimal-pad" value={line.quantity} onChangeText={(value) => updateLine(line.productId, { quantity: value.replace(',', '.') })} style={styles.qtyInput} /><Pressable accessibilityLabel={`Tambah ${product.name}`} disabled={Number(line.quantity) + 1 > maximum} onPress={() => updateLine(line.productId, { quantity: String(Math.min(maximum, Number(line.quantity) + 1)) })} style={[styles.qtyButton, Number(line.quantity) + 1 > maximum && styles.disabled]}><Plus size={16} color="#087f5b" /></Pressable></View></View></View>; })}</KeyboardAwareScrollView><View style={[styles.modalFooter, { paddingBottom: Math.max(insets.bottom + 8, 18) }]}><Pressable onPress={() => setWizardStep(1)} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Kembali</Text></Pressable><Pressable disabled={!lines.length || lines.some((line) => !Number(line.quantity) || Number(line.quantity) > maxFor(line))} onPress={() => setWizardStep(3)} style={[styles.primaryAction, (!lines.length || lines.some((line) => !Number(line.quantity) || Number(line.quantity) > maxFor(line))) && styles.disabled]}><Text style={styles.primaryActionText}>Lanjut</Text><ChevronRight size={17} color="#fff" /></Pressable></View></> : null}
        {wizardStep === 3 ? <><KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.formPage} keyboardShouldPersistTaps="handled"><Text style={styles.fieldLabel}>RINGKASAN</Text>{lines.map((line) => { const product = catalog.find((item) => item.productId === line.productId); return <View key={line.productId} style={styles.summaryRow}><View style={styles.productIcon}><Package size={18} color="#087f5b" /></View><View style={styles.rowInfo}><Text style={styles.productName}>{product?.name}</Text><Text style={styles.sku}>{product?.sku}</Text></View><Text style={styles.stockQty}>{line.quantity} {product?.units.find((unit) => unit.id === line.unitId)?.code}</Text></View>; })}<Text style={[styles.fieldLabel, styles.spacedLabel]}>CATATAN (OPSIONAL)</Text><TextInput accessibilityLabel="Catatan display" value={note} onChangeText={setNote} maxLength={500} multiline placeholder="Tambahkan catatan..." placeholderTextColor="#87948c" style={styles.noteInput} /><Text style={[styles.fieldLabel, styles.spacedLabel]}>FOTO BUKTI *</Text><View style={styles.photoActions}><Pressable onPress={() => void chooseEvidence(true)} style={styles.photoButton}><Camera size={17} color="#087f5b" /><Text style={styles.photoButtonText}>Ambil foto</Text></Pressable><Pressable onPress={() => void chooseEvidence(false)} style={styles.photoButton}><ImageIcon size={17} color="#087f5b" /><Text style={styles.photoButtonText}>Pilih foto</Text></Pressable></View><View style={styles.evidenceList}>{evidence.map((image, index) => <View key={`${image.uri}-${index}`} style={styles.evidenceItem}><Image source={{ uri: image.uri }} style={styles.evidencePreview} /><Pressable accessibilityLabel={`Hapus foto ${index + 1}`} onPress={() => setEvidence((current) => current.filter((_, imageIndex) => imageIndex !== index))} style={styles.removeEvidence}><X size={13} color="#fff" /></Pressable></View>)}</View><Text style={styles.evidenceHint}>{evidence.length}/8 foto · maksimal 5 MB per foto</Text>{error ? <Text style={styles.errorText}>{error}</Text> : null}</KeyboardAwareScrollView><View style={[styles.modalFooter, { paddingBottom: Math.max(insets.bottom + 8, 18) }]}><Pressable onPress={() => setWizardStep(2)} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Kembali</Text></Pressable><Pressable disabled={saving || !evidence.length} onPress={() => void submitMovement()} style={[styles.primaryAction, (saving || !evidence.length) && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <><Text style={styles.primaryActionText}>Simpan aktivitas</Text><Check size={17} color="#fff" /></>}</Pressable></View></> : null}
      </View>
    </Modal>

    <Modal visible={Boolean(detail)} transparent animationType="slide" onRequestClose={() => setDetail(null)}><View style={styles.backdrop}><View style={[styles.detailSheet, { paddingBottom: Math.max(insets.bottom + 8, 22) }]}><View style={styles.detailHeader}><View style={styles.rowInfo}><Text style={styles.modalTitle}>{detail?.movementNumber ?? 'Detail aktivitas'}</Text><Text style={styles.muted}>{detail ? `${movementLabels[detail.type]} · ${formatDate(detail.createdAt)}` : ''}</Text></View><Pressable accessibilityLabel="Tutup detail" onPress={() => setDetail(null)}><X size={20} color="#53635a" /></Pressable></View>{detailLoading ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : detail ? <ScrollView style={styles.detailContent}>{detail.items?.map((item) => <View key={item.id} style={styles.lineCard}><Text style={styles.productName}>{item.product.name}</Text><Text style={styles.sku}>{item.product.sku}</Text><Text style={styles.stockQty}>{Number(item.quantity) > 0 ? '+' : ''}{quantity(item.quantity)} {item.product.unit.code}</Text><Text style={styles.muted}>Sebelum {quantity(item.beforeQuantity)} · Sesudah {quantity(item.afterQuantity)}</Text></View>)}{detail.note ? <Text style={styles.noteDetail}>Catatan: {detail.note}</Text> : null}{detail.evidenceImages?.length ? <View style={styles.evidenceList}>{detail.evidenceImages.map((image) => <Image key={image.id} source={{ uri: image.url }} style={styles.evidencePreview} />)}</View> : null}{detail.status === 'VOIDED' ? <Text style={styles.errorText}>Dibatalkan: {detail.voidReason}</Text> : null}</ScrollView> : null}<View style={styles.detailActions}>{canVoid && detail?.status === 'COMPLETED' && detail.type !== 'DISPLAY_SALE' ? <Pressable onPress={() => { setVoidTarget(detail); setVoidReason(''); }} style={styles.dangerAction}><Text style={styles.dangerText}>Void aktivitas</Text></Pressable> : null}<Pressable onPress={() => setDetail(null)} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Tutup</Text></Pressable></View></View></View></Modal>
    <Modal visible={Boolean(voidTarget)} transparent animationType="fade" onRequestClose={() => setVoidTarget(null)}><KeyboardAvoidingView behavior="padding" style={styles.backdrop}><View style={[styles.voidSheet, { marginBottom: Math.max(insets.bottom + 8, 20) }]}><Text style={styles.modalTitle}>Void aktivitas display?</Text><Text style={styles.muted}>Saldo akan dikembalikan ke kondisi sebelum {voidTarget?.movementNumber}.</Text><TextInput accessibilityLabel="Alasan void" value={voidReason} onChangeText={setVoidReason} maxLength={500} multiline placeholder="Alasan void wajib diisi" style={styles.noteInput} />{error ? <Text style={styles.errorText}>{error}</Text> : null}<View style={styles.detailActions}><Pressable onPress={() => setVoidTarget(null)} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Batal</Text></Pressable><Pressable disabled={saving || !voidReason.trim()} onPress={() => void voidMovement()} style={[styles.dangerAction, (saving || !voidReason.trim()) && styles.disabled]}><Text style={styles.dangerText}>{saving ? 'Memproses...' : 'Ya, void'}</Text></Pressable></View></View></KeyboardAvoidingView></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 16, paddingBottom: 28 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, backgroundColor: '#f5f7f6' },
  subtitle: { color: '#718078', fontSize: 12 }, warehouseCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 12, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 13, backgroundColor: '#fff' }, warehouseIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#e7f5ee' }, warehouseInfo: { flex: 1, minWidth: 0 }, smallLabel: { marginBottom: 5, color: '#84918b', fontSize: 9, fontWeight: '900' }, warehouseChoices: { gap: 6 }, warehouseChoice: { maxWidth: 210, minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#f3f6f4' }, warehouseChoiceActive: { backgroundColor: '#e7f5ee' }, warehouseText: { color: '#607067', fontSize: 10 }, warehouseTextActive: { color: '#087f5b', fontWeight: '800' },
  metrics: { flexDirection: 'row', gap: 9, marginTop: 12 }, metric: { flex: 1, minHeight: 83, justifyContent: 'center', gap: 4, padding: 11, borderWidth: 1, borderColor: '#e8edf0', borderRadius: 12, backgroundColor: '#fff' }, metricLabel: { color: '#718078', fontSize: 9 }, metricValue: { color: '#172820', fontSize: 15, fontWeight: '900' }, noteBanner: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: '#c9ebdc', borderRadius: 12, backgroundColor: '#edfaf4' }, noteBannerTitle: { color: '#087f5b', fontSize: 10, fontWeight: '900' }, noteBannerText: { marginTop: 4, color: '#4c7061', fontSize: 10, lineHeight: 15 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 }, primaryAction: { minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#07956f' }, primaryActionText: { color: '#fff', fontSize: 10, fontWeight: '900' }, secondaryAction: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, backgroundColor: '#fff' }, secondaryActionText: { color: '#087f5b', fontSize: 10, fontWeight: '800' }, tabs: { flexDirection: 'row', gap: 15, marginTop: 20, borderBottomWidth: 1, borderBottomColor: '#e2e9e5' }, tab: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' }, tabActive: { borderBottomColor: '#07956f' }, tabText: { color: '#718078', fontSize: 10, fontWeight: '700' }, tabTextActive: { color: '#087f5b', fontWeight: '900' },
  searchRow: { height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 12, paddingHorizontal: 11, borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, backgroundColor: '#fff' }, searchInput: { flex: 1, minWidth: 0, color: '#26372e', fontSize: 11 }, rowCard: { minHeight: 75, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8, padding: 10, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' }, rowInfo: { flex: 1, minWidth: 0 }, productIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#edf7f2' }, productName: { color: '#26372e', fontSize: 10, fontWeight: '900' }, sku: { marginTop: 3, color: '#89958e', fontSize: 9 }, updated: { marginTop: 5, color: '#819087', fontSize: 9 }, rowRight: { alignItems: 'flex-end', gap: 4 }, stockQty: { color: '#087f5b', fontSize: 11, fontWeight: '900' }, available: { color: '#819087', fontSize: 9 }, movementCard: { marginBottom: 8, padding: 12, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' }, movementTop: { flexDirection: 'row', alignItems: 'center', gap: 8 }, typeBadge: { overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, fontSize: 9, fontWeight: '900' }, inBadge: { color: '#087f5b', backgroundColor: '#e7f5ee' }, returnBadge: { color: '#a86200', backgroundColor: '#fff2d8' }, saleBadge: { color: '#347ff0', backgroundColor: '#eef5ff' }, pressed: { opacity: 0.75 },
  errorCard: { marginBottom: 10, padding: 12, borderWidth: 1, borderColor: '#f1c8c5', borderRadius: 11, backgroundColor: '#fff6f5' }, errorText: { color: '#a3332a', fontSize: 10, lineHeight: 15 }, retry: { marginTop: 6, color: '#087f5b', fontSize: 10, fontWeight: '800' }, loader: { padding: 18 }, empty: { alignItems: 'center', gap: 5, padding: 20, borderRadius: 12, backgroundColor: '#fff' }, emptyTitle: { color: '#28372f', fontSize: 12, fontWeight: '900' }, emptyText: { padding: 14, color: '#819087', fontSize: 10, textAlign: 'center' }, muted: { marginTop: 4, color: '#718078', fontSize: 9, lineHeight: 14 },
  modalScreen: { flex: 1, backgroundColor: '#f5f7f6' }, modalHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#e6ece8', backgroundColor: '#fff' }, backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }, modalTitle: { color: '#172820', fontSize: 12, fontWeight: '900' }, headerSpacer: { width: 38 }, stepper: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e6ece8', backgroundColor: '#fff' }, stepItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, stepCircle: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#edf1f3' }, stepCurrent: { backgroundColor: '#07956f' }, stepDone: { backgroundColor: '#07956f' }, stepNumber: { color: '#53635a', fontSize: 9, fontWeight: '900' }, stepNumberCurrent: { color: '#fff' }, stepLabel: { color: '#718078', fontSize: 9 }, stepLabelCurrent: { color: '#087f5b', fontWeight: '900' }, modalSearch: { height: 43, flexDirection: 'row', alignItems: 'center', gap: 8, margin: 14, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e0e7e3', borderRadius: 10, backgroundColor: '#fff' }, productList: { paddingHorizontal: 14, paddingBottom: 12 }, catalogRow: { minHeight: 69, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 7, padding: 9, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 11, backgroundColor: '#fff' }, catalogRowSelected: { borderColor: '#72c7a4', backgroundColor: '#f0faf5' }, addButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#e7f5ee' }, addButtonSelected: { backgroundColor: '#07956f' }, modalFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e5e9ed', backgroundColor: '#fff' }, selectionCount: { color: '#53635a', fontSize: 10, fontWeight: '800' }, disabled: { opacity: 0.45 },
  formPage: { padding: 14, paddingBottom: 22 }, fieldLabel: { marginTop: 7, marginBottom: 7, color: '#718078', fontSize: 9, fontWeight: '900' }, typeChoices: { flexDirection: 'row', gap: 7, marginBottom: 15 }, typeChoice: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, borderWidth: 1, borderColor: '#e2e9e5', borderRadius: 9, backgroundColor: '#fff' }, typeChoiceActive: { borderColor: '#07956f', backgroundColor: '#e7f5ee' }, typeChoiceText: { color: '#718078', fontSize: 9, fontWeight: '700' }, typeChoiceTextActive: { color: '#087f5b', fontWeight: '900' }, lineCard: { marginBottom: 9, padding: 11, borderWidth: 1, borderColor: '#e4ebe7', borderRadius: 11, backgroundColor: '#fff' }, unitChoices: { gap: 6, paddingVertical: 8 }, unitChoice: { minWidth: 42, alignItems: 'center', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f1f4f2' }, unitChoiceActive: { backgroundColor: '#dff4e9' }, unitText: { color: '#607067', fontSize: 9, fontWeight: '800' }, unitTextActive: { color: '#087f5b' }, qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, qtyControl: { flexDirection: 'row', alignItems: 'center', gap: 6 }, qtyButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e7f5ee' }, qtyInput: { width: 54, height: 32, borderWidth: 1, borderColor: '#dce4df', borderRadius: 8, color: '#26372e', fontSize: 11, textAlign: 'center' },
  summaryRow: { minHeight: 51, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#edf1ee' }, spacedLabel: { marginTop: 17 }, noteInput: { minHeight: 75, padding: 10, borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, backgroundColor: '#fff', color: '#26372e', fontSize: 10, textAlignVertical: 'top' }, photoActions: { flexDirection: 'row', gap: 8 }, photoButton: { flex: 1, minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 9, backgroundColor: '#e7f5ee' }, photoButtonText: { color: '#087f5b', fontSize: 9, fontWeight: '800' }, evidenceList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }, evidenceItem: { position: 'relative' }, evidencePreview: { width: 66, height: 66, borderRadius: 8, backgroundColor: '#edf1f3' }, removeEvidence: { position: 'absolute', top: -4, right: -4, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#26372e' }, evidenceHint: { marginTop: 5, color: '#819087', fontSize: 9 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, detailSheet: { maxHeight: '82%', paddingHorizontal: 14, paddingTop: 13, paddingBottom: 22, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: '#fff' }, detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9, marginBottom: 10 }, detailContent: { flexGrow: 0 }, noteDetail: { marginTop: 8, padding: 10, borderRadius: 9, backgroundColor: '#f4f7f5', color: '#53635a', fontSize: 10 }, detailActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 }, dangerAction: { minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#b42318' }, dangerText: { color: '#fff', fontSize: 9, fontWeight: '900' }, voidSheet: { margin: 20, padding: 16, borderRadius: 14, backgroundColor: '#fff' },
});
