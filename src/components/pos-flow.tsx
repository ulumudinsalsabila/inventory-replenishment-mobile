import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Banknote, Barcode, Check, ChevronLeft, ChevronRight, CircleCheck, CreditCard, Landmark, Minus, Plus, Printer, QrCode, ReceiptText, Search, Share2, ShoppingCart, Store, Trash2, Wallet, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../lib/responsive';
import { AppShellHeader } from './app-shell-header';
import { BarcodeScanner } from './barcode-scanner';
import { formatDate, formatStatus } from '../lib/display';
import type { PairedPrinter, ReceiptOrder } from '../lib/receipt-printer';

export type PosMethod = 'CASH' | 'QRIS' | 'TRANSFER' | 'GRAB' | 'GOBIZ';

export type PosProduct = {
  id: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
  barcode?: string | null;
  displayQuantity?: string | number;
  basePrice: string;
  available: string;
  trackInventory: boolean;
  category?: { name: string } | null;
  unit?: { id: string; code: string; name: string } | null;
  sellingUnits: { unitId: string; conversionFactor: string; sellingPrice: string; unit: { id: string; code: string; name: string } }[];
  variants?: { id: string; name: string; priceDelta: string }[];
  addons?: { id: string; name: string; basePrice: string }[];
};

export type PosLine = {
  key: string;
  product: PosProduct;
  unitId: string;
  quantity: number;
  variantId: string;
  addonIds: string[];
};

type CheckoutProps = {
  lines: PosLine[];
  topInset: number;
  paymentStep: boolean;
  onPaymentStepChange: (value: boolean) => void;
  customer: string;
  onCustomerChange: (value: string) => void;
  discount: string;
  onDiscountChange: (value: string) => void;
  method: PosMethod;
  onMethodChange: (value: PosMethod) => void;
  total: number;
  subtotal: number;
  discountAmount: number;
  priceFor: (line: PosLine) => number;
  onQuantity: (key: string, delta: number) => void;
  canIncrease: (line: PosLine) => boolean;
  onCheckout: () => void;
  onClear: () => void;
  onClose: () => void;
  submitting: boolean;
  error: string;
  onError: (value: string) => void;
  takeaway: boolean;
  onTakeawayChange: (value: boolean) => void;
  bottomInset: number;
};

const money = (value: string | number) => `Rp ${Math.max(0, Number(value) || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const methods: { id: PosMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'CASH', label: 'Cash', icon: Banknote },
  { id: 'QRIS', label: 'QRIS', icon: QrCode },
  { id: 'TRANSFER', label: 'Transfer', icon: Landmark },
  { id: 'GRAB', label: 'Grab', icon: Wallet },
  { id: 'GOBIZ', label: 'GoBiz', icon: Wallet },
];

type CatalogProps = {
  branches: { id: string; name: string }[];
  warehouses: { id: string; name: string; branchId: string | null }[];
  branchId: string;
  warehouseId: string;
  userBranchId: string | null;
  products: PosProduct[];
  categories: string[];
  selectedCategory: string;
  displayOnly: boolean;
  search: string;
  visibleProducts: PosProduct[];
  cart: PosLine[];
  total: number;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  error: string;
  optionProduct: PosProduct | null;
  optionUnit: string;
  optionVariant: string;
  optionAddons: string[];
  topInset: number;
  bottomInset: number;
  onBranchChange: (id: string) => void;
  onWarehouseChange: (id: string) => void;
  onCategoryChange: (name: string) => void;
  onDisplayOnlyChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  onAdd: (product: PosProduct) => void;
  onQuantity: (key: string, delta: number) => void;
  canAdd: (product: PosProduct, unitId?: string) => boolean;
  priceFor: (line: PosLine) => number;
  onOpenCart: () => void;
  /** Empties the cart (tablet cart panel). */
  onClear: () => void;
  onScan: (value: string) => void;
  onCloseOption: () => void;
  onOptionUnitChange: (id: string) => void;
  onOptionVariantChange: (id: string) => void;
  onOptionAddonsChange: (ids: string[]) => void;
  onAddConfigured: () => void;
};

function ProductRowGap() {
  return <View style={catalogStyles.productRowGap} />;
}

const GRID_GAP = 12;

export function PosCatalogScreen(props: CatalogProps) {
  const styles = catalogStyles;
  const insets = useSafeAreaInsets();
  const { isTablet, columns } = useResponsive();
  const [gridWidth, setGridWidth] = useState(0);
  const [scannerVisible, setScannerVisible] = useState(false);
  const totalItems = props.cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartQuantities = useMemo(() => {
    const byProduct = new Map<string, { quantity: number; line: PosLine }>();
    for (const line of props.cart) {
      const current = byProduct.get(line.product.id);
      byProduct.set(line.product.id, { quantity: (current?.quantity ?? 0) + line.quantity, line: current?.line ?? line });
    }
    return byProduct;
  }, [props.cart]);

  const optionSheet = <>
    <Modal visible={Boolean(props.optionProduct)} animationType="slide" transparent onRequestClose={props.onCloseOption}>
      <View style={styles.modalBackdrop}><View style={[styles.optionSheet, { paddingBottom: Math.max(props.bottomInset + 8, 26) }]}>
        <View style={styles.optionHeader}><View><Text style={styles.optionTitle}>{props.optionProduct?.name}</Text><Text style={styles.catalogProductCategory}>Pilih satuan, varian, dan add-on</Text></View><Pressable accessibilityRole="button" onPress={props.onCloseOption} style={styles.catalogHeaderIcon}><X size={19} color="#435a72" /></Pressable></View>
        {(props.optionProduct?.sellingUnits.length ?? 0) > 1 ? <><Text style={styles.optionSection}>Satuan</Text>{props.optionProduct?.sellingUnits.map((unit) => <Pressable key={unit.unitId} onPress={() => props.onOptionUnitChange(unit.unitId)} style={[styles.optionChoice, props.optionUnit === unit.unitId && styles.optionChoiceActive]}><Text style={styles.optionChoiceText}>{unit.unit.name} ({unit.unit.code})</Text><Text style={styles.optionChoiceText}>{money(unit.sellingPrice)}{props.optionUnit === unit.unitId ? '  ✓' : ''}</Text></Pressable>)}</> : null}
        {(props.optionProduct?.variants?.length ?? 0) > 0 ? <><Text style={styles.optionSection}>Varian</Text>{props.optionProduct?.variants?.map((variant) => <Pressable key={variant.id} onPress={() => props.onOptionVariantChange(variant.id)} style={[styles.optionChoice, props.optionVariant === variant.id && styles.optionChoiceActive]}><Text style={styles.optionChoiceText}>{variant.name}</Text><Text style={styles.optionChoiceText}>{money(variant.priceDelta)}{props.optionVariant === variant.id ? '  ✓' : ''}</Text></Pressable>)}</> : null}
        {(props.optionProduct?.addons?.length ?? 0) > 0 ? <><Text style={styles.optionSection}>Add-on</Text>{props.optionProduct?.addons?.map((addon) => {
          const selected = props.optionAddons.includes(addon.id);
          return <Pressable key={addon.id} onPress={() => props.onOptionAddonsChange(selected ? props.optionAddons.filter((id) => id !== addon.id) : [...props.optionAddons, addon.id])} style={[styles.optionChoice, selected && styles.optionChoiceActive]}><Text style={styles.optionChoiceText}>{addon.name}</Text><Text style={styles.optionChoiceText}>{money(addon.basePrice)}{selected ? '  ✓' : ''}</Text></Pressable>;
        })}</> : null}
        <Pressable accessibilityRole="button" disabled={!props.optionProduct || !props.canAdd(props.optionProduct, props.optionUnit)} onPress={props.onAddConfigured} style={[styles.primaryButton, (!props.optionProduct || !props.canAdd(props.optionProduct, props.optionUnit)) && styles.disabled]}><Text style={styles.primaryText}>Tambah ke pesanan</Text></Pressable>
      </View></View>
    </Modal>
  </>;
  const searchBox = <View style={[styles.catalogSearchBox, isTablet && styles.tabletSearchBox]}><Search size={17} color="#78889c" /><TextInput accessibilityLabel="Cari produk" value={props.search} onChangeText={props.onSearchChange} placeholder="Cari menu atau SKU..." placeholderTextColor="#8290a2" style={styles.catalogSearchInput} /></View>;
  const scanButton = <Pressable accessibilityRole="button" accessibilityLabel="Scan barcode" onPress={() => setScannerVisible(true)} style={[styles.catalogScanButton, isTablet && styles.tabletScanButton]}><Barcode size={21} color="#fff" /></Pressable>;
  // Card width follows the measured grid width so every column count fills the row evenly.
  const gridColumns = isTablet ? columns(gridWidth, 175, 6) : 2;
  const cardWidth = isTablet && gridWidth ? (gridWidth - GRID_GAP * (gridColumns - 1)) / gridColumns : undefined;

  const filters = <>
    {!props.userBranchId && props.branches.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchChoices}>{props.branches.map((branch) => <Pressable key={branch.id} onPress={() => props.onBranchChange(branch.id)} style={[styles.branchChip, props.branchId === branch.id && styles.branchChipActive]}><Text numberOfLines={1} style={[styles.branchChipText, props.branchId === branch.id && styles.branchChipTextActive]}>{branch.name}</Text></Pressable>)}</ScrollView> : null}
    {props.warehouses.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchChoices}>{props.warehouses.filter((warehouse) => warehouse.branchId === props.branchId).map((warehouse) => <Pressable key={warehouse.id} onPress={() => props.onWarehouseChange(warehouse.id)} style={[styles.warehouseChip, props.warehouseId === warehouse.id && styles.warehouseChipActive]}><Text style={[styles.branchChipText, props.warehouseId === warehouse.id && styles.warehouseChipTextActive]}>{warehouse.name}</Text></Pressable>)}</ScrollView> : null}
    {!isTablet ? <View style={styles.catalogSearchRow}>{searchBox}{scanButton}</View> : null}
    <View style={styles.catalogFilterRow}><Pressable accessibilityRole="button" accessibilityState={{ selected: !props.displayOnly }} onPress={() => props.onDisplayOnlyChange(false)} style={[styles.catalogFilter, !props.displayOnly && styles.catalogFilterActive]}><Text style={[styles.catalogFilterText, !props.displayOnly && styles.catalogFilterTextActive]}>Semua</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ selected: props.displayOnly }} onPress={() => props.onDisplayOnlyChange(true)} style={[styles.catalogFilter, props.displayOnly && styles.catalogFilterActive]}><Store size={14} color={props.displayOnly ? '#fff' : '#60758a'} /><Text style={[styles.catalogFilterText, props.displayOnly && styles.catalogFilterTextActive]}>Display toko</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChoices}>{props.categories.map((category) => <Pressable key={category} onPress={() => props.onCategoryChange(category)} style={[styles.catalogCategory, props.selectedCategory === category && styles.catalogCategoryActive]}><Text style={[styles.catalogCategoryText, props.selectedCategory === category && styles.catalogCategoryTextActive]}>{category}</Text></Pressable>)}</ScrollView>
    {props.loading ? <View style={styles.loadingRow}><ActivityIndicator color="#07885b" /><Text style={styles.loadingText}>Memuat produk...</Text></View> : null}
    {props.error ? <Text style={[styles.errorText, styles.catalogError]}>{props.error}</Text> : null}
  </>;

  const grid = <FlatList
    key={`grid-${gridColumns}`}
    style={styles.content}
    contentContainerStyle={[styles.catalogContent, isTablet && styles.tabletCatalogContent]}
    keyboardShouldPersistTaps="handled"
    data={props.loading ? [] : props.visibleProducts}
    keyExtractor={(product) => product.id}
    numColumns={gridColumns}
    columnWrapperStyle={isTablet ? styles.tabletProductRow : styles.productRow}
    ItemSeparatorComponent={ProductRowGap}
    initialNumToRender={isTablet ? 16 : 8}
    maxToRenderPerBatch={isTablet ? 12 : 8}
    windowSize={7}
    refreshControl={<RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor="#07885b" colors={['#07885b']} />}
    ListHeaderComponent={<View onLayout={isTablet ? (event) => setGridWidth(event.nativeEvent.layout.width) : undefined}>{filters}</View>}
    ListEmptyComponent={props.loading
      ? <View style={styles.productGrid}>{Array.from({ length: isTablet ? gridColumns * 2 : 6 }, (_, index) => <View key={`product-skeleton-${index}`} style={[styles.skeletonCard, cardWidth ? { width: cardWidth } : null]}><View style={styles.skeletonImage} /><View style={styles.skeletonLine} /><View style={styles.skeletonLineShort} /></View>)}</View>
      : <Text style={styles.catalogEmpty}>Produk tidak ditemukan di gudang ini.</Text>}
    renderItem={({ item: product }) => {
      const selected = cartQuantities.get(product.id)?.quantity ?? 0;
      const selectedLine = cartQuantities.get(product.id)?.line;
      const price = product.sellingUnits[0]?.sellingPrice ?? product.basePrice;
      return <View style={[styles.catalogProductCard, cardWidth ? { width: cardWidth } : null]}>
        {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.catalogProductImage} resizeMode="cover" /> : <View style={[styles.catalogProductImage, styles.catalogImageFallback]}><ReceiptText size={28} color="#8191a3" /></View>}
        <Text numberOfLines={isTablet ? 2 : 1} style={styles.catalogProductName}>{product.name}</Text><Text style={styles.catalogProductCategory}>{product.category?.name ?? 'Produk'}</Text><Text style={styles.catalogProductStock}>{props.displayOnly ? `Display ${product.displayQuantity ?? 0} ${product.unit?.code ?? ''}` : `Stok ${product.available} ${product.unit?.code ?? ''}`}</Text>
        <View style={styles.catalogCardFooter}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.catalogProductPrice}>{money(price)}</Text>{selected && selectedLine ? <View style={styles.catalogQuantity}><Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${product.name}`} onPress={() => props.onQuantity(selectedLine.key, -1)} style={styles.catalogQtyButton}><Minus size={15} color="#07885b" /></Pressable><Text style={styles.catalogQtyValue}>{selected}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${product.name}`} disabled={!props.canAdd(product, selectedLine.unitId)} onPress={() => props.onAdd(product)} style={[styles.catalogQtyButtonActive, !props.canAdd(product, selectedLine.unitId) && styles.disabled]}><Plus size={17} color="#fff" /></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${product.name}`} disabled={!props.canAdd(product)} onPress={() => props.onAdd(product)} style={[styles.catalogAddButton, !props.canAdd(product) && styles.disabled]}><Plus size={19} color="#fff" /></Pressable>}</View>
      </View>;
    }}
  />;

  const cartButton = <Pressable accessibilityRole="button" disabled={isTablet && !props.cart.length} onPress={props.onOpenCart} style={[styles.catalogCartBar, isTablet ? styles.tabletCartBar : { marginBottom: 4 }, isTablet && !props.cart.length && styles.disabled]}>
    <ShoppingCart size={19} color="#fff" /><View style={styles.cartBarText}><Text style={styles.catalogCartLabel}>Pesanan ({totalItems})</Text>{isTablet ? <Text style={styles.catalogCartTotal}>{money(props.total)}</Text> : null}</View>{!isTablet ? <Text style={styles.catalogCartTotal}>{money(props.total)}</Text> : null}<ChevronRight size={18} color="#fff" />
  </Pressable>;

  if (isTablet) return <View style={[styles.screen, styles.tabletScreen]}>
    <View style={styles.tabletCatalog}>
      <AppShellHeader compact leading={searchBox} trailing={scanButton} />
      {grid}
    </View>
    <View style={[styles.cartPanel, { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.cartPanelHeader}><Text style={styles.cartPanelTitle}>Pesanan ({totalItems})</Text><Pressable accessibilityRole="button" accessibilityLabel="Kosongkan pesanan" disabled={!props.cart.length} onPress={props.onClear} style={[styles.cartPanelClear, !props.cart.length && styles.disabled]}><Trash2 size={17} color="#8a97a8" /></Pressable></View>
      {props.cart.length ? <ScrollView style={styles.content} contentContainerStyle={styles.cartPanelList}>{props.cart.map((line) => {
        const variant = line.product.variants?.find((item) => item.id === line.variantId)?.name;
        const canIncrease = props.canAdd(line.product, line.unitId);
        return <View key={line.key} style={styles.cartPanelLine}>
          <View style={styles.cartPanelLineText}><Text numberOfLines={2} style={styles.cartPanelName}>{line.product.name}</Text><Text numberOfLines={1} style={styles.catalogProductCategory}>{variant ?? line.product.sku}</Text><Text style={styles.cartPanelPrice}>{money(props.priceFor(line) * line.quantity)}</Text></View>
          <View style={styles.catalogQuantity}><Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${line.product.name}`} onPress={() => props.onQuantity(line.key, -1)} style={styles.catalogQtyButton}><Minus size={15} color="#07885b" /></Pressable><Text style={styles.catalogQtyValue}>{line.quantity}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${line.product.name}`} disabled={!canIncrease} onPress={() => props.onQuantity(line.key, 1)} style={[styles.catalogQtyButtonActive, !canIncrease && styles.disabled]}><Plus size={17} color="#fff" /></Pressable></View>
        </View>;
      })}</ScrollView> : <View style={styles.cartPanelEmpty}><ShoppingCart size={42} color="#b9c4cf" /><Text style={styles.cartPanelEmptyTitle}>Belum ada pesanan</Text><Text style={styles.cartPanelEmptyText}>Pilih produk untuk menambah ke keranjang</Text></View>}
      {cartButton}
    </View>
    {optionSheet}
    <BarcodeScanner visible={scannerVisible} onClose={() => setScannerVisible(false)} onScanned={(value) => { setScannerVisible(false); props.onScan(value); }} />
  </View>;

  return <View style={[styles.screen, { paddingTop: props.topInset }]}>
    <AppShellHeader />
    {grid}
    {cartButton}
    {optionSheet}
    <BarcodeScanner visible={scannerVisible} onClose={() => setScannerVisible(false)} onScanned={(value) => { setScannerVisible(false); props.onScan(value); }} />
  </View>;
}

const catalogStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' },
  tabletScreen: { flexDirection: 'row' },
  tabletCatalog: { flex: 1, minWidth: 0 },
  tabletCatalogContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  tabletProductRow: { gap: GRID_GAP },
  tabletSearchBox: { flex: 1, height: 46 },
  tabletScanButton: { width: 46, height: 46, marginLeft: 6, backgroundColor: '#e23b3b' },
  tabletCartBar: { marginHorizontal: 0, marginTop: 10 },
  cartBarText: { flex: 1 },
  cartPanel: { width: 320, paddingHorizontal: 14, borderLeftWidth: 1, borderLeftColor: '#e8eeeb', backgroundColor: '#fff' },
  cartPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cartPanelTitle: { color: '#172338', fontSize: 15, fontWeight: '900' },
  cartPanelClear: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#f4f7f9' },
  cartPanelList: { gap: 8, paddingBottom: 8 },
  cartPanelLine: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: '#f6f9f8' },
  cartPanelLineText: { flex: 1, minWidth: 0 },
  cartPanelName: { color: '#172338', fontSize: 12, fontWeight: '900' },
  cartPanelPrice: { marginTop: 5, color: '#d72f2a', fontSize: 12, fontWeight: '900' },
  cartPanelEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  cartPanelEmptyTitle: { color: '#5f7186', fontSize: 13, fontWeight: '800' },
  cartPanelEmptyText: { color: '#8a97a8', fontSize: 11, textAlign: 'center' },
  content: { flex: 1 },
  catalogContent: { paddingHorizontal: 13, paddingTop: 12, paddingBottom: 10 },
  catalogHeaderIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f0f4f7' },
  branchChoices: { gap: 7, paddingBottom: 9 },
  branchChip: { maxWidth: 130, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f1f4f6' },
  branchChipActive: { backgroundColor: '#07885b' },
  branchChipText: { color: '#536a80', fontSize: 9, fontWeight: '800' },
  branchChipTextActive: { color: '#fff' },
  warehouseChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#eef5f2' },
  warehouseChipActive: { backgroundColor: '#cceee0' },
  warehouseChipTextActive: { color: '#087c53' },
  catalogSearchRow: { flexDirection: 'row', gap: 7, marginBottom: 10 },
  catalogSearchBox: { height: 43, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e4eaf0', borderRadius: 12, backgroundColor: '#fff' },
  catalogSearchInput: { flex: 1, height: 41, color: '#172338', fontSize: 11 },
  catalogScanButton: { width: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#d92d2d' },
  catalogFilterRow: { flexDirection: 'row', gap: 7, marginBottom: 9 }, catalogFilter: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 10, backgroundColor: '#fff' }, catalogFilterActive: { borderColor: '#07885b', backgroundColor: '#07885b' }, catalogFilterText: { color: '#60758a', fontSize: 9, fontWeight: '800' }, catalogFilterTextActive: { color: '#fff' },
  categoryChoices: { gap: 7, paddingBottom: 11 },
  catalogCategory: { minWidth: 54, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#e7edf1', borderRadius: 10, backgroundColor: '#fff' },
  catalogCategoryActive: { borderColor: '#07885b', backgroundColor: '#07885b' },
  catalogCategoryText: { color: '#536a80', fontSize: 9, fontWeight: '700' },
  catalogCategoryTextActive: { color: '#fff' },
  loadingRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, loadingText: { color: '#687b91', fontSize: 10, fontWeight: '700' }, skeletonCard: { width: '48.7%', height: 191, overflow: 'hidden', paddingBottom: 9, borderWidth: 1, borderColor: '#e9eef1', borderRadius: 12, backgroundColor: '#fff' }, skeletonImage: { width: '100%', height: 104, backgroundColor: '#e9eff2' }, skeletonLine: { height: 8, marginTop: 12, marginHorizontal: 9, borderRadius: 4, backgroundColor: '#e9eff2' }, skeletonLineShort: { width: '55%', height: 7, marginTop: 8, marginHorizontal: 9, borderRadius: 4, backgroundColor: '#f0f3f5' },
  errorText: { padding: 10, borderRadius: 9, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10 },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 9 },
  productRow: { justifyContent: 'space-between' },
  productRowGap: { height: 9 },
  catalogError: { marginBottom: 9 },
  catalogProductCard: { width: '48.7%', overflow: 'hidden', paddingBottom: 9, borderWidth: 1, borderColor: '#e9eef1', borderRadius: 12, backgroundColor: '#fff' },
  catalogProductImage: { width: '100%', height: 104, backgroundColor: '#edf2f4' },
  catalogImageFallback: { alignItems: 'center', justifyContent: 'center' },
  catalogProductName: { marginTop: 8, paddingHorizontal: 9, color: '#172338', fontSize: 10, fontWeight: '900' },
  catalogProductCategory: { marginTop: 4, paddingHorizontal: 9, color: '#71839a', fontSize: 8 },
  catalogProductStock: { marginTop: 5, paddingHorizontal: 9, color: '#71839a', fontSize: 8 },
  catalogCardFooter: { minHeight: 33, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 3, marginTop: 7, paddingHorizontal: 8 },
  catalogProductPrice: { flex: 1, color: '#172338', fontSize: 10, fontWeight: '900' },
  catalogQuantity: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  catalogQtyButton: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#e3f6ee' },
  catalogQtyButtonActive: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#07956f' },
  catalogQtyValue: { minWidth: 13, color: '#293a4d', fontSize: 9, fontWeight: '900', textAlign: 'center' },
  catalogAddButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#07956f' },
  catalogEmpty: { paddingVertical: 18, color: '#75869a', fontSize: 11, textAlign: 'center' },
  catalogCartBar: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 13, marginTop: 5, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#008c63' },
  catalogCartLabel: { flex: 1, color: '#fff', fontSize: 10, fontWeight: '900' },
  catalogCartTotal: { color: '#fff', fontSize: 11, fontWeight: '900' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  optionSheet: { maxHeight: '85%', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 26, borderTopLeftRadius: 19, borderTopRightRadius: 19, backgroundColor: '#fff' },
  optionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  optionTitle: { color: '#172338', fontSize: 15, fontWeight: '900' },
  optionSection: { marginTop: 11, marginBottom: 6, color: '#687b91', fontSize: 9, fontWeight: '900' },
  optionChoice: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: '#e6ecef', borderRadius: 10 },
  optionChoiceActive: { borderColor: '#9bd9bf', backgroundColor: '#edf9f3' },
  optionChoiceText: { color: '#27384c', fontSize: 10, fontWeight: '700' },
  primaryButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 12, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#07956f' },
  primaryText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});

function FlowHeader({ title, count, onClose, onClear }: { title: string; count?: number; onClose: () => void; onClear?: () => void }) {
  return <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="Kembali ke katalog" onPress={onClose} style={styles.headerIcon}><ChevronLeft size={23} color="#172338" /></Pressable>
    <Text numberOfLines={1} style={styles.headerTitle}>{title}{count === undefined ? '' : ` (${count})`}</Text>
    {onClear ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus pesanan" onPress={onClear} style={styles.headerAction}><X size={19} color="#d62e2e" /></Pressable> : <View style={styles.headerIcon} />}
  </View>;
}

export function PosCheckoutFlow(props: CheckoutProps) {
  const count = props.lines.reduce((sum, line) => sum + line.quantity, 0);
  const continueToPayment = () => {
    if (!props.customer.trim()) { props.onError('Nama pelanggan wajib diisi.'); return; }
    props.onError('');
    props.onPaymentStepChange(true);
  };

  return <View style={[styles.screen, { paddingTop: props.topInset }]}>
    <FlowHeader title={props.paymentStep ? 'Pembayaran' : 'Pesanan'} count={count} onClose={props.onClose} onClear={props.onClear} />
    <View style={styles.steps}>
      <Pressable accessibilityRole="button" onPress={() => props.onPaymentStepChange(false)} style={[styles.step, !props.paymentStep && styles.stepActive]}>
        <View style={[styles.stepNumber, !props.paymentStep && styles.stepNumberActive]}><Text style={[styles.stepNumberText, !props.paymentStep && styles.stepNumberTextActive]}>1</Text></View><Text style={[styles.stepLabel, !props.paymentStep && styles.stepLabelActive]}>Pesanan</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!props.lines.length} onPress={continueToPayment} style={[styles.step, props.paymentStep && styles.stepActive]}>
        <View style={[styles.stepNumber, props.paymentStep && styles.stepNumberActive]}><Text style={[styles.stepNumberText, props.paymentStep && styles.stepNumberTextActive]}>2</Text></View><Text style={[styles.stepLabel, props.paymentStep && styles.stepLabelActive]}>Pembayaran</Text>
      </Pressable>
    </View>

    {!props.paymentStep ? <>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentBody} keyboardShouldPersistTaps="handled">
        <View style={styles.customerCard}>
          <Text style={styles.fieldLabel}>PELANGGAN</Text>
          <TextInput accessibilityLabel="Nama pelanggan" autoFocus style={styles.customerInput} value={props.customer} onChangeText={props.onCustomerChange} placeholder="Nama pelanggan" placeholderTextColor="#8a97a8" />
          <View style={styles.serviceModes}>
            {[{ label: 'Dine in', value: false }, { label: 'Take away', value: true }].map((option) => <Pressable key={option.label} accessibilityRole="button" onPress={() => props.onTakeawayChange(option.value)} style={[styles.modeButton, props.takeaway === option.value && styles.modeButtonActive]}><Text style={[styles.modeText, props.takeaway === option.value && styles.modeTextActive]}>{option.label}</Text></Pressable>)}
          </View>
        </View>
        <View style={styles.lineList}>{props.lines.map((line) => {
          const variant = line.product.variants?.find((item) => item.id === line.variantId)?.name;
          return <View key={line.key} style={styles.lineItem}>
            {line.product.imageUrl ? <Image source={{ uri: line.product.imageUrl }} style={styles.productImage} /> : <View style={[styles.productImage, styles.imageFallback]}><ReceiptText size={18} color="#8191a3" /></View>}
            <View style={styles.lineDetails}>
              <Text numberOfLines={1} style={styles.productName}>{line.product.name}</Text><Text style={styles.productSku}>{variant ?? line.product.sku}</Text>
              <View style={styles.lineBottom}><View style={styles.quantityControl}><Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${line.product.name}`} onPress={() => props.onQuantity(line.key, -1)} style={styles.quantityButton}><Text style={styles.quantityButtonText}>−</Text></Pressable><Text style={styles.quantityValue}>{line.quantity}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${line.product.name}`} disabled={!props.canIncrease(line)} onPress={() => props.onQuantity(line.key, 1)} style={[styles.quantityButton, !props.canIncrease(line) && styles.disabled]}><Text style={styles.quantityButtonText}>+</Text></Pressable></View><Text style={styles.linePrice}>{money(props.priceFor(line) * line.quantity)}</Text></View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${line.product.name}`} hitSlop={6} onPress={() => props.onQuantity(line.key, -line.quantity)} style={styles.lineRemove}><Trash2 size={16} color="#8a97a8" /></Pressable>
          </View>;
        })}</View>
        <View style={styles.summaryCard}>
          <SummaryRow label="Subtotal" value={money(props.subtotal)} />
          <View style={styles.discountRow}><Text style={styles.summaryLabel}>Diskon</Text><TextInput accessibilityLabel="Diskon rupiah" keyboardType="numeric" value={props.discount} onChangeText={props.onDiscountChange} style={styles.discountInput} /></View>
          <View style={styles.summaryDivider} /><SummaryRow label="Total" value={money(props.total)} strong />
        </View>
        {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(props.bottomInset + 8, 12) }]}>
        <Pressable accessibilityRole="button" onPress={props.onClose} style={styles.secondaryButton}><Text style={styles.secondaryText}>Kembali</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={continueToPayment} disabled={!props.lines.length} style={[styles.primaryButton, !props.lines.length && styles.disabled]}><Text style={styles.primaryText}>Lanjut ke pembayaran</Text><ChevronRight size={18} color="#fff" /></Pressable>
      </View>
    </> : <>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentBody} keyboardShouldPersistTaps="handled">
        <View style={styles.summaryCard}><SummaryRow label="Total tagihan" value={money(props.total)} /><SummaryRow label="Diskon" value={`- ${money(props.discountAmount)}`} /><View style={styles.summaryDivider} /><SummaryRow label="Total pembayaran" value={money(props.total)} strong /></View>
        <Text style={styles.sectionLabel}>METODE PEMBAYARAN</Text>
        <View style={styles.methodGrid}>{methods.map(({ id, label, icon: Icon }) => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: props.method === id }} onPress={() => props.onMethodChange(id)} style={[styles.methodButton, props.method === id && styles.methodButtonActive]}><Icon size={20} color={props.method === id ? '#fff' : '#3976a8'} /><Text numberOfLines={1} style={[styles.methodLabel, props.method === id && styles.methodLabelActive]}>{label}</Text>{props.method === id ? <Check size={13} color="#fff" style={styles.methodCheck} /> : null}</Pressable>)}</View>
        <Text style={styles.sectionLabel}>JUMLAH DIBAYAR</Text>
        <View style={styles.amountField}><Text style={styles.currencyPrefix}>Rp</Text><Text style={styles.amountValue}>{money(props.total).replace('Rp ', '')}</Text></View>
        {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(props.bottomInset + 8, 12) }]}>
        <Pressable accessibilityRole="button" onPress={() => props.onPaymentStepChange(false)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Kembali</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!props.lines.length || props.submitting} onPress={props.onCheckout} style={[styles.primaryButton, (!props.lines.length || props.submitting) && styles.disabled]}>{props.submitting ? <ActivityIndicator color="#fff" /> : <><CreditCard size={17} color="#fff" /><Text style={styles.primaryText}>Bayar {money(props.total)}</Text></>}</Pressable>
      </View>
    </>}
  </View>;
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <View style={styles.summaryRow}><Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>{label}</Text><Text style={[styles.summaryValue, strong && styles.summaryTotal]}>{value}</Text></View>;
}

type ReceiptScreenProps = {
  order: ReceiptOrder;
  topInset: number;
  bottomInset: number;
  cashierName: string;
  printing: boolean;
  printError: string;
  printer: PairedPrinter | null;
  printerPickerVisible: boolean;
  printerDevices: PairedPrinter[];
  printerLoading: boolean;
  onPrint: () => void;
  onNewOrder: () => void;
  onChoosePrinter: (printer: PairedPrinter) => void;
  onClosePrinterPicker: () => void;
  onOpenBluetoothSettings: () => void;
};

export function PosReceiptScreen(props: ReceiptScreenProps) {
  const { isTablet } = useResponsive();
  const [shareError, setShareError] = useState('');
  const completedAt = props.order.completedAt ?? props.order.createdAt;
  const share = async () => {
    setShareError('');
    try { await Share.share({ message: `Nota ${props.order.orderNumber}\nTotal ${money(props.order.grandTotal)}\nTerima kasih telah berbelanja.` }); }
    catch { setShareError('Nota gagal dibagikan.'); }
  };

  return <View style={[styles.screen, { paddingTop: props.topInset, paddingBottom: props.bottomInset + 8 }]}>
    <View style={styles.receiptHeader}><Pressable accessibilityRole="button" accessibilityLabel="Kembali ke katalog" onPress={props.onNewOrder} style={styles.headerIcon}><ChevronLeft size={22} color="#172338" /></Pressable><Text style={styles.receiptHeaderTitle}>Nota pembayaran</Text><Pressable accessibilityRole="button" accessibilityLabel="Cetak nota" onPress={props.onPrint} style={styles.headerIcon}><Printer size={20} color="#216b67" /></Pressable></View>
    <View style={[styles.content, isTablet && styles.receiptSplit]}>
    <ScrollView style={styles.content} contentContainerStyle={[styles.receiptContent, isTablet && styles.receiptContentTablet]}>
      <View style={styles.successBanner}><CircleCheck size={25} color="#07885b" /><View style={styles.successTextWrap}><Text style={styles.successTitle}>Transaksi berhasil</Text><Text style={styles.successSubtitle}>Pesanan telah diselesaikan.</Text></View></View>
      <View style={styles.receiptCard}>
        <Text style={styles.receiptStore}>{props.order.branch?.name ?? 'Toko'}</Text>
        <Text style={styles.receiptMeta}>{props.order.orderNumber}  ·  {completedAt ? formatDate(completedAt) : ''}</Text>
        {props.order.customerName ? <Text style={styles.receiptMeta}>Pelanggan: {props.order.customerName}</Text> : null}
        <Text style={styles.receiptMeta}>Kasir: {props.cashierName}</Text>
        <View style={styles.receiptDivider} />
        {(props.order.items ?? []).map((item, index) => <View key={`${item.productNameSnapshot}-${index}`} style={styles.receiptLine}>
          <View style={styles.receiptRow}><Text style={styles.receiptItemName}>{item.productNameSnapshot}{item.variantNameSnapshot ? ` (${item.variantNameSnapshot})` : ''}</Text><Text style={styles.receiptItemAmount}>{money(item.totalPrice)}</Text></View>
          <Text style={styles.receiptMeta}>{Number(item.inputQuantity ?? item.quantity)} × {money(item.unitPrice)}{item.unit?.code ? ` ${item.unit.code}` : ''}</Text>
          {item.addons?.map((addon, addonIndex) => <Text key={`${addon.addonNameSnapshot}-${addonIndex}`} style={styles.receiptMeta}>+ {addon.addonNameSnapshot} × {addon.quantity} · {money(addon.totalPrice)}</Text>)}
        </View>)}
        <View style={styles.receiptDivider} />
        <SummaryRow label="Subtotal" value={money(props.order.subtotal)} />
        <SummaryRow label="Diskon" value={`- ${money(props.order.discountAmount)}`} />
        <View style={styles.summaryDivider} /><SummaryRow label="TOTAL" value={money(props.order.grandTotal)} strong />
        {(props.order.payments ?? []).map((payment, index) => <SummaryRow key={`${payment.method}-${index}`} label={`Pembayaran ${formatStatus(payment.method)}`} value={money(payment.amount)} />)}
        <View style={styles.thanks}><Text style={styles.thanksTitle}>Terima kasih</Text><Text style={styles.receiptMeta}>Semoga hari Anda menyenangkan</Text><Text selectable style={styles.orderCode}>{props.order.orderNumber}</Text></View>
      </View>
      {props.printError || shareError ? <Text style={styles.errorText}>{props.printError || shareError}</Text> : null}
      {!isTablet ? <View style={styles.receiptActions}>
        <Pressable accessibilityRole="button" onPress={props.onPrint} disabled={props.printing} style={styles.secondaryButton}>{props.printing ? <ActivityIndicator color="#087f5b" /> : <><Printer size={17} color="#087f5b" /><Text style={styles.secondaryText}>Cetak ulang</Text></>}</Pressable>
        <Pressable accessibilityRole="button" onPress={() => void share()} style={styles.primaryButton}><Share2 size={17} color="#fff" /><Text style={styles.primaryText}>Bagikan</Text></Pressable>
      </View> : null}
      {props.printerPickerVisible ? <Modal transparent animationType="slide" visible onRequestClose={props.onClosePrinterPicker}>
        <View style={styles.modalBackdrop}><View style={[styles.printerModal, { paddingBottom: Math.max(props.bottomInset + 8, 28) }]}>
          <View style={styles.printerModalHeader}><Text style={styles.printerModalTitle}>Pilih printer Bluetooth</Text><Pressable accessibilityRole="button" onPress={props.onClosePrinterPicker}><X size={20} color="#526276" /></Pressable></View>
          {props.printerLoading ? <ActivityIndicator style={styles.printerLoading} color="#07885b" /> : null}
          {!props.printerLoading && !props.printerDevices.length ? <Text style={styles.printerEmpty}>Tidak ada printer yang dipasangkan.</Text> : null}
          {props.printerDevices.map((device) => <Pressable key={device.address} accessibilityRole="button" onPress={() => props.onChoosePrinter(device)} style={styles.printerRow}><Printer size={18} color="#087f5b" /><View style={styles.printerDetails}><Text style={styles.printerName}>{device.name}</Text><Text style={styles.receiptMeta}>{device.address}</Text></View><ChevronRight size={17} color="#7b8ba0" /></Pressable>)}
          <Pressable accessibilityRole="button" onPress={props.onOpenBluetoothSettings} style={styles.settingsButton}><Text style={styles.settingsText}>Pengaturan Bluetooth</Text></Pressable>
        </View></View>
      </Modal> : null}
    </ScrollView>
    {isTablet ? <View style={styles.receiptSideActions}>
      <Pressable accessibilityRole="button" onPress={props.onPrint} disabled={props.printing} style={[styles.secondaryButton, styles.sideActionButton]}>{props.printing ? <ActivityIndicator color="#087f5b" /> : <><Printer size={18} color="#087f5b" /><Text style={styles.secondaryText}>Cetak ulang</Text></>}</Pressable>
      <Pressable accessibilityRole="button" onPress={() => void share()} style={[styles.primaryButton, styles.sideActionButton]}><Share2 size={18} color="#fff" /><Text style={styles.primaryText}>Bagikan</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={props.onNewOrder} style={[styles.newOrderButton, styles.sideActionButton]}><CircleCheck size={18} color="#07885b" /><Text style={styles.newOrderText}>Transaksi baru</Text></Pressable>
    </View> : null}
    </View>
    {!isTablet ? <Pressable accessibilityRole="button" onPress={props.onNewOrder} style={styles.newOrderButton}><CircleCheck size={17} color="#07885b" /><Text style={styles.newOrderText}>Transaksi baru</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f9fb' },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, backgroundColor: '#fff' },
  headerIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f4f7fa' },
  headerTitle: { flex: 1, color: '#14213a', fontSize: 16, fontWeight: '900' },
  headerAction: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff0ef' },
  steps: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff' },
  step: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 20, backgroundColor: '#e6f6f0' },
  stepActive: { backgroundColor: '#07956f' }, stepNumber: { width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#cceee1' }, stepNumberActive: { backgroundColor: '#fff' },
  stepNumberText: { color: '#07885b', fontSize: 10, fontWeight: '900' }, stepNumberTextActive: { color: '#07885b' }, stepLabel: { color: '#44615d', fontSize: 10, fontWeight: '800' }, stepLabelActive: { color: '#fff' },
  content: { flex: 1 }, contentBody: { padding: 13, paddingBottom: 20, gap: 11 },
  customerCard: { padding: 12, borderRadius: 13, backgroundColor: '#fff' }, fieldLabel: { color: '#76879b', fontSize: 9, fontWeight: '900' }, customerInput: { height: 38, color: '#172338', fontSize: 13, fontWeight: '700' },
  serviceModes: { flexDirection: 'row', alignSelf: 'flex-start', gap: 7, marginTop: 6 }, modeButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#edf2f5' }, modeButtonActive: { backgroundColor: '#07956f' }, modeText: { color: '#597086', fontSize: 10, fontWeight: '800' }, modeTextActive: { color: '#fff' },
  lineList: { overflow: 'hidden', borderRadius: 13, backgroundColor: '#fff' }, lineItem: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: '#eef2f5' },
  productImage: { width: 54, height: 60, borderRadius: 9, backgroundColor: '#eff3f6' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, lineDetails: { flex: 1, minWidth: 0 }, productName: { color: '#172338', fontSize: 11, fontWeight: '900' }, productSku: { marginTop: 3, color: '#74869d', fontSize: 9 },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }, quantityControl: { flexDirection: 'row', alignItems: 'center', gap: 9 }, quantityButton: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e2f6ef' }, quantityButtonText: { color: '#07885b', fontSize: 17, fontWeight: '700', lineHeight: 20 }, quantityValue: { minWidth: 14, color: '#27364d', fontSize: 11, fontWeight: '800', textAlign: 'center' }, linePrice: { color: '#d72f2a', fontSize: 10, fontWeight: '900' },
  summaryCard: { padding: 13, borderRadius: 13, backgroundColor: '#fff' }, summaryRow: { minHeight: 29, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, summaryLabel: { color: '#72849a', fontSize: 10 }, summaryValue: { color: '#172338', fontSize: 10, fontWeight: '700' }, summaryStrong: { color: '#214b4a', fontSize: 12, fontWeight: '900' }, summaryTotal: { color: '#07956f', fontSize: 14, fontWeight: '900' }, summaryDivider: { height: 1, marginVertical: 5, backgroundColor: '#edf1f4' }, discountRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, discountInput: { width: 100, height: 30, paddingHorizontal: 8, borderWidth: 1, borderColor: '#e4eaee', borderRadius: 8, color: '#172338', fontSize: 10, textAlign: 'right' },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 13, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e8edf0', backgroundColor: '#fff' }, secondaryButton: { minHeight: 46, minWidth: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e1e9ee', borderRadius: 11, backgroundColor: '#fff' }, secondaryText: { color: '#53677e', fontSize: 11, fontWeight: '800' }, primaryButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#07956f' }, primaryText: { color: '#fff', fontSize: 11, fontWeight: '900' }, disabled: { opacity: 0.55 }, errorText: { padding: 10, borderRadius: 9, overflow: 'hidden', color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10, lineHeight: 15 },
  sectionLabel: { marginTop: 4, color: '#71839a', fontSize: 9, fontWeight: '900' }, methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, methodButton: { position: 'relative', width: '23.5%', minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#e7edf1', borderRadius: 11, backgroundColor: '#fff' }, methodButtonActive: { borderColor: '#07885b', backgroundColor: '#07885b' }, methodLabel: { maxWidth: '100%', color: '#63778e', fontSize: 8, fontWeight: '700' }, methodLabelActive: { color: '#fff' }, methodCheck: { position: 'absolute', top: 5, right: 5 },
  amountField: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 10, backgroundColor: '#fff' }, currencyPrefix: { color: '#78899c', fontSize: 10 }, amountValue: { color: '#172338', fontSize: 12, fontWeight: '800' }, receivedInput: { flex: 1, height: 40, color: '#172338', fontSize: 12, fontWeight: '700' }, changeCard: { padding: 13, borderRadius: 12, backgroundColor: '#e5f8f0' }, changeLabel: { color: '#57736b', fontSize: 10 }, changeValue: { marginTop: 3, color: '#07885b', fontSize: 16, fontWeight: '900' },
  receiptHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, backgroundColor: '#fff' }, receiptHeaderTitle: { flex: 1, color: '#14213a', fontSize: 15, fontWeight: '900' }, receiptContent: { padding: 13, paddingBottom: 14, gap: 9 }, successBanner: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, backgroundColor: '#dff7ee' }, successTextWrap: { flex: 1 }, successTitle: { color: '#087c53', fontSize: 11, fontWeight: '900' }, successSubtitle: { marginTop: 3, color: '#588477', fontSize: 9 },
  receiptCard: { padding: 14, borderRadius: 13, backgroundColor: '#fff' }, receiptStore: { color: '#172338', fontSize: 13, fontWeight: '900', textAlign: 'center' }, receiptMeta: { marginTop: 4, color: '#74859b', fontSize: 9, lineHeight: 14 }, receiptDivider: { height: 1, marginVertical: 9, borderTopWidth: 1, borderColor: '#dce5eb', borderStyle: 'dashed' }, receiptLine: { paddingVertical: 6 }, receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 }, receiptItemName: { flex: 1, color: '#24344a', fontSize: 10, fontWeight: '800' }, receiptItemAmount: { color: '#172338', fontSize: 10, fontWeight: '800' },
  thanks: { alignItems: 'center', marginTop: 12 }, thanksTitle: { color: '#456178', fontSize: 10, fontWeight: '800' }, orderCode: { marginTop: 12, color: '#3c4a5e', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, receiptActions: { flexDirection: 'row', gap: 8, marginBottom: 2 }, newOrderButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginHorizontal: 13, marginBottom: 8, borderRadius: 11, backgroundColor: '#e1f7ee' }, newOrderText: { color: '#087c53', fontSize: 10, fontWeight: '900' },
  lineRemove: { alignSelf: 'flex-start', padding: 4 },
  receiptSplit: { flexDirection: 'row' }, receiptContentTablet: { padding: 18, gap: 12 },
  receiptSideActions: { width: 230, gap: 12, paddingTop: 18, paddingRight: 18 }, sideActionButton: { flex: 0, minHeight: 56, marginHorizontal: 0, marginBottom: 0, justifyContent: 'flex-start', paddingHorizontal: 16 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, printerModal: { paddingHorizontal: 17, paddingTop: 17, paddingBottom: 28, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#fff' }, printerModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, printerModalTitle: { color: '#172338', fontSize: 15, fontWeight: '900' }, printerLoading: { padding: 18 }, printerEmpty: { paddingVertical: 16, color: '#75869a', fontSize: 11, textAlign: 'center' }, printerRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#edf1f4' }, printerDetails: { flex: 1 }, printerName: { color: '#27374d', fontSize: 11, fontWeight: '800' }, settingsButton: { alignItems: 'center', marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: '#eef7f3' }, settingsText: { color: '#087c53', fontSize: 10, fontWeight: '800' },
});