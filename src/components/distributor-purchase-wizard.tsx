import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Barcode, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Minus, Package, Plus, Search, Store, X } from 'lucide-react-native';
import { useAuth } from '../auth/auth-provider';
import { ApiError } from '../lib/api';
import { fetchAllPages } from '../lib/paging';
import { BarcodeScanner } from './barcode-scanner';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type NamedOption = { id: string; name: string; code?: string; type?: string };
type PurchaseUnit = { unitId: string; conversionFactor: string; purchasePrice?: string | null; canPurchase: boolean; unit: { id: string; code: string; name: string } };
type Product = {
  id: string;
  sku: string;
  name: string;
  active?: boolean;
  barcode?: string | null;
  costPrice: string | null;
  unitId: string;
  unit: { id: string; code: string; name: string; allowDecimals?: boolean };
  unitConversions: PurchaseUnit[];
  images: { url: string }[];
};
type PurchaseLine = { productId: string; unitId: string; lineType: 'PURCHASE' | 'BONUS'; orderedQty: string; unitPrice: string; discountAmount: string };
type Page<T> = { data: T[] };
type ExistingDraft = { id: string; distributorId: string; warehouseId: string; purchaseDate: string; distributorInvoiceNumber: string | null; discountAmount: string | number; additionalCost: string | number; note: string | null; items: { productId: string; unitId: string | null; lineType: 'PURCHASE' | 'BONUS'; orderedQty: string; unitPrice: string; discountAmount: string; note?: string | null }[] };
type Props = { onCancel: () => void; onSaved: (purchaseId: string) => void; initialDraft?: ExistingDraft };
type Selector = 'distributor' | 'warehouse' | null;

const money = (value: string | number) => `Rp ${Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const quantity = (value: string | number) => Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 4 });
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const dateInputValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// "2026-10-16" -> "Jumat, 16 Oktober 2026"
const displayDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

export function DistributorPurchaseWizard({ onCancel, onSaved, initialDraft }: Props) {
  const { authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const initialPurchaseDate = initialDraft?.purchaseDate.slice(0, 10) ?? today();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [selector, setSelector] = useState<Selector>(null);
  const [distributors, setDistributors] = useState<NamedOption[]>([]);
  const [warehouses, setWarehouses] = useState<NamedOption[]>([]);
  const [distributorError, setDistributorError] = useState('');
  const [productError, setProductError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [warehouseError, setWarehouseError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [distributorId, setDistributorId] = useState(initialDraft?.distributorId ?? '');
  const [warehouseId, setWarehouseId] = useState(initialDraft?.warehouseId ?? '');
  const [purchaseDate, setPurchaseDate] = useState(initialPurchaseDate);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [datePickerValue, setDatePickerValue] = useState(new Date(`${initialPurchaseDate}T00:00:00`));
  const [distributorInvoiceNumber, setDistributorInvoiceNumber] = useState(initialDraft?.distributorInvoiceNumber ?? '');
  const [discountAmount, setDiscountAmount] = useState(String(initialDraft?.discountAmount ?? '0'));
  const [additionalCost, setAdditionalCost] = useState(String(initialDraft?.additionalCost ?? '0'));
  const [note, setNote] = useState(initialDraft?.note ?? '');
  const [lineType, setLineType] = useState<'PURCHASE' | 'BONUS'>('PURCHASE');
  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<PurchaseLine[]>(() => initialDraft?.items.map((item) => ({ productId: item.productId, unitId: item.unitId ?? '', lineType: item.lineType, orderedQty: item.orderedQty, unitPrice: item.unitPrice, discountAmount: item.discountAmount })) ?? []);
  const [draftId] = useState<string | null>(initialDraft?.id ?? null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      fetchAllPages<NamedOption>(authorizedRequest, 'distributors?sortBy=name&sortOrder=asc'),
      authorizedRequest<Page<NamedOption>>('catalog/warehouses?page=1&perPage=100&sortBy=name&sortOrder=asc'),
      fetchAllPages<Product>(authorizedRequest, 'products?sortBy=name&sortOrder=asc'),
    ]).then(([distributorResult, warehouseResult, productResult]) => {
      if (!active) return;
      const errors: string[] = [];
      if (distributorResult.status === 'fulfilled') {
        const options = distributorResult.value.data;
        setDistributors(options);
        setDistributorId((current) => current || options[0]?.id || '');
        setDistributorError(options.length ? '' : 'Belum ada distributor untuk bisnis ini.');
      } else {
        const message = distributorResult.reason instanceof ApiError ? distributorResult.reason.message : 'Data distributor belum dapat dimuat.';
        setDistributors([]); setDistributorId(''); setDistributorError(message); errors.push(`Distributor: ${message}`);
      }
      if (warehouseResult.status === 'fulfilled') {
        const centralWarehouses = warehouseResult.value.data.filter((warehouse) => warehouse.type === 'CENTRAL');
        setWarehouses(centralWarehouses);
        setWarehouseId((current) => current || centralWarehouses[0]?.id || '');
        setWarehouseError(centralWarehouses.length ? '' : 'Gudang pusat tidak tersedia untuk akun ini.');
      } else {
        const message = warehouseResult.reason instanceof ApiError ? warehouseResult.reason.message : 'Data gudang belum dapat dimuat.';
        setWarehouses([]); setWarehouseId(''); setWarehouseError(message); errors.push(`Gudang pusat: ${message}`);
      }
      if (productResult.status === 'fulfilled') {
        setProducts(productResult.value.data.filter((product) => product.active !== false));
        setProductError('');
      }
      else {
        const reason = productResult.reason;
        const message = reason instanceof ApiError
          ? reason.status === 403 ? 'Akun ini belum punya izin melihat produk (product.read).' : reason.message
          : reason instanceof Error ? reason.message : 'Katalog produk belum dapat dimuat.';
        setProducts([]); setProductError(message); errors.push(`Produk: ${message}`);
      }
      setError(errors.join(' '));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authorizedRequest, reloadKey]);

  const filteredProducts = useMemo(() => products.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(productSearch.trim().toLowerCase())), [products, productSearch]);
  const selectedDistributor = distributors.find((distributor) => distributor.id === distributorId);
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === warehouseId);
  const subtotal = lines.reduce((sum, line) => sum + (line.lineType === 'BONUS' ? 0 : Math.max(0, Number(line.orderedQty) * Number(line.unitPrice) - Number(line.discountAmount || 0))), 0);
  const headerDiscount = Math.min(Math.max(Number(discountAmount) || 0, 0), subtotal);
  const grandTotal = Math.max(0, subtotal - headerDiscount + (Number(additionalCost) || 0));
  const selectionItems = selector === 'distributor' ? distributors : warehouses;
  const selectionTitle = selector === 'distributor' ? 'Pilih distributor' : 'Pilih gudang pusat';

  function unitOptions(product: Product): PurchaseUnit[] {
    return [
      { unitId: product.unitId, conversionFactor: '1', purchasePrice: product.costPrice, canPurchase: true, unit: product.unit },
      ...product.unitConversions.filter((unit) => unit.canPurchase),
    ];
  }

  function defaultUnitPrice(product: Product, unitId: string) {
    const unit = unitOptions(product).find((option) => option.unitId === unitId);
    if (unit?.purchasePrice) return unit.purchasePrice;
    return (Number(product.costPrice ?? 8000) * Number(unit?.conversionFactor ?? 1)).toFixed(2);
  }

  function addProduct(product: Product) {
    const unit = unitOptions(product)[0];
    if (!unit) return;
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id && line.lineType === lineType);
      if (existing) return current.map((line) => line === existing ? { ...line, orderedQty: String((Number(line.orderedQty) || 0) + 1) } : line);
      return [...current, { productId: product.id, unitId: unit.unitId, lineType, orderedQty: '1', unitPrice: lineType === 'BONUS' ? '0' : defaultUnitPrice(product, unit.unitId), discountAmount: '0' }];
    });
    setError('');
  }

  function changeLineQuantity(productId: string, type: PurchaseLine['lineType'], delta: number) {
    setLines((current) => current.flatMap((line) => {
      if (line.productId !== productId || line.lineType !== type) return [line];
      const next = Math.round(((Number(line.orderedQty) || 0) + delta) * 10000) / 10000;
      return next > 0 ? [{ ...line, orderedQty: String(next) }] : [];
    }));
  }

  function scanProduct(value: string) {
    setScannerVisible(false);
    const product = products.find((entry) => entry.barcode === value || entry.sku === value);
    if (product) addProduct(product);
    else { setProductSearch(value); setError('Barcode tidak ditemukan pada katalog produk.'); }
  }

  function updateLine(index: number, patch: Partial<PurchaseLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function chooseLineUnit(index: number, product: Product, unitId: string) {
    const line = lines[index];
    updateLine(index, { unitId, unitPrice: line.lineType === 'BONUS' ? '0' : defaultUnitPrice(product, unitId) });
  }

  function validateStepOne() {
    if (!distributorId || !warehouseId) { setError('Pilih distributor dan gudang pusat.'); return false; }
    if (!distributorInvoiceNumber.trim()) { setError('Nomor invoice distributor wajib diisi.'); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || Number.isNaN(new Date(`${purchaseDate}T00:00:00.000Z`).getTime())) { setError('Tanggal pembelian harus berformat YYYY-MM-DD.'); return false; }
    if ((Number(discountAmount) || 0) > subtotal && lines.length) { setError('Diskon transaksi tidak boleh melebihi subtotal.'); return false; }
    setError('');
    return true;
  }

  function nextStep() {
    if (step === 1 && !validateStepOne()) return;
    if (step === 2 && !lines.length) { setError('Tambahkan minimal satu produk pembelian.'); return; }
    setError('');
    setStep((current) => Math.min(3, current + 1));
  }

  async function saveDraft() {
    if (!validateStepOne()) return;
    if (!lines.length || !lines.some((line) => line.lineType === 'PURCHASE')) { setError('Tambahkan minimal satu produk pembelian berbayar.'); return; }
    if (lines.some((line) => !Number(line.orderedQty) || Number(line.orderedQty) <= 0 || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0)) { setError('Jumlah dan harga produk harus lebih dari nol.'); return; }
    if (lines.some((line) => line.lineType === 'BONUS' && (Number(line.unitPrice) !== 0 || Number(line.discountAmount) !== 0))) { setError('Produk bonus harus memiliki harga dan diskon Rp 0.'); return; }
    if (lines.some((line) => Number(line.discountAmount) > Number(line.orderedQty) * Number(line.unitPrice))) { setError('Diskon item tidak boleh melebihi harga item.'); return; }
    if ((Number(discountAmount) || 0) > subtotal) { setError('Diskon transaksi tidak boleh melebihi subtotal.'); return; }

    setSaving(true); setError('');
    try {
      const body = JSON.stringify({
        distributorId, warehouseId, purchaseDate: new Date(`${purchaseDate}T00:00:00.000Z`).toISOString(),
        distributorInvoiceNumber: distributorInvoiceNumber.trim(), note: note.trim() || undefined,
        discountAmount: String(Number(discountAmount) || 0), additionalCost: String(Number(additionalCost) || 0),
        items: lines.map((line) => ({ ...line, discountAmount: line.lineType === 'BONUS' ? '0' : String(Number(line.discountAmount) || 0) })),
      });
      const saved = draftId
        ? await authorizedRequest<{ id: string }>(`distributor-purchases/${draftId}`, { method: 'PATCH', body })
        : await authorizedRequest<{ id: string }>('distributor-purchases', { method: 'POST', body });
      onSaved(saved.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Pembelian belum dapat dikonfirmasi. Draft tersimpan agar bisa dicoba kembali.');
    } finally { setSaving(false); }
  }

  return <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Kembali" onPress={step === 1 ? onCancel : () => setStep((current) => Math.max(1, current - 1))} style={styles.headerBack}><ChevronLeft size={21} color="#172338" /></Pressable><Text style={styles.headerTitle}>{initialDraft ? 'Edit draft pembelian' : 'Buat pembelian'}</Text><View style={styles.headerSpacer} /></View>
    <View style={styles.stepper}>{(['Detail', 'Produk', 'Konfirmasi'] as const).map((label, index) => <View key={label} style={styles.stepWrap}><View style={[styles.stepCircle, step >= index + 1 && styles.stepCircleActive]}>{step > index + 1 ? <Check size={14} color="#fff" /> : <Text style={[styles.stepNumber, step >= index + 1 && styles.stepNumberActive]}>{index + 1}</Text>}</View><Text style={[styles.stepLabel, step === index + 1 && styles.stepLabelCurrent]}>{label}</Text>{index < 2 ? <View style={[styles.stepLine, step > index + 1 && styles.stepLineActive]} /> : null}</View>)}</View>
    {loading ? <ActivityIndicator style={styles.loading} color="#07885b" /> : <>
      <KeyboardAwareScrollView bottomOffset={24} style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        {step === 1 ? <>
          <Pressable accessibilityRole="button" onPress={() => setSelector('distributor')} style={styles.fieldCard}><View style={styles.fieldIcon}><Store size={18} color="#57718a" /></View><View style={styles.fieldContent}><Text style={styles.fieldLabel}>Distributor <Text style={styles.required}>*</Text></Text><Text style={styles.fieldValue}>{selectedDistributor?.name ?? 'Pilih distributor'}</Text></View><ChevronRight size={17} color="#71839a" /></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setSelector('warehouse')} style={styles.fieldCard}><View style={styles.fieldIcon}><Package size={18} color="#57718a" /></View><View style={styles.fieldContent}><Text style={styles.fieldLabel}>Gudang pusat <Text style={styles.required}>*</Text></Text><Text style={styles.fieldValue}>{selectedWarehouse?.name ?? 'Pilih gudang pusat'}</Text></View><ChevronRight size={17} color="#71839a" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Tanggal pembelian ${displayDate(purchaseDate)}`} onPress={() => { setDatePickerValue(new Date(`${purchaseDate}T00:00:00`)); setDatePickerVisible(true); }} style={styles.fieldCard}><View style={styles.fieldIcon}><CalendarDays size={18} color="#57718a" /></View><View style={styles.fieldContent}><Text style={styles.fieldLabel}>Tanggal pembelian <Text style={styles.required}>*</Text></Text><Text style={styles.fieldValue}>{displayDate(purchaseDate)}</Text></View><ChevronRight size={17} color="#71839a" /></Pressable>
          <View style={styles.inputCard}><View style={styles.fieldIcon}><FileText size={18} color="#57718a" /></View><View style={styles.fieldContent}><Text style={styles.fieldLabel}>Invoice distributor <Text style={styles.required}>*</Text></Text><TextInput accessibilityLabel="Invoice distributor" value={distributorInvoiceNumber} onChangeText={setDistributorInvoiceNumber} placeholder="Masukkan nomor invoice" style={styles.fieldInput} /></View></View>
          <View style={styles.amountCard}><PercentIcon /><View style={styles.fieldContent}><Text style={styles.fieldLabel}>Diskon transaksi</Text><TextInput accessibilityLabel="Diskon transaksi" value={discountAmount} onChangeText={setDiscountAmount} keyboardType="decimal-pad" placeholder="0" style={styles.fieldInput} /></View></View>
          <View style={styles.amountCard}><Plus size={19} color="#71839a" /><View style={styles.fieldContent}><Text style={styles.fieldLabel}>Biaya tambahan</Text><TextInput accessibilityLabel="Biaya tambahan" value={additionalCost} onChangeText={setAdditionalCost} keyboardType="decimal-pad" placeholder="0" style={styles.fieldInput} /></View></View>
          <View style={styles.noteCard}><Text style={styles.fieldLabel}>Catatan</Text><TextInput accessibilityLabel="Catatan pembelian" value={note} onChangeText={setNote} placeholder="Tambahkan catatan (opsional)" multiline style={styles.noteInput} /></View>
        </> : null}

        {step === 2 ? <>
          <View style={styles.selectorSummary}><Text numberOfLines={1} style={styles.fieldValue}>{selectedDistributor?.name ?? 'Pilih distributor'}</Text><Text numberOfLines={1} style={styles.meta}>{selectedWarehouse?.name ?? 'Pilih gudang pusat'} · {displayDate(purchaseDate)}</Text></View>
          <View style={styles.productSearchRow}><View style={styles.searchField}><Search size={17} color="#708198" /><TextInput accessibilityLabel="Cari produk pembelian" value={productSearch} onChangeText={setProductSearch} placeholder="Cari produk atau SKU" style={styles.searchInput} /></View><Pressable accessibilityRole="button" accessibilityLabel="Scan barcode produk" onPress={() => setScannerVisible(true)} style={styles.scanButton}><Barcode size={20} color="#fff" /></Pressable></View>
          <View style={styles.lineTypeSwitch}>{(['PURCHASE', 'BONUS'] as const).map((type) => {
            const count = lines.filter((line) => line.lineType === type).length;
            return <Pressable key={type} onPress={() => { setLineType(type); setExpandedProductId(null); }} style={[styles.lineTypeButton, lineType === type && styles.lineTypeSelected]}><Text style={[styles.lineTypeText, lineType === type && styles.lineTypeTextSelected]}>{type === 'BONUS' ? 'Bonus' : 'Pembelian'}{count ? ` (${count})` : ''}</Text></Pressable>;
          })}</View>
          <Text style={styles.sectionHeading}>Pilih produk</Text>
          {filteredProducts.map((product) => {
            const index = lines.findIndex((entry) => entry.productId === product.id && entry.lineType === lineType);
            const line = index >= 0 ? lines[index] : undefined;
            const units = unitOptions(product);
            const activeUnit = units.find((unit) => unit.unitId === line?.unitId) ?? units[0];
            const expanded = Boolean(line) && expandedProductId === product.id;
            return <View key={product.id} style={[styles.productCard, line && styles.productCardSelected]}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={line ? `${expanded ? 'Tutup' : 'Buka'} detail ${product.name}` : `Tambah ${product.name}`} onPress={() => { if (!line) addProduct(product); setExpandedProductId(line && expanded ? null : product.id); }} style={({ pressed }) => [styles.productRow, pressed && styles.pressed]}>
                {product.images[0]?.url ? <Image source={{ uri: product.images[0].url }} style={styles.productImage} /> : <View style={[styles.productImage, styles.imageFallback]}><Package size={20} color="#8191a3" /></View>}
                <View style={styles.productInfo}>
                  <Text numberOfLines={1} style={styles.productName}>{product.name}</Text>
                  <Text style={styles.meta}>{product.sku} · {activeUnit.unit.code}</Text>
                  {line ? <Text numberOfLines={1} style={[styles.meta, styles.lineAmount]}>{line.lineType === 'BONUS' ? 'Bonus · Rp 0' : money(lineSubtotal(line))}</Text> : <Text style={styles.meta}>Harga modal {money(defaultUnitPrice(product, activeUnit.unitId))}</Text>}
                </View>
                {line ? <View style={styles.qtyStepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${product.name}`} hitSlop={6} onPress={() => changeLineQuantity(product.id, lineType, -1)} style={styles.qtyButton}><Minus size={16} color="#07885b" /></Pressable>
                  <Text style={styles.qtyValue}>{quantity(line.orderedQty)}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${product.name}`} hitSlop={6} onPress={() => addProduct(product)} style={[styles.qtyButton, styles.qtyButtonPrimary]}><Plus size={16} color="#fff" /></Pressable>
                  {expanded ? <ChevronUp size={16} color="#71839a" /> : <ChevronDown size={16} color="#71839a" />}
                </View> : <Plus size={19} color="#07885b" />}
              </Pressable>
              {expanded && line ? <View style={styles.productPanel}>
                {units.length > 1 ? <View><Text style={styles.inputLabel}>Satuan</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowUnitOptions}>{units.map((unit) => <Pressable key={unit.unitId} accessibilityRole="button" accessibilityLabel={`Satuan ${unit.unit.name}`} accessibilityState={{ selected: line.unitId === unit.unitId }} onPress={() => chooseLineUnit(index, product, unit.unitId)} style={[styles.unitChip, line.unitId === unit.unitId && styles.unitChipActive]}><Text style={[styles.unitText, line.unitId === unit.unitId && styles.unitTextActive]}>{unit.unit.code}</Text></Pressable>)}</ScrollView></View> : null}
                <View style={styles.productInputs}>
                  <View style={styles.productInputGroup}><Text style={styles.inputLabel}>Jumlah</Text><TextInput accessibilityLabel={`Jumlah ${product.name}`} keyboardType="decimal-pad" value={line.orderedQty} onChangeText={(value) => updateLine(index, { orderedQty: value.replace(',', '.') })} style={styles.smallInput} /></View>
                  <View style={styles.productInputGroup}><Text style={styles.inputLabel}>Harga modal</Text><TextInput accessibilityLabel={`Harga modal ${product.name}`} editable={false} value={line.unitPrice} style={[styles.smallInput, styles.readOnlyInput]} /></View>
                  <View style={styles.productInputGroup}><Text style={styles.inputLabel}>Diskon item</Text><TextInput accessibilityLabel={`Diskon item ${product.name}`} editable={line.lineType !== 'BONUS'} keyboardType="decimal-pad" value={line.discountAmount} onChangeText={(value) => updateLine(index, { discountAmount: value.replace(',', '.') })} style={[styles.smallInput, line.lineType === 'BONUS' && styles.readOnlyInput]} /></View>
                </View>
                <View style={styles.lineTotal}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${product.name}`} hitSlop={6} onPress={() => { setLines((current) => current.filter((_, lineIndex) => lineIndex !== index)); setExpandedProductId(null); }} style={styles.removeLine}><X size={14} color="#d33a36" /><Text style={styles.removeLineText}>Hapus</Text></Pressable>
                  <Text style={styles.lineAmount}>Subtotal {money(lineSubtotal(line))}</Text>
                </View>
              </View> : null}
            </View>;
          })}
          {productError ? <View style={styles.productNotice}><Text style={styles.productNoticeText}>Produk gagal dimuat: {productError}</Text><Pressable accessibilityRole="button" onPress={() => { setLoading(true); setProductError(''); setReloadKey((value) => value + 1); }} style={styles.retryButton}><Text style={styles.retryText}>Coba lagi</Text></Pressable></View>
            : !products.length ? <Text style={styles.emptyText}>Belum ada produk aktif. Tambahkan produk di menu Produk terlebih dahulu.</Text>
              : !filteredProducts.length ? <Text style={styles.emptyText}>Produk tidak ditemukan untuk “{productSearch.trim()}”.</Text> : null}
          <Summary subtotal={subtotal} discount={headerDiscount} additionalCost={Number(additionalCost) || 0} total={grandTotal} />
        </> : null}

        {step === 3 ? <>
          <View style={styles.confirmCard}><Text style={styles.sectionHeading}>Konfirmasi pembelian</Text><SummaryRow label="Distributor" value={selectedDistributor?.name ?? '—'} /><SummaryRow label="Gudang pusat" value={selectedWarehouse?.name ?? '—'} /><SummaryRow label="Tanggal" value={displayDate(purchaseDate)} /><SummaryRow label="Invoice distributor" value={distributorInvoiceNumber.trim()} /></View>
          <View style={styles.confirmCard}><Text style={styles.sectionHeading}>Daftar produk ({lines.length})</Text>{lines.map((line) => {
            const product = products.find((entry) => entry.id === line.productId)!;
            const unit = unitOptions(product).find((entry) => entry.unitId === line.unitId);
            return <View key={`${line.productId}-${line.lineType}`} style={styles.confirmLine}><View style={styles.fieldContent}><Text style={styles.productName}>{product.name}{line.lineType === 'BONUS' ? ' (Bonus)' : ''}</Text><Text style={styles.meta}>{line.orderedQty} {unit?.unit.code ?? product.unit.code} × {money(line.unitPrice)}</Text></View><Text style={styles.lineAmount}>{money(lineSubtotal(line))}</Text></View>;
          })}<SummaryRow label="Subtotal" value={money(subtotal)} /><SummaryRow label="Diskon transaksi" value={`- ${money(headerDiscount)}`} /><SummaryRow label="Biaya tambahan" value={money(Number(additionalCost) || 0)} /><View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{money(grandTotal)}</Text></View></View>
          <View style={styles.confirmCard}><Text style={styles.sectionHeading}>Langkah berikutnya</Text><Text style={styles.meta}>Simpan draft terlebih dahulu. Tambahkan foto invoice dari detail pembelian sebelum submit.</Text></View>
        </> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </KeyboardAwareScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom + 8) }]}>
        {step > 1 ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => setStep((current) => Math.max(1, current - 1))} style={styles.backButton}><Text style={styles.backButtonText}>Kembali</Text></Pressable> : <Pressable accessibilityRole="button" onPress={onCancel} style={styles.backButton}><Text style={styles.backButtonText}>Batal</Text></Pressable>}
        {step < 3 ? <Pressable accessibilityRole="button" disabled={loading} onPress={nextStep} style={[styles.nextButton, loading && styles.disabled]}><Text style={styles.nextButtonText}>{step === 1 ? 'Lanjut ke produk' : 'Lanjut ke konfirmasi'}</Text><ChevronRight size={17} color="#fff" /></Pressable> : <Pressable accessibilityRole="button" disabled={saving} onPress={() => void saveDraft()} style={[styles.nextButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <><Check size={17} color="#fff" /><Text style={styles.nextButtonText}>Simpan draft</Text></>}</Pressable>}
      </View>
    </>}
    <Modal visible={selector !== null} transparent animationType="slide" onRequestClose={() => setSelector(null)}>
      <View style={styles.backdrop}><View style={[styles.selectorSheet, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}><View style={styles.selectorHeader}><Text style={styles.selectorTitle}>{selectionTitle}</Text><Pressable accessibilityRole="button" onPress={() => setSelector(null)} style={styles.closeButton}><X size={19} color="#526276" /></Pressable></View><ScrollView contentContainerStyle={styles.selectorList}>{selectionItems.length ? selectionItems.map((option) => <Pressable key={option.id} accessibilityRole="button" onPress={() => { if (selector === 'distributor') setDistributorId(option.id); else setWarehouseId(option.id); setSelector(null); }} style={styles.selectorRow}><Text style={styles.selectorOption}>{option.name}</Text><ChevronRight size={17} color="#71839a" /></Pressable>) : <Text style={styles.selectorEmpty}>{selector === 'distributor' ? distributorError || 'Distributor belum tersedia.' : warehouseError || 'Gudang pusat belum tersedia.'}</Text>}</ScrollView></View></View>
    </Modal>
    {Platform.OS === 'android' && datePickerVisible ? <DateTimePicker value={datePickerValue} mode="date" display="default" onChange={(event, date) => { setDatePickerVisible(false); if (event.type === 'set' && date) { setDatePickerValue(date); setPurchaseDate(dateInputValue(date)); } }} /> : null}
    {Platform.OS === 'ios' ? <Modal visible={datePickerVisible} transparent animationType="slide" onRequestClose={() => setDatePickerVisible(false)}><View style={styles.backdrop}><View style={[styles.datePickerSheet, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}><View style={styles.datePickerHeader}><Pressable accessibilityRole="button" onPress={() => setDatePickerVisible(false)}><Text style={styles.datePickerAction}>Batal</Text></Pressable><Text style={styles.datePickerTitle}>Tanggal pembelian</Text><Pressable accessibilityRole="button" onPress={() => { setPurchaseDate(dateInputValue(datePickerValue)); setDatePickerVisible(false); }}><Text style={styles.datePickerAction}>Pilih</Text></Pressable></View><DateTimePicker value={datePickerValue} mode="date" display="spinner" onChange={(_, date) => { if (date) setDatePickerValue(date); }} /></View></View></Modal> : null}
    <BarcodeScanner visible={scannerVisible} onClose={() => setScannerVisible(false)} onScanned={scanProduct} />
  </View>;
}

function PercentIcon() { return <Text style={styles.percentIcon}>%</Text>; }

function Summary({ subtotal, discount, additionalCost, total }: { subtotal: number; discount: number; additionalCost: number; total: number }) {
  return <View style={styles.summaryCard}><SummaryRow label="Subtotal" value={money(subtotal)} /><SummaryRow label="Diskon" value={`- ${money(discount)}`} /><SummaryRow label="Biaya tambahan" value={money(additionalCost)} /><View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{money(total)}</Text></View></View>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
}

function lineSubtotal(line: PurchaseLine) {
  return line.lineType === 'BONUS' ? 0 : Math.max(0, Number(line.orderedQty) * Number(line.unitPrice) - Number(line.discountAmount || 0));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' }, header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, backgroundColor: '#fff' }, headerBack: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: '#172338', fontSize: 14, fontWeight: '900' }, headerSpacer: { width: 34 },
  stepper: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#fff' }, stepWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, stepCircle: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#edf1f4' }, stepCircleActive: { backgroundColor: '#07885b' }, stepNumber: { color: '#71839a', fontSize: 11, fontWeight: '900' }, stepNumberActive: { color: '#fff' }, stepLabel: { marginLeft: 5, color: '#8593a2', fontSize: 11 }, stepLabelCurrent: { color: '#17443c', fontWeight: '900' }, stepLine: { flex: 1, height: 1, marginHorizontal: 6, backgroundColor: '#e6ecef' }, stepLineActive: { backgroundColor: '#07885b' },
  body: { flex: 1 }, bodyContent: { padding: 12, paddingBottom: 18, gap: 9 }, loading: { flex: 1 }, fieldCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, borderWidth: 1, borderColor: '#e8edf0', borderRadius: 12, backgroundColor: '#fff' }, fieldIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#edf3f7' }, fieldContent: { flex: 1, minWidth: 0 }, fieldLabel: { color: '#61748a', fontSize: 11, fontWeight: '800' }, required: { color: '#d5483e' }, fieldValue: { marginTop: 4, color: '#24364a', fontSize: 12, fontWeight: '700' }, inputCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderWidth: 1, borderColor: '#e8edf0', borderRadius: 12, backgroundColor: '#fff' }, fieldInput: { height: 32, padding: 0, color: '#26394d', fontSize: 12 },
  amountCard: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e8edf0', borderRadius: 12, backgroundColor: '#fff' }, percentIcon: { width: 19, color: '#71839a', fontSize: 17, fontWeight: '700', textAlign: 'center' }, noteCard: { padding: 11, borderWidth: 1, borderColor: '#e8edf0', borderRadius: 12, backgroundColor: '#fff' }, noteInput: { minHeight: 60, marginTop: 6, color: '#26394d', fontSize: 12, textAlignVertical: 'top' },
  productNotice: { gap: 8, marginTop: 8, padding: 11, borderRadius: 10, backgroundColor: '#fff1ef' }, productNoticeText: { color: '#a3332a', fontSize: 12, lineHeight: 17 }, retryButton: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#fff' }, retryText: { color: '#a3332a', fontSize: 12, fontWeight: '900' },
  selectorSummary: { padding: 11, borderRadius: 11, backgroundColor: '#fff' }, productSearchRow: { flexDirection: 'row', gap: 7 }, searchField: { height: 44, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: '#e2e9ed', borderRadius: 10, backgroundColor: '#fff' }, searchInput: { flex: 1, color: '#24364a', fontSize: 12 }, scanButton: { width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#d92d2d' }, lineTypeSwitch: { flexDirection: 'row', gap: 6 }, lineTypeButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9, backgroundColor: '#edf2f5' }, lineTypeSelected: { backgroundColor: '#07885b' }, lineTypeText: { color: '#61748a', fontSize: 12, fontWeight: '800' }, lineTypeTextSelected: { color: '#fff' }, sectionHeading: { marginTop: 5, marginBottom: 3, color: '#26384a', fontSize: 14, fontWeight: '900' }, productCard: { overflow: 'hidden', borderWidth: 1, borderColor: '#e8edf0', borderRadius: 11, backgroundColor: '#fff' }, productCardSelected: { borderColor: '#9fd8bf' }, productRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9 }, productPanel: { gap: 9, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 10, borderTopWidth: 1, borderTopColor: '#eef2f4', backgroundColor: '#fbfcfc' }, removeLine: { flexDirection: 'row', alignItems: 'center', gap: 4 }, removeLineText: { color: '#d33a36', fontSize: 11, fontWeight: '800' }, pressed: { opacity: 0.75 }, productImage: { width: 44, height: 48, borderRadius: 8, backgroundColor: '#edf2f4' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, productInfo: { flex: 1, minWidth: 0 }, productName: { color: '#24364a', fontSize: 12, fontWeight: '900' }, rowUnitOptions: { gap: 5, paddingTop: 7 }, qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 6 }, qtyButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#07885b', borderRadius: 15, backgroundColor: '#fff' }, qtyButtonPrimary: { backgroundColor: '#07885b' }, qtyValue: { minWidth: 26, color: '#24364a', fontSize: 13, fontWeight: '900', textAlign: 'center' }, meta: { marginTop: 3, color: '#7b8b9b', fontSize: 11 }, emptyText: { padding: 14, color: '#7b8b9b', fontSize: 12, textAlign: 'center' },
  unitChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: '#edf2f5' }, unitChipActive: { backgroundColor: '#d9f3e8' }, unitText: { color: '#61748a', fontSize: 11, fontWeight: '800' }, unitTextActive: { color: '#087c53' }, productInputs: { flexDirection: 'row', gap: 6 }, productInputGroup: { flex: 1 }, inputLabel: { marginBottom: 4, color: '#77879a', fontSize: 11 }, smallInput: { height: 38, paddingHorizontal: 7, borderWidth: 1, borderColor: '#e1e8ec', borderRadius: 8, color: '#24364a', fontSize: 12 }, readOnlyInput: { color: '#8190a0', backgroundColor: '#f4f6f7' }, lineTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 }, lineAmount: { color: '#07885b', fontSize: 12, fontWeight: '900' }, summaryCard: { padding: 12, borderRadius: 11, backgroundColor: '#fff' }, summaryRow: { minHeight: 29, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 }, summaryLabel: { color: '#708198', fontSize: 11 }, summaryValue: { color: '#24364a', fontSize: 11, fontWeight: '700' }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#edf1f3' }, totalLabel: { color: '#26384a', fontSize: 13, fontWeight: '900' }, totalValue: { color: '#07885b', fontSize: 14, fontWeight: '900' },
  confirmCard: { padding: 12, borderRadius: 11, backgroundColor: '#fff' }, confirmLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f2f4' }, photoActions: { flexDirection: 'row', gap: 7, marginTop: 10 }, photoButton: { flex: 1, minHeight: 41, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 9, backgroundColor: '#e5f7ee' }, photoButtonText: { color: '#087c53', fontSize: 11, fontWeight: '900' }, photoList: { gap: 7, paddingTop: 9 }, photoWrap: { position: 'relative' }, photo: { width: 62, height: 62, borderRadius: 9, backgroundColor: '#edf2f4' }, removePhoto: { position: 'absolute', top: 3, right: 3, width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#d3433e' }, noPhoto: { marginTop: 8, color: '#a53631', fontSize: 11 },
  error: { padding: 10, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 12, lineHeight: 17 }, footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#e7ecef', backgroundColor: '#fff' }, backButton: { minHeight: 46, minWidth: 76, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e2e9ed', borderRadius: 10, backgroundColor: '#fff' }, backButtonText: { color: '#53677e', fontSize: 12, fontWeight: '800' }, nextButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: '#07885b' }, nextButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' }, disabled: { opacity: 0.5 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, selectorSheet: { maxHeight: '75%', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 20, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' }, selectorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, selectorTitle: { color: '#172338', fontSize: 15, fontWeight: '900' }, closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#eff3f5' }, selectorList: { paddingBottom: 4 }, selectorRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#edf1f3' }, selectorOption: { color: '#293b4f', fontSize: 12, fontWeight: '700' }, selectorEmpty: { paddingVertical: 16, color: '#7b8b9b', fontSize: 12, lineHeight: 17, textAlign: 'center' }, datePickerSheet: { paddingHorizontal: 16, paddingTop: 14, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' }, datePickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 }, datePickerTitle: { color: '#26384a', fontSize: 14, fontWeight: '900' }, datePickerAction: { color: '#07885b', fontSize: 13, fontWeight: '900' },
});
