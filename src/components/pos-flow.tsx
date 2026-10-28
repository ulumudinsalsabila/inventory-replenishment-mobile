import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MoneyInput } from './money-input';
import { Banknote, Barcode, Camera, Gift, Check, ChefHat, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, CreditCard, Landmark, Merge, Minus, Plus, Printer, QrCode, ReceiptText, Save, Search, Share2, ShoppingCart, Split, Store, Trash2, UserRound, Users, Wallet, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../lib/responsive';
import { AppShellHeader } from './app-shell-header';
import { BarcodeScanner } from './barcode-scanner';
import { LoadMoreFooter } from './load-more-footer';
import { customerHint, type PosCustomer } from '../lib/customers';
import { customerLabel, formatAge, formatReceiptDateTime, formatServiceType, formatStatus, openBillStockActions, type OpenBillStockAction, type ServiceType } from '../lib/display';
import { useDebouncedValue, useInfiniteList } from '../lib/infinite-list';
import { scanBlePrinters, stopBleScan, type BlePrinter } from '../lib/ble-printer';
import type { PairedPrinter, ReceiptOrder, Station } from '../lib/receipt-printer';
import { shareReceiptPdf } from '../lib/receipt-pdf';
import { KeyboardAvoidingView, KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';

/** KASBON hands the goods out on credit to a named customer: settled, but no money comes in. */
export type PosMethod = 'CASH' | 'QRIS' | 'TRANSFER' | 'GRAB' | 'GOBIZ' | 'KASBON';

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
  category?: { name: string; station?: Station } | null;
  distributor?: { id: string; name: string } | null;
  unit?: { id: string; code: string; name: string } | null;
  sellingUnits: { unitId: string; conversionFactor: string; sellingPrice: string; unit: { id: string; code: string; name: string } }[];
  variants?: { id: string; name: string; priceDelta: string }[];
  addons?: { id: string; name: string; basePrice: string }[];
};

/** An open bill line as stored on the server, kept on the cart line it was loaded into. */
export type PosBillLine = {
  orderItemId: string;
  /** Quantity (selling unit), note and add-ons as stored; sent back unchanged so the server keeps the line as is. */
  quantity: number;
  note: string | null;
  addons: { addonId: string; quantity: string }[];
  /** Stored line total, which stays the line's price while it is unchanged. */
  total: number;
  variantName: string | null;
  /** Set once the line was sent to the kitchen; it is then locked and can only be voided. */
  sentAt: string | null;
  /** The product left this warehouse's catalog: the line is read-only and can only be removed while unsent. */
  missing: boolean;
};

/** Where a sale is taken from: the shelf (display) or the back room (rest of the warehouse stock). */
export type PosStockSource = 'DISPLAY' | 'WAREHOUSE';

/** Stock a product has in one source: the display count, or what the warehouse holds beside it. */
export const sourceStock = (product: Pick<PosProduct, 'available' | 'displayQuantity'>, source: PosStockSource) => {
  const display = Math.max(Number(product.displayQuantity ?? 0) || 0, 0);
  return source === 'DISPLAY' ? display : Math.max((Number(product.available) || 0) - display, 0);
};

export type PosLine = {
  key: string;
  product: PosProduct;
  unitId: string;
  quantity: number;
  variantId: string;
  addonIds: string[];
  /** A free item given with the sale: priced at Rp 0 but still taken from stock. */
  isBonus?: boolean;
  /** Display or back room; lines of older bills may not say. */
  stockSource?: PosStockSource;
  /** Present on lines loaded from a saved open bill. */
  bill?: PosBillLine;
};

/** Sent and off-catalog bill lines keep their quantity; only new or unsent catalog lines can change. */
export const isLineEditable = (line: PosLine) => !line.bill?.sentAt && !line.bill?.missing;
const lineSubtitle = (line: PosLine) => line.bill?.variantName ?? line.product.variants?.find((item) => item.id === line.variantId)?.name ?? (line.product.sku || '-');

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
  onUnitChange: (key: string, unitId: string) => void;
  onToggleBonus: (key: string) => void;
  canIncrease: (line: PosLine) => boolean;
  onCheckout: () => void;
  /** Optional proof photos (local URIs) sent with the payment. */
  paymentPhotos: string[];
  onTakePaymentPhoto: () => void;
  onRemovePaymentPhoto: (index: number) => void;
  onClear: () => void;
  onClose: () => void;
  submitting: boolean;
  error: string;
  onError: (value: string) => void;
  takeaway: boolean;
  onTakeawayChange: (value: boolean) => void;
  bottomInset: number;
  /** The open bill currently loaded in the cart, if any. */
  openBill: OpenBillInfo | null;
  /** True when the cart differs from the last saved version of the loaded bill. */
  openBillDirty: boolean;
  billBusy: boolean;
  /** Opens the name/phone sheet to save the cart as a new open bill or save changes to the loaded one. */
  onSaveOpenBill: () => void;
  /** Omitted when the user may not cancel orders. */
  onCancelOpenBill?: () => void;
  /** Registered customer attached to this sale; null means Guest (the typed name is used as is). */
  selectedCustomer: PosCustomer | null;
  /** Opens the customer picker; omitted when the user may not read customers. */
  onPickCustomer?: () => void;
  /** Detaches the selected customer, turning the sale back into a Guest sale. */
  onRemoveCustomer: () => void;
  /** Success message, e.g. after lines were sent to the kitchen or voided. */
  notice: string;
  /** Non-blocking warning, e.g. stock shortages reported when the bill was saved. */
  warning: string;
  /** Saves the loaded bill if needed, then sends its unsent lines to the kitchen; omitted without a loaded bill. */
  onSendToKitchen?: () => void;
  /** Opens the void sheet for a sent line; omitted when the user lacks order.void_item. */
  onVoidLine?: (line: PosLine) => void;
  /** Saves the loaded bill if needed and prints its pre-bill (tagihan); omitted without a loaded bill. */
  onPrintPreBill?: () => void;
  /** Opens the payment step in DP mode for the loaded bill; omitted without a loaded bill or payment.create. */
  onStartDeposit?: () => void;
  /** The payment step takes a deposit (DP) on the loaded bill instead of paying it off. */
  depositMode: boolean;
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  /** Records the deposit entered in DP mode. */
  onReceiveDeposit: () => void;
  /** "Bagi rata": one payment method per person, each paying an equal share of the balance; null pays with `method` alone. */
  splitMethods: PosMethod[] | null;
  onSplitMethodsChange: (value: PosMethod[] | null) => void;
  /** "Bayar campuran": non-cash parts with typed amounts; whatever they leave of the balance is paid in cash. null = off. */
  mixedPayments: MixedPart[] | null;
  onMixedPaymentsChange: (value: MixedPart[] | null) => void;
  /** "Cetak tiket bar/dapur setelah bayar" for quick sales; the switch is omitted while an open bill is loaded. */
  quickSaleTickets: boolean;
  onQuickSaleTicketsChange?: (value: boolean) => void;
  /** Opens the per-device printer settings (receipt, bar and kitchen printers). */
  onOpenPrintSettings?: () => void;
  /** Saves the loaded bill if needed and opens the split sheet; omitted without a loaded bill. */
  onSplitBill?: () => void;
  /** Saves the loaded bill if needed and picks another open bill to merge into it; omitted without a loaded bill. */
  onMergeBill?: () => void;
  /** Follow-up shown next to the notice, e.g. "Buka bill baru" after a split. */
  noticeAction?: { label: string; onPress: () => void } | null;
  /** Cash handed over for a single cash payment (plain digits); empty means the exact amount ("uang pas"). */
  cashReceived: string;
  onCashReceivedChange: (value: string) => void;
};

/** Equal shares of `total` for `count` people in whole rupiah; the last share takes the rounding remainder. */
export function equalShares(total: number, count: number) {
  const share = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? Math.round((total - share * (count - 1)) * 100) / 100 : share);
}
const MAX_SPLIT_PEOPLE = 20;
/** Non-cash parts a mixed payment can have next to its cash remainder. */
const MAX_MIXED_PARTS = 4;
export type MixedPart = { method: PosMethod; amount: string };

/** Notes a customer is likely to hand over for `due`: the next round amounts above it, smallest first. */
export function quickCashAmounts(due: number) {
  const amounts = new Set<number>();
  for (const step of [5000, 10000, 20000, 50000, 100000]) {
    const next = Math.ceil(due / step) * step;
    if (next > due) amounts.add(next);
  }
  return [...amounts].sort((a, b) => a - b).slice(0, 4);
}

/** A sent line (or part of it) taken off an open bill, from GET /orders/:id itemVoids. */
export type OpenBillVoid = { id: string; productNameSnapshot: string; variantNameSnapshot: string | null; quantity: string; amount: string; reason: string; createdAt: string };
/** `paidTotal` is the deposit (DP) already taken on the bill; the rest is due when it is paid. */
export type OpenBillInfo = { id: string; orderNumber: string; customerName: string; customerPhone: string; itemVoids?: OpenBillVoid[]; paidTotal?: number };
/** `payments` are the completed payments (deposits) on the bill. */
export type OpenBillRow = { id: string; orderNumber: string; customerName: string | null; customerPhone: string | null; grandTotal: string; createdAt: string; serviceType?: ServiceType | null; branch?: { name: string } | null; _count?: { items: number }; payments?: { amount: string }[] };

const money = (value: string | number) => `Rp ${Math.max(0, Number(value) || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const methods: { id: PosMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'CASH', label: 'Cash', icon: Banknote },
  { id: 'QRIS', label: 'QRIS', icon: QrCode },
  { id: 'TRANSFER', label: 'Transfer', icon: Landmark },
  { id: 'GRAB', label: 'Grab', icon: Wallet },
  { id: 'GOBIZ', label: 'GoBiz', icon: Wallet },
  { id: 'KASBON', label: 'Kasbon', icon: ReceiptText },
];

type CatalogProps = {
  branches: { id: string; name: string }[];
  warehouses: { id: string; name: string; branchId: string | null }[];
  branchId: string;
  warehouseId: string;
  userBranchId: string | null;
  products: PosProduct[];
  distributors: string[];
  selectedDistributor: string;
  stockSource: PosStockSource;
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
  onDistributorChange: (name: string) => void;
  onStockSourceChange: (value: PosStockSource) => void;
  onSearchChange: (value: string) => void;
  onAdd: (product: PosProduct) => void;
  onQuantity: (key: string, delta: number) => void;
  canAdd: (product: PosProduct, unitId?: string, source?: PosStockSource) => boolean;
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
  /** Success message, e.g. after an open bill was saved. */
  notice: string;
  /** "Open Bill <nomor> · <pelanggan>" while a saved bill is loaded in the cart. */
  openBillLabel: string | null;
  /** Opens the open bill list; omitted when the user may not read orders. */
  onOpenBills?: () => void;
  /** Unpaid open bills in the user's scope, shown as a badge on the Open Bill button. */
  openBillCount: number;
  /** Non-blocking warning, e.g. stock shortages reported when an open bill was saved. */
  warning: string;
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
      // The card's minus button works on the latest line that may still change, not on a sent bill line.
      byProduct.set(line.product.id, { quantity: (current?.quantity ?? 0) + line.quantity, line: current && !isLineEditable(line) ? current.line : line });
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
  const searchBox = <View style={[styles.catalogSearchBox, isTablet && styles.tabletSearchBox]}><Search size={17} color="#78889c" /><TextInput accessibilityLabel="Cari produk" value={props.search} onChangeText={props.onSearchChange} placeholder="Cari menu atau SKU..." placeholderTextColor="#8290a2" returnKeyType="search" style={styles.catalogSearchInput} />{props.search ? <Pressable accessibilityRole="button" accessibilityLabel="Hapus pencarian" hitSlop={10} onPress={() => props.onSearchChange('')}><X size={17} color="#78889c" /></Pressable> : null}</View>;
  const scanButton = <Pressable accessibilityRole="button" accessibilityLabel="Scan barcode" onPress={() => setScannerVisible(true)} style={[styles.catalogScanButton, isTablet && styles.tabletScanButton]}><Barcode size={21} color="#fff" /></Pressable>;
  // Card width follows the measured grid width so every column count fills the row evenly.
  const gridColumns = isTablet ? columns(gridWidth, 175, 6) : 2;
  const cardWidth = isTablet && gridWidth ? (gridWidth - GRID_GAP * (gridColumns - 1)) / gridColumns : undefined;

  const filters = <>
    {!props.userBranchId && props.branches.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchChoices}>{props.branches.map((branch) => <Pressable key={branch.id} onPress={() => props.onBranchChange(branch.id)} style={[styles.branchChip, props.branchId === branch.id && styles.branchChipActive]}><Text numberOfLines={1} style={[styles.branchChipText, props.branchId === branch.id && styles.branchChipTextActive]}>{branch.name}</Text></Pressable>)}</ScrollView> : null}
    {props.warehouses.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchChoices}>{props.warehouses.filter((warehouse) => warehouse.branchId === props.branchId).map((warehouse) => <Pressable key={warehouse.id} onPress={() => props.onWarehouseChange(warehouse.id)} style={[styles.warehouseChip, props.warehouseId === warehouse.id && styles.warehouseChipActive]}><Text style={[styles.branchChipText, props.warehouseId === warehouse.id && styles.warehouseChipTextActive]}>{warehouse.name}</Text></Pressable>)}</ScrollView> : null}
    {!isTablet ? <View style={styles.catalogSearchRow}>{searchBox}{scanButton}</View> : null}
    {/* The source decides where added items are taken from: the shelf or the back room. */}
    <View style={styles.catalogFilterRow}><Pressable accessibilityRole="button" accessibilityState={{ selected: props.stockSource === 'DISPLAY' }} onPress={() => props.onStockSourceChange('DISPLAY')} style={[styles.catalogFilter, props.stockSource === 'DISPLAY' && styles.catalogFilterActive]}><Store size={14} color={props.stockSource === 'DISPLAY' ? '#fff' : '#60758a'} /><Text style={[styles.catalogFilterText, props.stockSource === 'DISPLAY' && styles.catalogFilterTextActive]}>Display</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ selected: props.stockSource === 'WAREHOUSE' }} onPress={() => props.onStockSourceChange('WAREHOUSE')} style={[styles.catalogFilter, props.stockSource === 'WAREHOUSE' && styles.catalogFilterActive]}><Text style={[styles.catalogFilterText, props.stockSource === 'WAREHOUSE' && styles.catalogFilterTextActive]}>Gudang</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChoices}>{props.distributors.map((distributor) => <Pressable key={distributor} onPress={() => props.onDistributorChange(distributor)} style={[styles.catalogCategory, props.selectedDistributor === distributor && styles.catalogCategoryActive]}><Text style={[styles.catalogCategoryText, props.selectedDistributor === distributor && styles.catalogCategoryTextActive]}>{distributor}</Text></Pressable>)}</ScrollView>
    {props.loading ? <View style={styles.loadingRow}><ActivityIndicator color="#07885b" /><Text style={styles.loadingText}>Memuat produk...</Text></View> : null}
    {props.error ? <Text style={[styles.errorText, styles.catalogError]}>{props.error}</Text> : null}
    {props.notice ? <Text style={[styles.noticeText, styles.catalogError]}>{props.notice}</Text> : null}
    {props.warning ? <Text style={[styles.warningText, styles.catalogError]}>{props.warning}</Text> : null}
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
      const addable = props.canAdd(product, selectedLine?.unitId);
      return <Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${product.name}, ${money(price)}${selected ? `, ${selected} di pesanan` : ''}`} accessibilityState={{ disabled: !addable }} disabled={!addable} onPress={() => props.onAdd(product)} style={({ pressed }) => [styles.catalogProductCard, cardWidth ? { width: cardWidth } : null, pressed && styles.cardPressed, !addable && !selected && styles.cardUnavailable]}>
        {product.imageUrl ? <Image source={{ uri: product.imageUrl }} style={styles.catalogProductImage} resizeMode="cover" /> : <View style={[styles.catalogProductImage, styles.catalogImageFallback]}><ReceiptText size={28} color="#8191a3" /></View>}
        <Text numberOfLines={isTablet ? 2 : 1} style={styles.catalogProductName}>{product.name}</Text><Text style={styles.catalogProductCategory}>{product.distributor?.name ?? 'Produk'}</Text><Text style={styles.catalogProductStock}>{`${props.stockSource === 'DISPLAY' ? 'Display' : 'Gudang'} ${sourceStock(product, props.stockSource).toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${product.unit?.code ?? ''}`}</Text>
        <View style={styles.catalogCardFooter}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.catalogProductPrice}>{money(price)}</Text>{selected && selectedLine ? <View style={styles.catalogQuantity}><Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${product.name}`} disabled={!isLineEditable(selectedLine)} onPress={() => props.onQuantity(selectedLine.key, -1)} style={[styles.catalogQtyButton, !isLineEditable(selectedLine) && styles.disabled]}><Minus size={15} color="#07885b" /></Pressable><Text style={styles.catalogQtyValue}>{selected}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${product.name}`} disabled={!props.canAdd(product, selectedLine.unitId)} onPress={() => props.onAdd(product)} style={[styles.catalogQtyButtonActive, !props.canAdd(product, selectedLine.unitId) && styles.disabled]}><Plus size={17} color="#fff" /></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${product.name}`} disabled={!props.canAdd(product)} onPress={() => props.onAdd(product)} style={[styles.catalogAddButton, !props.canAdd(product) && styles.disabled]}><Plus size={19} color="#fff" /></Pressable>}</View>
      </Pressable>;
    }}
  />;

  const cartButton = <Pressable accessibilityRole="button" disabled={!props.cart.length} onPress={props.onOpenCart} style={[styles.catalogCartBar, isTablet ? styles.tabletCartBar : styles.phoneCartBar, !props.cart.length && styles.disabled]}>
    <ShoppingCart size={19} color="#fff" /><View style={styles.cartBarText}><Text style={styles.catalogCartLabel}>Pesanan ({totalItems})</Text>{isTablet ? <Text style={styles.catalogCartTotal}>{money(props.total)}</Text> : null}</View>{!isTablet ? <Text style={styles.catalogCartTotal}>{money(props.total)}</Text> : null}<ChevronRight size={18} color="#fff" />
  </Pressable>;
  const billButton = props.onOpenBills ? <Pressable accessibilityRole="button" accessibilityLabel={`Daftar open bill${props.openBillCount ? `, ${props.openBillCount} belum dibayar` : ''}`} onPress={props.onOpenBills} style={isTablet ? styles.cartPanelClear : styles.catalogBillButton}><ClipboardList size={isTablet ? 17 : 20} color="#07885b" />{props.openBillCount ? <View style={styles.billCountBadge}><Text style={styles.billCountText}>{props.openBillCount > 99 ? '99+' : props.openBillCount}</Text></View> : null}</Pressable> : null;
  const billBanner = props.openBillLabel ? <Pressable accessibilityRole="button" onPress={props.onOpenCart} style={[styles.billBanner, !isTablet && styles.phoneBillBanner]}><ReceiptText size={15} color="#8a5a08" /><Text numberOfLines={1} style={styles.billBannerText}>{props.openBillLabel}</Text></Pressable> : null;

  if (isTablet) return <View style={[styles.screen, styles.tabletScreen]}>
    <View style={styles.tabletCatalog}>
      <AppShellHeader compact leading={searchBox} trailing={scanButton} />
      {grid}
    </View>
    <View style={[styles.cartPanel, { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.cartPanelHeader}><Text style={styles.cartPanelTitle}>Pesanan ({totalItems})</Text><View style={styles.cartPanelActions}>{billButton}<Pressable accessibilityRole="button" accessibilityLabel="Kosongkan pesanan" disabled={!props.cart.length} onPress={props.onClear} style={[styles.cartPanelClear, !props.cart.length && styles.disabled]}><Trash2 size={17} color="#8a97a8" /></Pressable></View></View>
      {billBanner}
      {props.cart.length ? <ScrollView style={styles.content} contentContainerStyle={styles.cartPanelList}>{props.cart.map((line) => {
        const canIncrease = props.canAdd(line.product, line.unitId, line.stockSource);
        return <View key={line.key} style={styles.cartPanelLine}>
          <View style={styles.cartPanelLineText}><Text numberOfLines={2} style={styles.cartPanelName}>{line.product.name}</Text><Text numberOfLines={1} style={styles.catalogProductCategory}>{lineSubtitle(line)}</Text><LineBadges line={line} /><Text style={styles.cartPanelPrice}>{money(props.priceFor(line) * line.quantity)}</Text></View>
          {isLineEditable(line) ? <View style={styles.catalogQuantity}><Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${line.product.name}`} onPress={() => props.onQuantity(line.key, -1)} style={styles.catalogQtyButton}><Minus size={15} color="#07885b" /></Pressable><Text style={styles.catalogQtyValue}>{line.quantity}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${line.product.name}`} disabled={!canIncrease} onPress={() => props.onQuantity(line.key, 1)} style={[styles.catalogQtyButtonActive, !canIncrease && styles.disabled]}><Plus size={17} color="#fff" /></Pressable></View>
            : <View style={styles.catalogQuantity}><Text style={styles.catalogQtyValue}>×{line.quantity}</Text>{!line.bill?.sentAt ? <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${line.product.name}`} hitSlop={6} onPress={() => props.onQuantity(line.key, -line.quantity)} style={styles.catalogQtyButton}><Trash2 size={14} color="#8a97a8" /></Pressable> : null}</View>}
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
    {billBanner}
    <View style={styles.catalogFooter}>{billButton}{cartButton}</View>
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
  cartBarText: { flex: 1, justifyContent: 'center' },
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
  cartPanelEmptyTitle: { color: '#5f7186', fontSize: 12, fontWeight: '800' },
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
  cardPressed: { opacity: 0.7 },
  cardUnavailable: { opacity: 0.55 },
  catalogProductImage: { width: '100%', height: 104, backgroundColor: '#edf2f4' },
  catalogImageFallback: { alignItems: 'center', justifyContent: 'center' },
  catalogProductName: { marginTop: 8, paddingHorizontal: 9, color: '#172338', fontSize: 10, fontWeight: '900' },
  catalogProductCategory: { marginTop: 4, paddingHorizontal: 9, color: '#71839a', fontSize: 9 },
  catalogProductStock: { marginTop: 5, paddingHorizontal: 9, color: '#71839a', fontSize: 9 },
  catalogCardFooter: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 3, marginTop: 7, paddingHorizontal: 8 },
  catalogProductPrice: { flex: 1, color: '#172338', fontSize: 10, fontWeight: '900' },
  catalogQuantity: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  catalogQtyButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#e3f6ee' },
  catalogQtyButtonActive: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#07956f' },
  catalogQtyValue: { minWidth: 13, color: '#293a4d', fontSize: 9, fontWeight: '900', textAlign: 'center' },
  catalogAddButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#07956f' },
  catalogEmpty: { paddingVertical: 18, color: '#75869a', fontSize: 11, textAlign: 'center' },
  catalogCartBar: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 13, marginTop: 5, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#008c63' },
  catalogFooter: { flexDirection: 'row', gap: 8, marginHorizontal: 13, marginTop: 5, marginBottom: 4 },
  phoneCartBar: { flex: 1, marginHorizontal: 0, marginTop: 0 },
  catalogBillButton: { width: 49, minHeight: 49, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cfeadf', borderRadius: 12, backgroundColor: '#fff' },
  cartPanelActions: { flexDirection: 'row', gap: 6 },
  billBanner: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8, paddingHorizontal: 11, borderWidth: 1, borderColor: '#f6d79b', borderRadius: 10, backgroundColor: '#fff8e8' },
  phoneBillBanner: { marginHorizontal: 13, marginTop: 5, marginBottom: 0 },
  billBannerText: { flex: 1, color: '#8a5a08', fontSize: 11, fontWeight: '800' },
  noticeText: { padding: 10, borderRadius: 9, color: '#087c53', backgroundColor: '#e5f8f0', fontSize: 10 },
  warningText: { padding: 10, borderRadius: 9, overflow: 'hidden', color: '#8a5a08', backgroundColor: '#fff8e8', fontSize: 10, lineHeight: 15 },
  billCountBadge: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: 9, backgroundColor: '#d92d2d' },
  billCountText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  // Same size and line height so the label and total share one baseline in the cart bar.
  catalogCartLabel: { color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '900' },
  catalogCartTotal: { color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '900' },
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
  const unsentCount = props.lines.filter((line) => !line.bill?.sentAt).length;
  // A deposit already taken on the loaded bill: "Bayar" settles only what is left.
  const paid = props.openBill?.paidTotal ?? 0;
  const due = Math.max(0, props.total - paid);
  // Every share must be at least Rp 1; a balance that shrank below the number of people pays in one go.
  const splitMethods = props.splitMethods && due >= props.splitMethods.length ? props.splitMethods : null;
  const maxPeople = Math.min(MAX_SPLIT_PEOPLE, Math.floor(due));
  // Mixed payment: the typed non-cash parts come first, the rest of the balance is paid in cash.
  const mixed = !props.depositMode && !splitMethods && props.mixedPayments ? props.mixedPayments : null;
  const mixedNonCash = (mixed ?? []).reduce((sum, part) => sum + (Number(part.amount) || 0), 0);
  const mixedOver = Boolean(mixed) && mixedNonCash > due;
  const mixedInvalid = Boolean(mixed) && (mixedOver || (mixed ?? []).some((part) => !(Number(part.amount) > 0)));
  // The cash part: the whole balance for a single cash payment, the remainder for a mixed one.
  const cashDue = mixed ? Math.max(0, due - mixedNonCash) : due;
  // "Bagi rata" and DP pay exact amounts; only a single cash payment or a mixed payment's cash part take money received.
  const takesCash = !props.depositMode && !splitMethods && (Boolean(mixed) || props.method === 'CASH');
  const received = takesCash && props.cashReceived ? Number(props.cashReceived) : cashDue;
  const cashShort = Math.max(0, cashDue - received);
  const cashChange = Math.max(0, received - cashDue);
  const nonCashMethods = methods.filter((entry) => entry.id !== 'CASH');
  const cashInput = <>
    <Text style={styles.sectionLabel}>UANG DITERIMA</Text>
    <View style={styles.amountField}><Text style={styles.currencyPrefix}>Rp</Text><MoneyInput accessibilityLabel="Uang diterima" value={props.cashReceived} onChangeText={props.onCashReceivedChange} placeholder={`${Math.ceil(cashDue)}`} placeholderTextColor="#8a97a8" style={styles.receivedInput} />{props.cashReceived ? <Pressable accessibilityRole="button" accessibilityLabel="Kosongkan uang diterima" hitSlop={8} onPress={() => props.onCashReceivedChange('')}><X size={17} color="#8a97a8" /></Pressable> : null}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.cashChoices}>
      {[{ label: 'Uang pas', value: '' }, ...quickCashAmounts(cashDue).map((amount) => ({ label: money(amount), value: String(amount) }))].map((option) => {
        const active = props.cashReceived === option.value;
        return <Pressable key={option.label} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => props.onCashReceivedChange(option.value)} style={[styles.cashChip, active && styles.modeButtonActive]}><Text style={[styles.modeText, active && styles.modeTextActive]}>{option.label}</Text></Pressable>;
      })}
    </ScrollView>
    {cashShort > 0 ? <Text style={styles.errorText}>Uang diterima kurang {money(cashShort)}.</Text> : <View style={styles.changeCard}><Text style={styles.changeLabel}>Kembalian</Text><Text style={styles.changeValue}>{money(cashChange)}</Text></View>}
  </>;
  const updateMixed = (index: number, change: Partial<MixedPart>) => props.onMixedPaymentsChange((mixed ?? []).map((part, position) => position === index ? { ...part, ...change } : part));
  const depositRows = paid > 0 ? <><SummaryRow label="Total" value={money(props.total)} /><SummaryRow label="Sudah dibayar (DP)" value={`- ${money(paid)}`} /><View style={styles.summaryDivider} /><SummaryRow label="Sisa tagihan" value={money(due)} strong /></> : null;
  // Nothing to pay for: no lines, or every line is priced at Rp 0.
  const canPay = props.lines.length > 0 && props.total > 0;
  const continueToPayment = () => {
    if (!canPay) { props.onError(props.lines.length ? 'Total pesanan Rp 0 (semua item bonus atau belum ada harga), jadi belum bisa dibayar.' : 'Pesanan masih kosong.'); return; }
    // A walk-in sale without a name is recorded as "Umum"; an open bill keeps its customer's name.
    if (!props.customer.trim() && props.openBill) { props.onError('Nama pelanggan wajib diisi.'); return; }
    props.onError('');
    props.onPaymentStepChange(true);
  };

  return <View style={[styles.screen, { paddingTop: props.topInset }]}>
    <FlowHeader title={props.paymentStep ? props.depositMode ? 'Terima DP' : 'Pembayaran' : 'Pesanan'} count={count} onClose={props.onClose} onClear={props.onClear} />
    <View style={styles.steps}>
      <Pressable accessibilityRole="button" onPress={() => props.onPaymentStepChange(false)} style={[styles.step, !props.paymentStep && styles.stepActive]}>
        <View style={[styles.stepNumber, !props.paymentStep && styles.stepNumberActive]}><Text style={[styles.stepNumberText, !props.paymentStep && styles.stepNumberTextActive]}>1</Text></View><Text style={[styles.stepLabel, !props.paymentStep && styles.stepLabelActive]}>Pesanan</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!canPay} onPress={continueToPayment} style={[styles.step, props.paymentStep && styles.stepActive, !canPay && styles.disabled]}>
        <View style={[styles.stepNumber, props.paymentStep && styles.stepNumberActive]}><Text style={[styles.stepNumberText, props.paymentStep && styles.stepNumberTextActive]}>2</Text></View><Text style={[styles.stepLabel, props.paymentStep && styles.stepLabelActive]}>Pembayaran</Text>
      </Pressable>
    </View>

    {!props.paymentStep ? <>
      <KeyboardAwareScrollView bottomOffset={24} style={styles.content} contentContainerStyle={styles.contentBody} keyboardShouldPersistTaps="handled">
        <View style={styles.customerCard}>
          <Text style={styles.fieldLabel}>PELANGGAN</Text>
          {props.selectedCustomer ? <View style={styles.customerSelected}>
            <View style={styles.customerAvatar}><Text style={styles.customerAvatarText}>{props.selectedCustomer.name.trim().charAt(0).toUpperCase() || '?'}</Text></View>
            <View style={styles.lineDetails}><Text numberOfLines={1} style={styles.customerName}>{props.selectedCustomer.name}</Text><Text numberOfLines={1} style={styles.productSku}>{customerHint(props.selectedCustomer)}</Text></View>
            {props.onPickCustomer ? <Pressable accessibilityRole="button" accessibilityLabel="Ganti customer" onPress={props.onPickCustomer} style={styles.customerChange}><Text style={styles.customerChangeText}>Ganti</Text></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Lepas customer, jadikan Guest" onPress={props.onRemoveCustomer} style={styles.customerRemove}><X size={17} color="#8a97a8" /></Pressable>
          </View> : <>
            {props.onPickCustomer ? <Pressable accessibilityRole="button" accessibilityLabel="Pilih customer terdaftar" onPress={props.onPickCustomer} style={({ pressed }) => [styles.customerPicker, pressed && styles.disabled]}>
              <View style={styles.customerAvatar}><UserRound size={17} color="#61738a" /></View>
              <View style={styles.lineDetails}><Text style={styles.customerName}>Guest</Text><Text numberOfLines={1} style={styles.productSku}>Pilih customer terdaftar atau tambah baru</Text></View>
              <Text style={styles.customerChangeText}>Pilih</Text><ChevronRight size={16} color="#07885b" />
            </Pressable> : null}
            <TextInput accessibilityLabel="Nama pelanggan" style={styles.customerInput} value={props.customer} onChangeText={props.onCustomerChange} placeholder="Nama pelanggan (opsional, default Umum)" placeholderTextColor="#8a97a8" />
          </>}
          <View style={styles.serviceModes}>
            {[{ label: 'Dine in', value: false }, { label: 'Takeaway', value: true }].map((option) => <Pressable key={option.label} accessibilityRole="button" accessibilityState={{ selected: props.takeaway === option.value }} onPress={() => props.onTakeawayChange(option.value)} style={[styles.modeButton, props.takeaway === option.value && styles.modeButtonActive]}><Text style={[styles.modeText, props.takeaway === option.value && styles.modeTextActive]}>{option.label}</Text></Pressable>)}
          </View>
        </View>
        <View style={styles.lineList}>{props.lines.map((line) => {
          const sent = Boolean(line.bill?.sentAt);
          return <View key={line.key} style={styles.lineItem}>
            {line.product.imageUrl ? <Image source={{ uri: line.product.imageUrl }} style={styles.productImage} /> : <View style={[styles.productImage, styles.imageFallback]}><ReceiptText size={18} color="#8191a3" /></View>}
            <View style={styles.lineDetails}>
              <Text numberOfLines={1} style={styles.productName}>{line.product.name}</Text><Text style={styles.productSku}>{lineSubtitle(line)}</Text>
              <LineBadges line={line} />
              {isLineEditable(line) && line.product.sellingUnits.length > 1 ? <View style={styles.unitChoices}>{line.product.sellingUnits.map((unit) => {
                const active = line.unitId === unit.unitId;
                return <Pressable key={unit.unitId} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`Satuan ${unit.unit.name}`} onPress={() => props.onUnitChange(line.key, unit.unitId)} style={[styles.unitChoice, active && styles.unitChoiceActive]}><Text style={[styles.unitChoiceText, active && styles.unitChoiceTextActive]}>{unit.unit.code} · {money(unit.sellingPrice)}</Text></Pressable>;
              })}</View> : null}
              {isLineEditable(line) ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: Boolean(line.isBonus) }} accessibilityLabel={`Bonus gratis untuk ${line.product.name}`} onPress={() => props.onToggleBonus(line.key)} style={[styles.bonusToggle, line.isBonus && styles.bonusToggleActive]}><Gift size={12} color={line.isBonus ? '#fff' : '#b45309'} /><Text style={[styles.bonusToggleText, line.isBonus && styles.bonusToggleTextActive]}>{line.isBonus ? 'Bonus (gratis)' : 'Jadikan bonus'}</Text></Pressable> : null}
              <View style={styles.lineBottom}>{isLineEditable(line) ? <View style={styles.quantityControl}><Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${line.product.name}`} onPress={() => props.onQuantity(line.key, -1)} style={styles.quantityButton}><Text style={styles.quantityButtonText}>−</Text></Pressable><Text style={styles.quantityValue}>{line.quantity}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${line.product.name}`} disabled={!props.canIncrease(line)} onPress={() => props.onQuantity(line.key, 1)} style={[styles.quantityButton, !props.canIncrease(line) && styles.disabled]}><Text style={styles.quantityButtonText}>+</Text></Pressable></View> : <Text style={styles.quantityValue}>× {line.quantity}</Text>}<Text style={styles.linePrice}>{money(props.priceFor(line) * line.quantity)}</Text></View>
              {/* Sent lines are locked: more of the same is a new line, less needs a void. */}
              {sent ? props.onVoidLine ? <Pressable accessibilityRole="button" accessibilityLabel={`Void ${line.product.name}`} disabled={props.billBusy} onPress={() => props.onVoidLine?.(line)} style={[styles.voidButton, props.billBusy && styles.disabled]}><Text style={styles.voidButtonText}>Void</Text></Pressable> : <Text style={styles.lockHint}>Terkunci · Butuh izin void</Text> : null}
            </View>
            {!sent ? <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${line.product.name}`} hitSlop={6} onPress={() => props.onQuantity(line.key, -line.quantity)} style={styles.lineRemove}><Trash2 size={16} color="#8a97a8" /></Pressable> : null}
          </View>;
        })}{(props.openBill?.itemVoids ?? []).map((entry) => <View key={entry.id} style={[styles.lineItem, styles.voidLine]}>
          <View style={styles.lineDetails}>
            <Text numberOfLines={1} style={[styles.productName, styles.struck]}>{entry.productNameSnapshot}{entry.variantNameSnapshot ? ` (${entry.variantNameSnapshot})` : ''}</Text>
            <Text style={styles.productSku}>Void × {Number(entry.quantity)} · {entry.reason}</Text>
          </View>
          <Text style={[styles.linePrice, styles.struck]}>{money(entry.amount)}</Text>
        </View>)}</View>
        <View style={styles.summaryCard}>
          <SummaryRow label="Subtotal" value={money(props.subtotal)} />
          <View style={styles.discountRow}><Text style={styles.summaryLabel}>Diskon</Text><MoneyInput accessibilityLabel="Diskon rupiah" value={props.discount} onChangeText={props.onDiscountChange} style={styles.discountInput} /></View>
          <View style={styles.summaryDivider} /><SummaryRow label="Total" value={money(props.total)} strong />
        </View>
        {props.openBill ? <View style={styles.billCard}>
          <View style={styles.billCardHeader}><ReceiptText size={18} color="#8a5a08" /><View style={styles.lineDetails}><Text numberOfLines={1} style={styles.billCardTitle}>Open Bill {props.openBill.orderNumber}</Text><Text numberOfLines={1} style={styles.productSku}>{customerLabel(props.openBill.customerName, props.openBill.customerPhone)}{props.openBillDirty ? ' · ada perubahan belum disimpan' : ''}</Text></View></View>
          {depositRows ? <View style={styles.billTotals}>{depositRows}</View> : null}
          <View style={styles.billActions}>
            {props.onCancelOpenBill ? <Pressable accessibilityRole="button" disabled={props.billBusy} onPress={props.onCancelOpenBill} style={[styles.billDangerButton, props.billBusy && styles.disabled]}><Text style={styles.billDangerText}>Batalkan Bill</Text></Pressable> : null}
            <Pressable accessibilityRole="button" disabled={props.billBusy || !props.lines.length} onPress={props.onSaveOpenBill} style={[styles.billSaveButton, (props.billBusy || !props.lines.length) && styles.disabled]}>{props.billBusy ? <ActivityIndicator color="#07885b" /> : <><Save size={16} color="#07885b" /><Text style={styles.billSaveText}>Simpan Perubahan</Text></>}</Pressable>
          </View>
          {props.onSendToKitchen ? <Pressable accessibilityRole="button" accessibilityHint="Menyimpan perubahan lalu mengirim item yang belum terkirim ke dapur" disabled={props.billBusy || !unsentCount} onPress={props.onSendToKitchen} style={[styles.kitchenButton, (props.billBusy || !unsentCount) && styles.disabled]}><ChefHat size={16} color="#fff" /><Text style={styles.primaryText}>{unsentCount ? `Kirim ke Dapur (${unsentCount} item)` : 'Semua item sudah terkirim'}</Text></Pressable> : null}
          {props.onPrintPreBill || props.onStartDeposit ? <View style={styles.billActions}>
            {props.onPrintPreBill ? <Pressable accessibilityRole="button" accessibilityHint="Menyimpan perubahan lalu mencetak tagihan yang belum lunas" disabled={props.billBusy || !props.lines.length} onPress={props.onPrintPreBill} style={[styles.billSaveButton, (props.billBusy || !props.lines.length) && styles.disabled]}><Printer size={16} color="#07885b" /><Text style={styles.billSaveText}>Cetak Tagihan</Text></Pressable> : null}
            {props.onStartDeposit ? <Pressable accessibilityRole="button" accessibilityHint="Menerima uang muka untuk bill ini" disabled={props.billBusy || !props.lines.length || due <= 0} onPress={props.onStartDeposit} style={[styles.billSaveButton, (props.billBusy || !props.lines.length || due <= 0) && styles.disabled]}><Wallet size={16} color="#07885b" /><Text style={styles.billSaveText}>Terima DP</Text></Pressable> : null}
          </View> : null}
          {props.onSplitBill || props.onMergeBill ? <View style={styles.billActions}>
            {props.onSplitBill ? <Pressable accessibilityRole="button" accessibilityHint="Memindahkan sebagian item ke bill baru" disabled={props.billBusy || !props.lines.length} onPress={props.onSplitBill} style={[styles.billSaveButton, (props.billBusy || !props.lines.length) && styles.disabled]}><Split size={16} color="#07885b" /><Text style={styles.billSaveText}>Split Bill</Text></Pressable> : null}
            {props.onMergeBill ? <Pressable accessibilityRole="button" accessibilityHint="Menggabungkan open bill lain ke bill ini" disabled={props.billBusy} onPress={props.onMergeBill} style={[styles.billSaveButton, props.billBusy && styles.disabled]}><Merge size={16} color="#07885b" /><Text style={styles.billSaveText}>Gabung Bill</Text></Pressable> : null}
          </View> : null}
        </View> :<Pressable accessibilityRole="button" disabled={props.billBusy || !props.lines.length} onPress={props.onSaveOpenBill} style={[styles.billSaveButton, (props.billBusy || !props.lines.length) && styles.disabled]}>{props.billBusy ? <ActivityIndicator color="#07885b" /> : <><Save size={16} color="#07885b" /><Text style={styles.billSaveText}>Simpan Open Bill</Text></>}</Pressable>}
        {props.onOpenPrintSettings ? <Pressable accessibilityRole="button" onPress={props.onOpenPrintSettings} style={styles.settingsLink}><Printer size={14} color="#07885b" /><Text style={styles.settingsLinkText}>Pengaturan printer tiket bar/dapur</Text><ChevronRight size={14} color="#07885b" /></Pressable> : null}
        {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
        {props.warning ? <Text style={styles.warningText}>{props.warning}</Text> : null}
        {props.lines.length > 0 && props.total <= 0 ? <Text style={styles.errorText}>Total pesanan Rp 0 (semua item bonus atau belum ada harga), jadi belum bisa dibayar.</Text> : null}
        {props.notice ? <View style={styles.noticeBox}><Text style={[styles.noticeText, styles.noticeBoxText]}>{props.notice}</Text>{props.noticeAction ? <Pressable accessibilityRole="button" onPress={props.noticeAction.onPress} style={styles.noticeAction}><Text style={styles.noticeActionText}>{props.noticeAction.label}</Text><ChevronRight size={14} color="#07885b" /></Pressable> : null}</View> : null}
      </KeyboardAwareScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(props.bottomInset + 8, 12) }]}>
        <Pressable accessibilityRole="button" onPress={props.onClose} style={styles.secondaryButton}><Text style={styles.secondaryText}>Kembali</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={continueToPayment} disabled={!canPay} style={[styles.primaryButton, !canPay && styles.disabled]}><Text style={styles.primaryText}>Lanjut ke pembayaran</Text><ChevronRight size={18} color="#fff" /></Pressable>
      </View>
    </> : <>
      <KeyboardAwareScrollView bottomOffset={96} style={styles.content} contentContainerStyle={styles.contentBody} keyboardShouldPersistTaps="handled">
        <View style={styles.summaryCard}>{props.openBill ? <SummaryRow label="Open Bill" value={`${props.openBill.orderNumber} · ${props.openBill.customerName}`} /> : null}{props.selectedCustomer ? <SummaryRow label="Customer" value={customerLabel(props.selectedCustomer.name, props.selectedCustomer.phone)} /> : null}<SummaryRow label="Layanan" value={props.takeaway ? 'Takeaway' : 'Dine in'} /><SummaryRow label="Total tagihan" value={money(props.total)} /><SummaryRow label="Diskon" value={`- ${money(props.discountAmount)}`} /><View style={styles.summaryDivider} />{depositRows ?? <SummaryRow label="Total pembayaran" value={money(props.total)} strong />}</View>
        {!props.depositMode && splitMethods ? <>
          {/* "Bagi rata": the same order paid by several people, each with an equal share and their own method. */}
          <View style={styles.splitHeader}>
            <Users size={17} color="#07885b" /><Text style={styles.splitTitle}>Bagi rata ke {splitMethods.length} orang</Text>
            <View style={styles.quantityControl}>
              <Pressable accessibilityRole="button" accessibilityLabel="Kurangi jumlah orang" disabled={splitMethods.length <= 2} onPress={() => props.onSplitMethodsChange(splitMethods.slice(0, -1))} style={[styles.quantityButton, splitMethods.length <= 2 && styles.disabled]}><Minus size={15} color="#07885b" /></Pressable>
              <Text style={styles.quantityValue}>{splitMethods.length}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Tambah jumlah orang" disabled={splitMethods.length >= maxPeople} onPress={() => props.onSplitMethodsChange([...splitMethods, props.method])} style={[styles.quantityButton, splitMethods.length >= maxPeople && styles.disabled]}><Plus size={15} color="#07885b" /></Pressable>
            </View>
          </View>
          {equalShares(due, splitMethods.length).map((amount, index) => <View key={`share-${index}`} style={styles.shareRow}>
            <View style={styles.shareTop}><Text style={styles.shareLabel}>Orang {index + 1}</Text><Text style={styles.shareAmount}>{money(amount)}</Text></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shareMethods}>{methods.map(({ id, label }) => {
              const active = splitMethods[index] === id;
              return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Orang ${index + 1} bayar ${label}`} accessibilityState={{ selected: active }} onPress={() => props.onSplitMethodsChange(splitMethods.map((method, position) => position === index ? id : method))} style={[styles.modeButton, active && styles.modeButtonActive]}><Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text></Pressable>;
            })}</ScrollView>
          </View>)}
          <Pressable accessibilityRole="button" onPress={() => props.onSplitMethodsChange(null)} style={styles.settingsLink}><X size={14} color="#07885b" /><Text style={styles.settingsLinkText}>Batal bagi rata, bayar sekaligus</Text></Pressable>
        </> : mixed ? <>
          {/* "Bayar campuran": one payer, several methods. Non-cash parts are typed; the cash part is what is left. */}
          <View style={styles.splitHeader}><Wallet size={17} color="#07885b" /><Text style={styles.splitTitle}>Bayar campuran</Text></View>
          {mixed.map((part, index) => <View key={`mixed-${index}`} style={styles.shareRow}>
            <View style={styles.shareTop}><Text style={styles.shareLabel}>Non-tunai {index + 1}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Hapus pembayaran ${index + 1}`} hitSlop={8} onPress={() => props.onMixedPaymentsChange(mixed.length > 1 ? mixed.filter((_, position) => position !== index) : null)}><X size={16} color="#8a97a8" /></Pressable></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.shareMethods}>{nonCashMethods.map(({ id, label }) => {
              const active = part.method === id;
              return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Pembayaran ${index + 1} lewat ${label}`} accessibilityState={{ selected: active }} onPress={() => updateMixed(index, { method: id })} style={[styles.modeButton, active && styles.modeButtonActive]}><Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text></Pressable>;
            })}</ScrollView>
            <View style={styles.amountField}><Text style={styles.currencyPrefix}>Rp</Text><MoneyInput accessibilityLabel={`Nominal pembayaran ${index + 1}`} value={part.amount} onChangeText={(value) => updateMixed(index, { amount: value })} placeholder="0" placeholderTextColor="#8a97a8" style={styles.receivedInput} /></View>
          </View>)}
          {mixed.length < MAX_MIXED_PARTS ? <Pressable accessibilityRole="button" onPress={() => props.onMixedPaymentsChange([...mixed, { method: 'TRANSFER', amount: '' }])} style={styles.settingsLink}><Plus size={14} color="#07885b" /><Text style={styles.settingsLinkText}>Tambah metode non-tunai</Text></Pressable> : null}
          {mixedOver ? <Text style={styles.errorText}>Total non-tunai {money(mixedNonCash)} melebihi tagihan {money(due)}.</Text> : <>
            <Text style={styles.sectionLabel}>SISA DIBAYAR TUNAI</Text>
            <View style={styles.amountField}><Text style={styles.currencyPrefix}>Rp</Text><Text style={styles.amountValue}>{money(cashDue).replace('Rp ', '')}</Text></View>
            {cashDue > 0 ? cashInput : null}
          </>}
          <Pressable accessibilityRole="button" onPress={() => props.onMixedPaymentsChange(null)} style={styles.settingsLink}><X size={14} color="#07885b" /><Text style={styles.settingsLinkText}>Batal bayar campuran, pakai satu metode</Text></Pressable>
        </> : <>
        <Text style={styles.sectionLabel}>METODE PEMBAYARAN</Text>
        <View style={styles.methodGrid}>{methods.map(({ id, label, icon: Icon }) => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: props.method === id }} onPress={() => props.onMethodChange(id)} style={[styles.methodButton, props.method === id && styles.methodButtonActive]}><Icon size={20} color={props.method === id ? '#fff' : '#3976a8'} /><Text numberOfLines={1} style={[styles.methodLabel, props.method === id && styles.methodLabelActive]}>{label}</Text>{props.method === id ? <Check size={13} color="#fff" style={styles.methodCheck} /> : null}</Pressable>)}</View>
        </>}
        {props.depositMode ? <>
          <Text style={styles.sectionLabel}>JUMLAH DP *</Text>
          <View style={styles.amountField}><Text style={styles.currencyPrefix}>Rp</Text><MoneyInput accessibilityLabel="Jumlah DP" autoFocus value={props.depositAmount} onChangeText={props.onDepositAmountChange} placeholder="0" placeholderTextColor="#8a97a8" style={styles.receivedInput} /></View>
          <Text style={styles.sheetHint}>Lebih dari Rp 0 dan kurang dari sisa tagihan {money(due)}. Untuk melunasi, gunakan Bayar.</Text>
        </> : !splitMethods && !mixed ? <>
          {props.method === 'CASH' && due > 0 ? cashInput : <>
            <Text style={styles.sectionLabel}>JUMLAH DIBAYAR</Text>
            <View style={styles.amountField}><Text style={styles.currencyPrefix}>Rp</Text><Text style={styles.amountValue}>{money(due).replace('Rp ', '')}</Text></View>
          </>}
          {due >= 2 ? <Pressable accessibilityRole="button" accessibilityHint="Membagi sisa tagihan sama rata, tiap orang dengan metode bayarnya sendiri" onPress={() => props.onSplitMethodsChange([props.method, props.method])} style={styles.settingsLink}><Users size={14} color="#07885b" /><Text style={styles.settingsLinkText}>Bagi rata ke beberapa orang</Text><ChevronRight size={14} color="#07885b" /></Pressable> : null}
          {due >= 2 ? <Pressable accessibilityRole="button" accessibilityHint="Sebagian dibayar non-tunai dengan nominal sendiri, sisanya tunai" onPress={() => props.onMixedPaymentsChange([{ method: props.method === 'CASH' ? 'QRIS' : props.method, amount: '' }])} style={styles.settingsLink}><Wallet size={14} color="#07885b" /><Text style={styles.settingsLinkText}>Bayar campuran (tunai + metode lain)</Text><ChevronRight size={14} color="#07885b" /></Pressable> : null}
        </> : null}
        {!props.depositMode && props.onQuickSaleTicketsChange ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: props.quickSaleTickets }} onPress={() => props.onQuickSaleTicketsChange?.(!props.quickSaleTickets)} style={styles.toggleRow}>
          <View style={[styles.checkbox, props.quickSaleTickets && styles.checkboxChecked]}>{props.quickSaleTickets ? <Check size={13} color="#fff" /> : null}</View>
          <View style={styles.lineDetails}><Text style={styles.toggleText}>Cetak tiket bar/dapur setelah bayar</Text><Text style={styles.productSku}>Disimpan di perangkat ini.</Text></View>
          {props.onOpenPrintSettings ? <Pressable accessibilityRole="button" accessibilityLabel="Atur printer tiket" hitSlop={6} onPress={props.onOpenPrintSettings} style={styles.customerChange}><Text style={styles.customerChangeText}>Printer</Text></Pressable> : null}
        </Pressable> : null}
        <Text style={styles.sectionLabel}>FOTO BUKTI PEMBAYARAN (OPSIONAL)</Text>
        <View style={styles.photoRow}>
          {props.paymentPhotos.map((uri, index) => <View key={`${uri}-${index}`}><Image source={{ uri }} style={styles.photoThumb} /><Pressable accessibilityRole="button" accessibilityLabel={`Hapus foto bukti ${index + 1}`} disabled={props.submitting} hitSlop={6} onPress={() => props.onRemovePaymentPhoto(index)} style={styles.photoRemove}><X size={12} color="#fff" /></Pressable></View>)}
          {props.paymentPhotos.length < 8 ? <Pressable accessibilityRole="button" accessibilityLabel="Ambil foto bukti pembayaran" disabled={props.submitting} onPress={props.onTakePaymentPhoto} style={[styles.photoAdd, props.submitting && styles.disabled]}><Camera size={20} color="#07885b" /><Text style={styles.photoAddText}>Ambil foto</Text></Pressable> : null}
        </View>
        {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
      </KeyboardAwareScrollView>
      <KeyboardStickyView offset={{ opened: props.bottomInset }}><View style={[styles.footer, { paddingBottom: Math.max(props.bottomInset + 8, 12) }]}>
        <Pressable accessibilityRole="button" onPress={() => props.onPaymentStepChange(false)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Kembali</Text></Pressable>
        {props.depositMode
          ? <Pressable accessibilityRole="button" disabled={!Number(props.depositAmount) || props.submitting} onPress={props.onReceiveDeposit} style={[styles.primaryButton, (!Number(props.depositAmount) || props.submitting) && styles.disabled]}>{props.submitting ? <ActivityIndicator color="#fff" /> : <><Wallet size={17} color="#fff" /><Text style={styles.primaryText}>Terima DP {money(props.depositAmount)}</Text></>}</Pressable>
          : <Pressable accessibilityRole="button" disabled={!props.lines.length || props.submitting || cashShort > 0 || mixedInvalid} onPress={props.onCheckout} style={[styles.primaryButton, (!props.lines.length || props.submitting || cashShort > 0 || mixedInvalid) && styles.disabled]}>{props.submitting ? <ActivityIndicator color="#fff" /> : <><CreditCard size={17} color="#fff" /><Text style={styles.primaryText}>{paid > 0 && due <= 0 ? 'Bayar · Selesaikan transaksi' : `Bayar ${money(due)}`}</Text></>}</Pressable>}
      </View></KeyboardStickyView>
    </>}
  </View>;
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <View style={styles.summaryRow}><Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>{label}</Text><Text style={[styles.summaryValue, strong && styles.summaryTotal]}>{value}</Text></View>;
}

/** "Terkirim" on lines already sent to the kitchen, "Tidak ada di katalog" on products this warehouse no longer sells. */
function LineBadges({ line }: { line: PosLine }) {
  const bill = line.bill;
  if (!line.stockSource && !line.isBonus && (!bill || (!bill.sentAt && !bill.missing))) return null;
  return <View style={styles.lineBadges}>
    {line.stockSource ? <Text style={[styles.lineBadge, line.stockSource === 'DISPLAY' ? styles.displayBadge : styles.warehouseBadge]}>{line.stockSource === 'DISPLAY' ? 'Display' : 'Gudang'}</Text> : null}
    {line.isBonus ? <Text style={[styles.lineBadge, styles.bonusBadge]}>Bonus</Text> : null}
    {bill?.sentAt ? <Text style={[styles.lineBadge, styles.sentBadge]}>Terkirim</Text> : null}
    {bill?.missing ? <Text style={[styles.lineBadge, styles.missingBadge]}>Tidak ada di katalog</Text> : null}
  </View>;
}

type OpenBillVoidSheetProps = {
  line: PosLine;
  saving: boolean;
  error: string;
  bottomInset: number;
  /** `quantity` is omitted for a full void. */
  onVoid: (quantity: string | undefined, reason: string, stockAction: OpenBillStockAction) => void;
  onClose: () => void;
};

/** Takes a sent line (or part of it) off the bill with a required reason; mount it only while it is shown. */
export function OpenBillVoidSheet(props: OpenBillVoidSheetProps) {
  const [quantity, setQuantity] = useState(String(props.line.quantity));
  const [reason, setReason] = useState('');
  // The goods left stock when ordered, so the cashier says whether they come back (unopened) or were wasted (opened).
  const [stockAction, setStockAction] = useState<OpenBillStockAction | null>(null);
  const [localError, setLocalError] = useState('');
  const submit = () => {
    const value = Number(quantity.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value > props.line.quantity) { setLocalError(`Jumlah void harus lebih dari 0 dan maksimal ${props.line.quantity}.`); return; }
    if (!reason.trim()) { setLocalError('Alasan void wajib diisi.'); return; }
    if (!stockAction) { setLocalError('Pilih Kembalikan ke stok atau Terbuang.'); return; }
    setLocalError('');
    props.onVoid(value === props.line.quantity ? undefined : String(value), reason.trim(), stockAction);
  };
  const error = localError || props.error;
  return <Modal visible transparent animationType="slide" onRequestClose={() => { if (!props.saving) props.onClose(); }}>
    <KeyboardAvoidingView behavior="padding" style={catalogStyles.modalBackdrop}>
      <View style={[catalogStyles.optionSheet, { paddingBottom: Math.max(props.bottomInset + 8, 26) }]}>
        <View style={catalogStyles.optionHeader}><View style={styles.lineDetails}><Text style={catalogStyles.optionTitle}>Void item</Text><Text numberOfLines={2} style={catalogStyles.catalogProductCategory}>{props.line.product.name} · {lineSubtitle(props.line)} · sudah dikirim ke dapur ({props.line.quantity})</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup" disabled={props.saving} onPress={props.onClose} style={catalogStyles.catalogHeaderIcon}><X size={19} color="#435a72" /></Pressable></View>
        <Text style={catalogStyles.optionSection}>JUMLAH VOID</Text>
        <TextInput accessibilityLabel="Jumlah void" keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} maxLength={10} style={styles.sheetInput} />
        <Text style={styles.sheetHint}>Default seluruh jumlah di bill. Isi lebih kecil untuk void sebagian.</Text>
        <Text style={catalogStyles.optionSection}>ALASAN *</Text>
        <TextInput accessibilityLabel="Alasan void" autoFocus value={reason} onChangeText={setReason} maxLength={300} multiline placeholder="Wajib diisi, contoh: pelanggan batal pesan" placeholderTextColor="#8a97a8" style={[styles.sheetInput, styles.sheetMultiline]} />
        <Text style={catalogStyles.optionSection}>BARANGNYA *</Text>
        <View style={styles.stockChoices}>{openBillStockActions.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: stockAction === option.value }} disabled={props.saving} onPress={() => { setStockAction(option.value); setLocalError(''); }} style={[styles.stockChoice, stockAction === option.value && styles.stockChoiceSelected]}><Text style={[styles.stockChoiceTitle, stockAction === option.value && styles.stockChoiceTitleSelected]}>{option.label}</Text><Text style={styles.sheetHint}>{option.hint}</Text></Pressable>)}</View>
        {error ? <Text style={[styles.errorText, styles.sheetError]}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={props.saving || !reason.trim() || !stockAction} onPress={submit} style={[catalogStyles.primaryButton, styles.voidSubmit, (props.saving || !reason.trim() || !stockAction) && catalogStyles.disabled]}>{props.saving ? <ActivityIndicator color="#fff" /> : <Text style={catalogStyles.primaryText}>Void item</Text>}</Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

type PrinterPickerSheetProps = {
  devices: PairedPrinter[];
  loading: boolean;
  /** Shown when the paired devices could not be read (e.g. Bluetooth permission denied). */
  error?: string;
  bottomInset: number;
  /** Defaults to "Pilih printer Bluetooth"; e.g. "Pilih Printer Bar" when picking a station printer. */
  title?: string;
  onChoose: (printer: PairedPrinter) => void;
  onClose: () => void;
  onOpenBluetoothSettings: () => void;
};

/**
 * Printers to pick from: Bluetooth Classic printers already paired in Android settings, or BLE printers (e.g. PRJ-58D)
 * found by scanning, which need no pairing. Mount it only while it is shown.
 */
export function PrinterPickerSheet(props: PrinterPickerSheetProps) {
  const [mode, setMode] = useState<'classic' | 'ble'>('classic');
  const [bleDevices, setBleDevices] = useState<BlePrinter[]>([]);
  const [scanning, setScanning] = useState(false);
  const [bleError, setBleError] = useState('');
  useEffect(() => stopBleScan, []);
  const scan = async () => {
    setScanning(true); setBleError(''); setBleDevices([]);
    try {
      const found = await scanBlePrinters(setBleDevices);
      setBleDevices(found);
      if (!found.length) setBleError('Tidak ada printer BLE ditemukan. Pastikan printer menyala dan dekat, lalu pindai ulang.');
    } catch (error) {
      setBleError(error instanceof Error ? error.message : 'Gagal mencari printer BLE.');
    } finally { setScanning(false); }
  };
  const showBle = () => { setMode('ble'); if (!bleDevices.length && !scanning) void scan(); };
  return <Modal transparent animationType="slide" visible onRequestClose={props.onClose}>
    <View style={styles.modalBackdrop}><View style={[styles.printerModal, { paddingBottom: Math.max(props.bottomInset + 8, 28) }]}>
      <View style={styles.printerModalHeader}><Text style={styles.printerModalTitle}>{props.title ?? 'Pilih printer Bluetooth'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={props.onClose}><X size={20} color="#526276" /></Pressable></View>
      <View style={styles.serviceModes}>{([['classic', 'Bluetooth Classic'], ['ble', 'BLE']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }} onPress={value === 'ble' ? showBle : () => setMode('classic')} style={[styles.modeButton, mode === value && styles.modeButtonActive]}><Text style={[styles.modeText, mode === value && styles.modeTextActive]}>{label}</Text></Pressable>)}</View>
      {mode === 'classic' ? <>
        {props.loading ? <ActivityIndicator style={styles.printerLoading} color="#07885b" /> : null}
        {!props.loading && !props.devices.length ? <Text style={styles.printerEmpty}>Tidak ada printer yang dipasangkan. Printer BLE seperti PRJ-58D bisa dicari di tab BLE.</Text> : null}
        {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
        {props.devices.map((device) => <Pressable key={device.address} accessibilityRole="button" onPress={() => props.onChoose({ ...device, transport: 'classic' })} style={styles.printerRow}><Printer size={18} color="#087f5b" /><View style={styles.printerDetails}><Text style={styles.printerName}>{device.name}</Text><Text style={styles.receiptMeta}>{device.address}</Text></View><ChevronRight size={17} color="#7b8ba0" /></Pressable>)}
        <Pressable accessibilityRole="button" onPress={props.onOpenBluetoothSettings} style={styles.settingsButton}><Text style={styles.settingsText}>Pengaturan Bluetooth</Text></Pressable>
      </> : <>
        {bleDevices.map((device) => <Pressable key={device.id} accessibilityRole="button" onPress={() => { stopBleScan(); props.onChoose({ name: device.name, address: device.id, transport: 'ble' }); }} style={styles.printerRow}><Printer size={18} color="#087f5b" /><View style={styles.printerDetails}><Text style={styles.printerName}>{device.name}</Text><Text style={styles.receiptMeta}>BLE · {device.id} · sinyal {device.rssi} dBm</Text></View><ChevronRight size={17} color="#7b8ba0" /></Pressable>)}
        {scanning ? <ActivityIndicator style={styles.printerLoading} color="#07885b" /> : null}
        {bleError ? <Text style={styles.errorText}>{bleError}</Text> : null}
        <Pressable accessibilityRole="button" disabled={scanning} onPress={() => void scan()} style={[styles.settingsButton, scanning && styles.disabled]}><Text style={styles.settingsText}>{scanning ? 'Mencari printer…' : 'Pindai ulang'}</Text></Pressable>
      </>}
    </View></View>
  </Modal>;
}

type OpenBillSaveSheetProps = {
  /** True when saving changes to a loaded bill rather than creating a new one. */
  editing: boolean;
  initialName: string;
  initialPhone: string;
  saving: boolean;
  error: string;
  bottomInset: number;
  /** Registered customer on the sale: the bill takes its name, and its phone unless the customer has none. */
  linkedCustomer?: PosCustomer | null;
  onSave: (name: string, phone: string) => void;
  onClose: () => void;
};

/** Asks for the customer name and phone an open bill is filed under; mount it only while it is shown. */
export function OpenBillSaveSheet(props: OpenBillSaveSheetProps) {
  const linked = props.linkedCustomer ?? null;
  const [name, setName] = useState(linked?.name ?? props.initialName);
  const [phone, setPhone] = useState(linked?.phone ?? props.initialPhone);
  const [localError, setLocalError] = useState('');
  const nameLocked = Boolean(linked);
  const phoneLocked = Boolean(linked?.phone);
  const shownName = linked ? linked.name : name;
  const shownPhone = phoneLocked ? linked?.phone ?? '' : phone;
  const save = () => {
    const digits = shownPhone.replace(/\D/g, '');
    if (!shownName.trim()) { setLocalError('Nama pelanggan wajib diisi.'); return; }
    // The server normalises 08…/628…/+62 8… and validates the exact length; only catch obvious typos here.
    if (!phoneLocked && (digits.length < 9 || digits.length > 15 || /[^\d\s+\-]/.test(shownPhone))) { setLocalError('No. HP wajib diisi dengan angka yang valid.'); return; }
    setLocalError('');
    props.onSave(shownName.trim(), shownPhone.trim());
  };
  const error = localError || props.error;
  return <Modal visible transparent animationType="slide" onRequestClose={props.onClose}>
    <KeyboardAvoidingView behavior="padding" style={catalogStyles.modalBackdrop}>
      <View style={[catalogStyles.optionSheet, { paddingBottom: Math.max(props.bottomInset + 8, 26) }]}>
        <View style={catalogStyles.optionHeader}><View style={styles.lineDetails}><Text style={catalogStyles.optionTitle}>{props.editing ? 'Simpan perubahan bill' : 'Simpan Open Bill'}</Text><Text style={catalogStyles.catalogProductCategory}>Bill disimpan tanpa pembayaran dan bisa dibuka lagi dari daftar Open Bill.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={props.onClose} style={catalogStyles.catalogHeaderIcon}><X size={19} color="#435a72" /></Pressable></View>
        <Text style={catalogStyles.optionSection}>NAMA PELANGGAN</Text>
        <TextInput accessibilityLabel="Nama pelanggan" autoFocus={!nameLocked && !props.initialName} editable={!nameLocked} value={shownName} onChangeText={setName} maxLength={100} placeholder="Nama pelanggan" placeholderTextColor="#8a97a8" style={[styles.sheetInput, nameLocked && styles.sheetInputLocked]} />
        {nameLocked ? <Text style={styles.sheetHint}>Mengikuti data customer terdaftar.</Text> : null}
        <Text style={catalogStyles.optionSection}>NO. HP</Text>
        <TextInput accessibilityLabel="Nomor HP pelanggan" autoFocus={!phoneLocked && Boolean(shownName) && !phone} editable={!phoneLocked} value={shownPhone} onChangeText={setPhone} maxLength={20} keyboardType="phone-pad" placeholder="08xxxxxxxxxx" placeholderTextColor="#8a97a8" style={[styles.sheetInput, phoneLocked && styles.sheetInputLocked]} />
        {linked && !phoneLocked ? <Text style={styles.sheetHint}>Customer ini belum punya No. HP; nomor ini hanya disimpan di bill.</Text> : null}
        {error ? <Text style={[styles.errorText, styles.sheetError]}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={props.saving} onPress={save} style={[catalogStyles.primaryButton, props.saving && catalogStyles.disabled]}>{props.saving ? <ActivityIndicator color="#fff" /> : <><Save size={16} color="#fff" /><Text style={catalogStyles.primaryText}>{props.editing ? 'Simpan Perubahan' : 'Simpan Open Bill'}</Text></>}</Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

type OpenBillListSheetProps = {
  request: <R>(path: string) => Promise<R>;
  bottomInset: number;
  /** Id of the bill being loaded into the cart, shown with a spinner. */
  loadingId: string;
  onSelect: (bill: OpenBillRow) => void;
  onClose: () => void;
  /** Bill left out of the list, e.g. the loaded bill when picking one to merge into it. */
  excludeId?: string;
  /** Defaults to "Open Bill"; the subtitle defaults to the number of unpaid bills. */
  title?: string;
  subtitle?: string;
};

/** Unpaid open bills, newest first, searchable by customer name, phone or order number; mount it only while it is shown. */
export function OpenBillListSheet(props: OpenBillListSheetProps) {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const params = new URLSearchParams({ status: 'OPEN', openBill: 'true' });
  if (search) params.set('search', search);
  const list = useInfiniteList<OpenBillRow>(props.request, `orders?${params.toString()}`);
  const items = props.excludeId ? list.items.filter((item) => item.id !== props.excludeId) : list.items;
  const excluded = list.items.length - items.length;
  return <Modal visible transparent animationType="slide" onRequestClose={props.onClose}>
    <KeyboardAvoidingView behavior="padding" style={catalogStyles.modalBackdrop}>
      <View style={[catalogStyles.optionSheet, styles.billListSheet, { paddingBottom: Math.max(props.bottomInset + 8, 20) }]}>
        <View style={catalogStyles.optionHeader}><View style={styles.lineDetails}><Text style={catalogStyles.optionTitle}>{props.title ?? 'Open Bill'}</Text><Text style={[catalogStyles.catalogProductCategory, styles.billListSubtitle]}>{list.loading ? 'Memuat bill...' : props.subtitle ?? `${list.total - excluded} bill belum dibayar`}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={props.onClose} style={catalogStyles.catalogHeaderIcon}><X size={19} color="#435a72" /></Pressable></View>
        <View style={[catalogStyles.catalogSearchBox, styles.billSearchBox]}><Search size={17} color="#78889c" /><TextInput accessibilityLabel="Cari open bill" value={searchInput} onChangeText={setSearchInput} placeholder="Cari nama, No. HP, atau nomor..." placeholderTextColor="#8290a2" returnKeyType="search" style={catalogStyles.catalogSearchInput} /></View>
        {list.error && !list.items.length ? <Pressable accessibilityRole="button" onPress={() => void list.reload()}><Text style={[styles.errorText, styles.sheetError]}>{list.error} Ketuk untuk coba lagi.</Text></Pressable> : null}
        <FlatList
          style={styles.billList}
          contentContainerStyle={styles.billListContent}
          keyboardShouldPersistTaps="handled"
          data={items}
          keyExtractor={(item) => item.id}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={list.loading ? <ActivityIndicator style={styles.printerLoading} color="#07885b" /> : !list.error ? <Text style={styles.printerEmpty}>{search ? 'Tidak ada open bill yang cocok.' : props.excludeId ? 'Tidak ada open bill lain.' : 'Belum ada open bill.'}</Text> : null}
          ListFooterComponent={<LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={list.items.length} error={list.error} onRetry={list.loadMore} />}
          renderItem={({ item }) => {
            const paid = (item.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
            return <Pressable accessibilityRole="button" accessibilityHint="Buka bill ini di keranjang" disabled={Boolean(props.loadingId)} onPress={() => props.onSelect(item)} style={({ pressed }) => [styles.billRow, pressed && styles.billRowPressed]}>
            <View style={styles.lineDetails}>
              <Text numberOfLines={1} style={styles.productName}>{item.customerName ?? 'Tanpa nama'}{item.customerPhone ? ` · ${item.customerPhone}` : ''}</Text>
              <Text numberOfLines={1} style={styles.productSku}>{item.orderNumber} · {item._count?.items ?? 0} item{item.serviceType ? ` · ${formatServiceType(item.serviceType)}` : ''} · {formatAge(item.createdAt)} lalu{item.branch?.name ? ` · ${item.branch.name}` : ''}</Text>
              {paid > 0 ? <Text numberOfLines={1} style={styles.billRowDeposit}>DP {money(paid)} · sisa {money(Number(item.grandTotal) - paid)}</Text> : null}
            </View>
            {props.loadingId === item.id ? <ActivityIndicator color="#07885b" /> : <Text style={styles.billRowTotal}>{money(item.grandTotal)}</Text>}
            <ChevronRight size={16} color="#8a97a8" />
          </Pressable>;
          }}
        />
      </View>
    </KeyboardAvoidingView>
  </Modal>;
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
  /** Title of the printer picker, which may be choosing a bar/kitchen printer for the tickets of this sale. */
  printerPickerTitle?: string;
  onPrint: () => void;
  onNewOrder: () => void;
  onChoosePrinter: (printer: PairedPrinter) => void;
  onClosePrinterPicker: () => void;
  onOpenBluetoothSettings: () => void;
};

/** "Bagikan PDF" on the receipt is hidden for now; flip this to bring it back (the PDF share itself still works). */
const SHOW_SHARE_RECEIPT = false;

export function PosReceiptScreen(props: ReceiptScreenProps) {
  const { isTablet } = useResponsive();
  const [shareError, setShareError] = useState('');
  const [sharing, setSharing] = useState(false);
  const completedAt = props.order.completedAt ?? props.order.createdAt;
  const share = async () => {
    if (sharing) return;
    setShareError('');
    setSharing(true);
    try { await shareReceiptPdf(props.order, props.cashierName); }
    catch (cause) { setShareError(cause instanceof Error && cause.message ? `Nota gagal dibagikan: ${cause.message}` : 'Nota gagal dibagikan.'); }
    finally { setSharing(false); }
  };

  return <View style={[styles.screen, { paddingTop: props.topInset, paddingBottom: props.bottomInset + 8 }]}>
    <View style={styles.receiptHeader}><Pressable accessibilityRole="button" accessibilityLabel="Kembali ke katalog" onPress={props.onNewOrder} style={styles.headerIcon}><ChevronLeft size={22} color="#172338" /></Pressable><Text style={styles.receiptHeaderTitle}>Nota pembayaran</Text><Pressable accessibilityRole="button" accessibilityLabel="Cetak nota" onPress={props.onPrint} style={styles.headerIcon}><Printer size={20} color="#216b67" /></Pressable></View>
    <View style={[styles.content, isTablet && styles.receiptSplit]}>
    <ScrollView style={styles.content} contentContainerStyle={[styles.receiptContent, isTablet && styles.receiptContentTablet]}>
      <View style={styles.successBanner}><CircleCheck size={25} color="#07885b" /><View style={styles.successTextWrap}><Text style={styles.successTitle}>Transaksi berhasil</Text><Text style={styles.successSubtitle}>Pesanan telah diselesaikan.</Text></View></View>
      <View style={styles.receiptCard}>
        <Text style={styles.receiptStore}>{props.order.branch?.name ?? 'Toko'}</Text>
        <Text style={styles.receiptMeta}>{props.order.orderNumber}  ·  {completedAt ? formatReceiptDateTime(completedAt) : ''}{props.order.serviceType ? `  ·  ${formatServiceType(props.order.serviceType)}` : ''}</Text>
        {props.order.customerName || props.order.customerPhone ? <Text style={styles.receiptMeta}>Pelanggan: {customerLabel(props.order.customerName, props.order.customerPhone)}</Text> : null}
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
        {(props.order.payments ?? []).map((payment, index) => <View key={`${payment.method}-${index}`}>
          <SummaryRow label={`Pembayaran ${formatStatus(payment.method)}`} value={money(payment.amount)} />
          {payment.receivedAmount && Number(payment.receivedAmount) !== Number(payment.amount) ? <SummaryRow label="Diterima" value={money(payment.receivedAmount)} /> : null}
          {Number(payment.changeAmount ?? 0) > 0 ? <SummaryRow label="Kembalian" value={money(payment.changeAmount ?? 0)} strong /> : null}
        </View>)}
        <View style={styles.thanks}><Text style={styles.thanksTitle}>Terima kasih</Text><Text style={styles.receiptMeta}>Semoga hari Anda menyenangkan</Text><Text selectable style={styles.orderCode}>{props.order.orderNumber}</Text></View>
      </View>
      {props.printError || shareError ? <Text style={styles.errorText}>{props.printError || shareError}</Text> : null}
      {!isTablet ? <View style={styles.receiptActions}>
        <Pressable accessibilityRole="button" onPress={props.onPrint} disabled={props.printing} style={styles.secondaryButton}>{props.printing ? <ActivityIndicator color="#087f5b" /> : <><Printer size={17} color="#087f5b" /><Text style={styles.secondaryText}>Cetak ulang</Text></>}</Pressable>
        {SHOW_SHARE_RECEIPT ? <Pressable accessibilityRole="button" onPress={() => void share()} disabled={sharing} style={styles.primaryButton}>{sharing ? <ActivityIndicator color="#fff" /> : <><Share2 size={17} color="#fff" /><Text style={styles.primaryText}>Bagikan PDF</Text></>}</Pressable> : null}
      </View> : null}
      {props.printerPickerVisible ? <PrinterPickerSheet devices={props.printerDevices} loading={props.printerLoading} bottomInset={props.bottomInset} title={props.printerPickerTitle} onChoose={props.onChoosePrinter} onClose={props.onClosePrinterPicker} onOpenBluetoothSettings={props.onOpenBluetoothSettings} /> : null}
    </ScrollView>
    {isTablet ? <View style={styles.receiptSideActions}>
      <Pressable accessibilityRole="button" onPress={props.onPrint} disabled={props.printing} style={[styles.secondaryButton, styles.sideActionButton]}>{props.printing ? <ActivityIndicator color="#087f5b" /> : <><Printer size={18} color="#087f5b" /><Text style={styles.secondaryText}>Cetak ulang</Text></>}</Pressable>
      {SHOW_SHARE_RECEIPT ? <Pressable accessibilityRole="button" onPress={() => void share()} disabled={sharing} style={[styles.primaryButton, styles.sideActionButton]}>{sharing ? <ActivityIndicator color="#fff" /> : <><Share2 size={18} color="#fff" /><Text style={styles.primaryText}>Bagikan PDF</Text></>}</Pressable> : null}
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
  headerTitle: { flex: 1, color: '#14213a', fontSize: 14, fontWeight: '900' },
  headerAction: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff0ef' },
  steps: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff' },
  step: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 20, backgroundColor: '#e6f6f0' },
  stepActive: { backgroundColor: '#07956f' }, stepNumber: { width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#cceee1' }, stepNumberActive: { backgroundColor: '#fff' },
  stepNumberText: { color: '#07885b', fontSize: 10, fontWeight: '900' }, stepNumberTextActive: { color: '#07885b' }, stepLabel: { color: '#44615d', fontSize: 10, fontWeight: '800' }, stepLabelActive: { color: '#fff' },
  content: { flex: 1 }, contentBody: { padding: 13, paddingBottom: 20, gap: 11 },
  customerCard: { padding: 12, borderRadius: 13, backgroundColor: '#fff' }, fieldLabel: { color: '#76879b', fontSize: 9, fontWeight: '900' }, customerInput: { height: 38, color: '#172338', fontSize: 12, fontWeight: '700' },
  serviceModes: { flexDirection: 'row', alignSelf: 'flex-start', gap: 7, marginTop: 6 }, modeButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#edf2f5' }, modeButtonActive: { backgroundColor: '#07956f' }, modeText: { color: '#597086', fontSize: 10, fontWeight: '800' }, modeTextActive: { color: '#fff' },
  lineList: { overflow: 'hidden', borderRadius: 13, backgroundColor: '#fff' }, lineItem: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: '#eef2f5' },
  productImage: { width: 54, height: 60, borderRadius: 9, backgroundColor: '#eff3f6' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, lineDetails: { flex: 1, minWidth: 0 }, productName: { color: '#172338', fontSize: 11, fontWeight: '900' }, productSku: { marginTop: 3, color: '#74869d', fontSize: 9 },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }, quantityControl: { flexDirection: 'row', alignItems: 'center', gap: 9 }, quantityButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e2f6ef' }, quantityButtonText: { color: '#07885b', fontSize: 17, fontWeight: '700', lineHeight: 20 }, quantityValue: { minWidth: 14, color: '#27364d', fontSize: 11, fontWeight: '800', textAlign: 'center' }, linePrice: { color: '#d72f2a', fontSize: 10, fontWeight: '900' },
  summaryCard: { padding: 13, borderRadius: 13, backgroundColor: '#fff' }, summaryRow: { minHeight: 29, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, summaryLabel: { color: '#72849a', fontSize: 10 }, summaryValue: { color: '#172338', fontSize: 10, fontWeight: '700' }, summaryStrong: { color: '#214b4a', fontSize: 12, fontWeight: '900' }, summaryTotal: { color: '#07956f', fontSize: 14, fontWeight: '900' }, summaryDivider: { height: 1, marginVertical: 5, backgroundColor: '#edf1f4' }, discountRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, discountInput: { width: 100, height: 30, paddingHorizontal: 8, borderWidth: 1, borderColor: '#e4eaee', borderRadius: 8, color: '#172338', fontSize: 10, textAlign: 'right' },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 13, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e8edf0', backgroundColor: '#fff' }, secondaryButton: { minHeight: 46, minWidth: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e1e9ee', borderRadius: 11, backgroundColor: '#fff' }, secondaryText: { color: '#53677e', fontSize: 11, fontWeight: '800' }, primaryButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#07956f' }, primaryText: { color: '#fff', fontSize: 11, fontWeight: '900' }, disabled: { opacity: 0.55 }, errorText: { padding: 10, borderRadius: 9, overflow: 'hidden', color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10, lineHeight: 15 },
  sectionLabel: { marginTop: 4, color: '#71839a', fontSize: 9, fontWeight: '900' },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, photoThumb: { width: 68, height: 68, borderRadius: 10, backgroundColor: '#edf1ee' }, photoRemove: { position: 'absolute', top: 3, right: 3, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#0a1729b3' }, photoAdd: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: '#9fd6bf', borderRadius: 10, backgroundColor: '#f2fbf7' }, photoAddText: { color: '#07885b', fontSize: 9, fontWeight: '800' }, methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, methodButton: { position: 'relative', width: '23.5%', minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#e7edf1', borderRadius: 11, backgroundColor: '#fff' }, methodButtonActive: { borderColor: '#07885b', backgroundColor: '#07885b' }, methodLabel: { maxWidth: '100%', color: '#63778e', fontSize: 9, fontWeight: '700' }, methodLabelActive: { color: '#fff' }, methodCheck: { position: 'absolute', top: 5, right: 5 },
  amountField: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 10, backgroundColor: '#fff' }, currencyPrefix: { color: '#78899c', fontSize: 10 }, amountValue: { color: '#172338', fontSize: 12, fontWeight: '800' }, receivedInput: { flex: 1, height: 40, color: '#172338', fontSize: 12, fontWeight: '700' }, cashChoices: { gap: 7, paddingVertical: 2 }, cashChip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 10, backgroundColor: '#fff' }, changeCard: { padding: 13, borderRadius: 12, backgroundColor: '#e5f8f0' }, changeLabel: { color: '#57736b', fontSize: 10 }, changeValue: { marginTop: 3, color: '#07885b', fontSize: 15, fontWeight: '900' },
  receiptHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, backgroundColor: '#fff' }, receiptHeaderTitle: { flex: 1, color: '#14213a', fontSize: 15, fontWeight: '900' }, receiptContent: { padding: 13, paddingBottom: 14, gap: 9 }, successBanner: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, backgroundColor: '#dff7ee' }, successTextWrap: { flex: 1 }, successTitle: { color: '#087c53', fontSize: 11, fontWeight: '900' }, successSubtitle: { marginTop: 3, color: '#588477', fontSize: 9 },
  receiptCard: { padding: 14, borderRadius: 13, backgroundColor: '#fff' }, receiptStore: { color: '#172338', fontSize: 12, fontWeight: '900', textAlign: 'center' }, receiptMeta: { marginTop: 4, color: '#74859b', fontSize: 9, lineHeight: 14 }, receiptDivider: { height: 1, marginVertical: 9, borderTopWidth: 1, borderColor: '#dce5eb', borderStyle: 'dashed' }, receiptLine: { paddingVertical: 6 }, receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 }, receiptItemName: { flex: 1, color: '#24344a', fontSize: 10, fontWeight: '800' }, receiptItemAmount: { color: '#172338', fontSize: 10, fontWeight: '800' },
  thanks: { alignItems: 'center', marginTop: 12 }, thanksTitle: { color: '#456178', fontSize: 10, fontWeight: '800' }, orderCode: { marginTop: 12, color: '#3c4a5e', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, receiptActions: { flexDirection: 'row', gap: 8, marginBottom: 2 }, newOrderButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginHorizontal: 13, marginBottom: 8, borderRadius: 11, backgroundColor: '#e1f7ee' }, newOrderText: { color: '#087c53', fontSize: 10, fontWeight: '900' },
  lineRemove: { alignSelf: 'flex-start', padding: 8 },
  customerPicker: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7, marginBottom: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: '#cfeadf', borderRadius: 11, backgroundColor: '#f6fbf9' },
  customerSelected: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7, marginBottom: 2, paddingHorizontal: 10, borderWidth: 1, borderColor: '#9fdcc5', borderRadius: 11, backgroundColor: '#effbf5' },
  customerAvatar: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#ddf7ed' }, customerAvatarText: { color: '#07885b', fontSize: 13, fontWeight: '900' },
  customerName: { color: '#172338', fontSize: 12, fontWeight: '900' },
  customerChange: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#9bd9bf', borderRadius: 10, backgroundColor: '#fff' }, customerChangeText: { color: '#07885b', fontSize: 11, fontWeight: '900' },
  customerRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#fff' },
  sheetInputLocked: { backgroundColor: '#f1f5f3', color: '#4b5e57' }, sheetHint: { marginTop: 5, color: '#71839a', fontSize: 10 },
  billCard: { gap: 10, padding: 12, borderWidth: 1, borderColor: '#f6d79b', borderRadius: 13, backgroundColor: '#fff8e8' }, billCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 }, billCardTitle: { color: '#6f4a08', fontSize: 11, fontWeight: '900' },
  billActions: { flexDirection: 'row', gap: 8 }, billSaveButton: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: '#9bd9bf', borderRadius: 11, backgroundColor: '#fff' }, billSaveText: { color: '#07885b', fontSize: 11, fontWeight: '900' },
  billDangerButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#f3c5c1', borderRadius: 11, backgroundColor: '#fff' }, billDangerText: { color: '#c0392b', fontSize: 11, fontWeight: '900' },
  sheetInput: { height: 44, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 10, color: '#172338', fontSize: 12, fontWeight: '700' }, sheetError: { marginTop: 10 },
  kitchenButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#b86e05' },
  unitChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }, unitChoice: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#e7edf1', borderRadius: 8, backgroundColor: '#fff' }, unitChoiceActive: { borderColor: '#07885b', backgroundColor: '#e8f7f0' }, unitChoiceText: { color: '#536a80', fontSize: 10, fontWeight: '700' }, unitChoiceTextActive: { color: '#07885b' },
  lineBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }, lineBadge: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, fontSize: 9, fontWeight: '900' }, sentBadge: { color: '#087c53', backgroundColor: '#dff7ee' }, bonusBadge: { color: '#b45309', backgroundColor: '#fef3c7' }, displayBadge: { color: '#0e7490', backgroundColor: '#cffafe' }, warehouseBadge: { color: '#475569', backgroundColor: '#e2e8f0' },
  bonusToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#fcd9a5', borderRadius: 8, backgroundColor: '#fffbeb' }, bonusToggleActive: { borderColor: '#d97706', backgroundColor: '#d97706' }, bonusToggleText: { color: '#b45309', fontSize: 10, fontWeight: '800' }, bonusToggleTextActive: { color: '#fff' }, missingBadge: { color: '#8a5a08', backgroundColor: '#fff1d6' },
  voidButton: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', marginTop: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: '#f3c5c1', borderRadius: 9, backgroundColor: '#fff' }, voidButtonText: { color: '#c0392b', fontSize: 10, fontWeight: '900' },
  lockHint: { marginTop: 6, color: '#8a97a8', fontSize: 9, fontWeight: '700' },
  voidLine: { minHeight: 52, backgroundColor: '#fdf6f5' }, struck: { color: '#9aa6b4', textDecorationLine: 'line-through' },
  noticeText: { padding: 10, borderRadius: 9, overflow: 'hidden', color: '#087c53', backgroundColor: '#e5f8f0', fontSize: 10, lineHeight: 15 },
  warningText: { padding: 10, borderRadius: 9, overflow: 'hidden', color: '#8a5a08', backgroundColor: '#fff8e8', fontSize: 10, lineHeight: 15 },
  sheetMultiline: { height: 76, paddingTop: 10, textAlignVertical: 'top' }, voidSubmit: { backgroundColor: '#c0392b' }, stockChoices: { flexDirection: 'row', gap: 8 }, stockChoice: { flex: 1, padding: 10, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 10 }, stockChoiceSelected: { borderColor: '#07956f', backgroundColor: '#ecfaf4' }, stockChoiceTitle: { color: '#26374e', fontSize: 12, fontWeight: '800' }, stockChoiceTitleSelected: { color: '#07845f' },
  billListSheet: { height: '80%' }, billSearchBox: { flex: 0, flexGrow: 0, flexShrink: 0 }, billListSubtitle: { paddingHorizontal: 0 }, billList: { flex: 1, marginTop: 8 }, billListContent: { paddingBottom: 8 },
  billRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: '#edf1f4' }, billRowPressed: { backgroundColor: '#f6f9f8' }, billRowTotal: { color: '#172338', fontSize: 11, fontWeight: '900' }, billRowDeposit: { marginTop: 3, color: '#8a5a08', fontSize: 9, fontWeight: '800' },
  billTotals: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: '#fff' },
  settingsLink: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#eef7f3' }, settingsLinkText: { color: '#087c53', fontSize: 10, fontWeight: '800' },
  noticeBox: { gap: 6, padding: 10, borderRadius: 9, backgroundColor: '#e5f8f0' }, noticeBoxText: { padding: 0 }, noticeAction: { minHeight: 36, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: 11, borderWidth: 1, borderColor: '#9bd9bf', borderRadius: 9, backgroundColor: '#fff' }, noticeActionText: { color: '#07885b', fontSize: 10, fontWeight: '900' },
  splitHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderRadius: 11, backgroundColor: '#fff' }, splitTitle: { flex: 1, color: '#172338', fontSize: 11, fontWeight: '900' },
  shareRow: { gap: 7, padding: 10, borderRadius: 11, backgroundColor: '#fff' }, shareTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, shareLabel: { color: '#53677e', fontSize: 10, fontWeight: '800' }, shareAmount: { color: '#172338', fontSize: 12, fontWeight: '900' }, shareMethods: { gap: 6 },
  toggleRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: '#fff' }, toggleText: { color: '#172338', fontSize: 11, fontWeight: '800' },
  checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#b8c8bf', borderRadius: 6, backgroundColor: '#fff' }, checkboxChecked: { borderColor: '#07885b', backgroundColor: '#07885b' },
  receiptSplit: { flexDirection: 'row' }, receiptContentTablet: { padding: 18, gap: 12 },
  receiptSideActions: { width: 230, gap: 12, paddingTop: 18, paddingRight: 18 }, sideActionButton: { flex: 0, minHeight: 56, marginHorizontal: 0, marginBottom: 0, justifyContent: 'flex-start', paddingHorizontal: 16 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, printerModal: { paddingHorizontal: 17, paddingTop: 17, paddingBottom: 28, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#fff' }, printerModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, printerModalTitle: { color: '#172338', fontSize: 15, fontWeight: '900' }, printerLoading: { padding: 18 }, printerEmpty: { paddingVertical: 16, color: '#75869a', fontSize: 11, textAlign: 'center' }, printerRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#edf1f4' }, printerDetails: { flex: 1 }, printerName: { color: '#27374d', fontSize: 11, fontWeight: '800' }, settingsButton: { alignItems: 'center', marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: '#eef7f3' }, settingsText: { color: '#087c53', fontSize: 10, fontWeight: '800' },
});
