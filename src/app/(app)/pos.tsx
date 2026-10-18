import { useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, ChevronUp, LogOut, Minus, Plus, ShoppingCart, Utensils } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MoneyInput } from '../../components/money-input';
import * as Print from 'expo-print';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { useNotifications } from '../../notifications/notifications-provider';
import { BarcodeScanner } from '../../components/barcode-scanner';
import { OpenBillListSheet, OpenBillSaveSheet, OpenBillVoidSheet, PosCatalogScreen, PosCheckoutFlow, PosReceiptScreen, PrinterPickerSheet, equalShares, type OpenBillInfo, type OpenBillRow, type OpenBillVoid, type PosLine, type PosMethod, type PosProduct } from '../../components/pos-flow';
import { formatDepositReceipt, formatKitchenTicket, formatOrderReceipt, formatPreBill, getPairedPrinters, getQuickSaleTickets, getSavedPrinter, getStationPrinter, openAndroidBluetoothSettings, paidTotalOf, printThermalReceipt, printThermalSlip, savePrinter, saveQuickSaleTickets, saveStationPrinter, stationLabel, stationTickets, type KitchenTicket, type PairedPrinter, type PreBill, type ReceiptOrder, type Station } from '../../lib/receipt-printer';
import { ThermalPreview } from '../../components/thermal-preview';
import { CustomerPickerSheet } from '../../components/customer-picker';
import { PrintSettingsSheet, SplitBillSheet, type SplitPart, type SplitSourceLine } from '../../components/cafe-sheets';
import { DEPOSIT_SETTLE_PERMISSION, DepositSettlementSheet, closedDepositOf, depositSettlementErrorMessage, depositSettlementNotice, type DepositPayment, type DepositSettlement, type DepositSettlementResult } from '../../components/deposit-settlement-sheet';
import { customerErrorMessage, type Customer, type PosCustomer } from '../../lib/customers';
import { customerLabel, formatDate, formatServiceType, formatStatus, stockWarningText, type ServiceType, type StockShortage } from '../../lib/display';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

type Branch = { id: string; name: string; address?: string | null };
type Warehouse = { id: string; name: string; branchId: string | null };
type Product = PosProduct & { barcode?: string | null };
type Order = ReceiptOrder;
type Line = PosLine & { product: Product };
type Method = PosMethod;
/** An open bill line from GET /orders/:id; `sentAt` is set once it was sent to the kitchen. */
type BillItem = {
  id: string;
  productId: string;
  productNameSnapshot: string;
  variantNameSnapshot?: string | null;
  unitId: string | null;
  variantId: string | null;
  quantity: string;
  inputQuantity?: string | null;
  unitPrice: string;
  totalPrice: string;
  note?: string | null;
  sentAt?: string | null;
  unit?: { code: string } | null;
  addons?: { addonId: string; addonNameSnapshot: string; quantity: string; totalPrice: string }[];
  /** The category's station picks the ticket (bar or kitchen) the line is printed on. */
  product?: { category?: { name: string; station?: Station | null } | null } | null;
};
/** GET /orders/:id fields needed to load an open bill back into the cart (also the shape of the open bill PUT, send and void responses). */
type BillOrder = Omit<Order, 'items'> & {
  branchId: string;
  warehouseId: string;
  version: number;
  customerId?: string | null;
  customerPhone: string | null;
  items?: BillItem[];
  itemVoids?: OpenBillVoid[];
  /** Only on save responses: products the bill needs more of than the warehouse has (non-blocking). */
  stockWarnings?: StockShortage[];
};
/**
 * The open bill in the cart; `signature` is the cart as last saved, to tell whether there are unsaved changes.
 * `customerId` is the registered customer the bill is linked to on the server (null for a guest bill); `payments` are its
 * deposits as loaded, to tell whether one already went into a cash closing.
 */
type LoadedBill = OpenBillInfo & { version: number; signature: string; customerId: string | null; payments?: DepositPayment[] };
const cartSignature = (lines: Line[], discount: string, customerName: string, customerId: string, serviceType: ServiceType) => JSON.stringify([lines.map((line) => [line.key, line.quantity]), Number(discount) || 0, customerName.trim(), customerId, serviceType]);
const serviceTypeOf = (takeaway: boolean): ServiceType => takeaway ? 'TAKEAWAY' : 'DINE_IN';
/** A printout waiting for the thermal preview; station tickets go to that station's printer. */
type Slip = { title: string; text: string; station?: Station };
/** Which saved printer the picker is choosing. */
type PrinterTarget = 'receipt' | Station;
const MERGE_MISMATCH_MESSAGE = 'Hanya bill dari cabang dan gudang yang sama yang bisa digabung.';
/** The selected customer was deactivated, deleted, or belongs to another branch since it was picked. */
const isCustomerUnavailable = (error: unknown) => error instanceof ApiError && error.code === 'CUSTOMER_UNAVAILABLE';
const isVersionConflict = (error: unknown) => error instanceof ApiError && error.code === 'OPEN_BILL_VERSION_CONFLICT';
const VERSION_CONFLICT_MESSAGE = 'Bill ini sudah diubah di perangkat lain. Data terbaru sudah dimuat ulang, periksa lalu simpan lagi.';
const VOID_BLOCKED_MESSAGE = 'Simpan perubahan bill terlebih dahulu sebelum void agar perubahan yang belum disimpan tidak hilang.';
function openBillErrorMessage(error: unknown, fallback = 'Open bill gagal disimpan.') {
  if (isCustomerUnavailable(error) || (error instanceof ApiError && error.code === 'PERMISSION_DENIED')) return customerErrorMessage(error);
  if (error instanceof ApiError) {
    const details = (error.details ?? {}) as { product?: string; onBill?: string; paid?: string; orderNumber?: string };
    if (error.code === 'OPEN_BILL_LOCKED') return 'Bill ini sudah dibayar atau dibatalkan sehingga tidak bisa diubah lagi.';
    if (error.code === 'INVALID_CUSTOMER_PHONE') return 'No. HP tidak valid. Gunakan format 08…, 628…, atau +62 8….';
    if (error.code === 'OPEN_BILL_CUSTOMER_REQUIRED') return 'Nama pelanggan dan No. HP wajib diisi untuk open bill.';
    if (error.code === 'OPEN_BILL_ITEM_NOT_FOUND') return 'Ada item yang sudah tidak ada di bill ini, mungkin diubah di perangkat lain. Buka ulang bill dari daftar Open Bill lalu coba lagi.';
    if (error.code === 'DUPLICATE_OPEN_BILL_ITEM') return 'Ada item bill yang terkirim dua kali. Buka ulang bill dari daftar Open Bill lalu coba lagi.';
    if (error.code === 'OPEN_BILL_SENT_ITEM_LOCKED') return `${details.product ?? 'Item ini'} sudah dikirim ke dapur sehingga tidak bisa diubah atau dihapus. Gunakan Void untuk menguranginya.`;
    if (error.code === 'OPEN_BILL_NOTHING_TO_SEND') return 'Semua item di bill ini sudah dikirim ke dapur.';
    if (error.code === 'OPEN_BILL_ITEM_NOT_SENT') return 'Item ini belum dikirim ke dapur; hapus saja dari keranjang lalu simpan.';
    if (error.code === 'INVALID_VOID_QUANTITY') return `Jumlah void harus lebih dari 0 dan maksimal ${details.onBill ? Number(details.onBill) : 'jumlah di bill'}.`;
    if (error.code === 'VOID_REASON_REQUIRED') return 'Alasan void wajib diisi.';
    if (error.code === 'OPEN_BILL_BELOW_DEPOSIT') return `Total bill tidak boleh di bawah DP yang sudah dibayar (${money(Number(details.paid ?? 0))}).`;
    if (error.code === 'ORDER_PAYMENT_ALREADY_CLOSED') return 'DP sudah masuk tutup kas, bill tidak bisa dibatalkan. Lunasi sisa tagihan lalu selesaikan.';
    if (error.code === 'OPEN_BILL_SPLIT_EMPTY') return 'Sisakan minimal satu item di bill asal; pindahkan sebagian item saja.';
    if (error.code === 'OPEN_BILL_SPLIT_HAS_DEPOSIT') return 'Bill yang sudah ada DP tidak bisa di-split. Gunakan "Bagi rata" saat pembayaran.';
    if (error.code === 'OPEN_BILL_HAS_ADJUSTMENTS') return `Hapus diskon, pajak, dan service charge dari ${details.orderNumber ?? 'bill ini'} terlebih dahulu.`;
    if (error.code === 'SPLIT_QUANTITY_EXCEEDED') return `Jumlah yang dipindah melebihi jumlah di bill${details.onBill ? ` (maksimal ${Number(details.onBill)})` : ''}. Buka ulang bill lalu coba lagi.`;
    if (error.code === 'INVALID_SPLIT_QUANTITY') return 'Jumlah item yang dipindah harus lebih dari 0.';
    if (error.code === 'OPEN_BILL_MERGE_MISMATCH') return MERGE_MISMATCH_MESSAGE;
    if (error.code === 'OPEN_BILL_MERGE_SAME') return 'Bill tidak bisa digabung dengan dirinya sendiri.';
  }
  return error instanceof Error ? error.message : fallback;
}
const money = (amount: number) => `Rp ${Math.max(0, amount).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
/** Stand-in for a bill line whose product left the catalog, so the line can still be shown and sent back unchanged. */
const offCatalogProduct = (item: BillItem): Product => ({ id: item.productId, sku: '', name: item.productNameSnapshot, basePrice: '0', available: '0', trackInventory: false, sellingUnits: [], variants: [], addons: [] });

export default function PosScreen() {
  const { user, authorizedRequest, signOut } = useAuth();
  const { refresh: refreshNotifications, openBillCount } = useNotifications();
  const insets = useSafeAreaInsets();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branchId, setBranchId] = useState(user?.branchId ?? '');
  const [warehouseId, setWarehouseId] = useState('');
  const [cart, setCart] = useState<Line[]>([]);
  const [optionProduct, setOptionProduct] = useState<Product | null>(null);
  const [optionVariant, setOptionVariant] = useState('');
  const [optionUnit, setOptionUnit] = useState('');
  const [optionAddons, setOptionAddons] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [discount, setDiscount] = useState('0');
  const [method, setMethod] = useState<Method>('CASH');
  const [productsLoading, setProductsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  const [printer, setPrinter] = useState<PairedPrinter | null>(null);
  const [printerPickerVisible, setPrinterPickerVisible] = useState(false);
  const [printerDevices, setPrinterDevices] = useState<PairedPrinter[]>([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printAfterPrinterSelection, setPrintAfterPrinterSelection] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [cartVisible, setCartVisible] = useState(false);
  const [paymentStep, setPaymentStep] = useState(false);
  // Dine in by default; sent with the order and restored when a bill is loaded.
  const [takeaway, setTakeaway] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [displayOnly, setDisplayOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [warehouseReloadKey, setWarehouseReloadKey] = useState(0);
  const loadedWarehouseId = useRef('');
  // Warehouse whose catalog is in `products`; unlike the ref above it re-renders, so a pending bill can wait for it.
  const [catalogWarehouseId, setCatalogWarehouseId] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [openBill, setOpenBill] = useState<LoadedBill | null>(null);
  // A bill fetched from the list that waits for its branch/warehouse catalog before it fills the cart.
  const [pendingBill, setPendingBill] = useState<{ bill: BillOrder; message: string } | null>(null);
  const [billSheetVisible, setBillSheetVisible] = useState(false);
  const [billListVisible, setBillListVisible] = useState(false);
  const [billBusy, setBillBusy] = useState(false);
  const [billError, setBillError] = useState('');
  const [billLoadingId, setBillLoadingId] = useState('');
  const [notice, setNotice] = useState('');
  // Non-blocking stock shortages reported by the last open bill save.
  const [warning, setWarning] = useState('');
  // Sent line picked for a void, and the slip (kitchen ticket, pre-bill or DP receipt) waiting for its printer/preview.
  const [voidTarget, setVoidTarget] = useState<Line | null>(null);
  const [voidError, setVoidError] = useState('');
  // Slips (kitchen/bar tickets, pre-bill, DP receipt) wait in a queue and are previewed and printed one at a time.
  const [slipQueue, setSlipQueue] = useState<Slip[]>([]);
  const slip = slipQueue[0] ?? null;
  const [slipPreviewVisible, setSlipPreviewVisible] = useState(false);
  // Per-device printers for bar and kitchen tickets (null = the receipt printer) and the printer the picker is choosing.
  const [stationPrinters, setStationPrinters] = useState<Record<Station, PairedPrinter | null>>({ BAR: null, KITCHEN: null });
  const [printerTarget, setPrinterTarget] = useState<PrinterTarget>('receipt');
  const [printSettingsVisible, setPrintSettingsVisible] = useState(false);
  // The printer picker was opened from the print settings, which reopen once it closes.
  const [settingsAfterPick, setSettingsAfterPick] = useState(false);
  // "Cetak tiket bar/dapur setelah bayar" for quick sales, remembered on this device.
  const [quickSaleTickets, setQuickSaleTickets] = useState(false);
  // "Bagi rata": one method per person paying an equal share; null pays the whole balance with `method`.
  const [splitMethods, setSplitMethods] = useState<Method[] | null>(null);
  // Lines of the saved bill offered in the split sheet (null = sheet closed), and the last split for "Buka bill baru".
  const [splitLines, setSplitLines] = useState<SplitSourceLine[] | null>(null);
  const [splitError, setSplitError] = useState('');
  const [splitNotice, setSplitNotice] = useState<{ message: string; partId: string; orderNumber: string } | null>(null);
  const [mergeListVisible, setMergeListVisible] = useState(false);
  // The payment step takes a deposit (DP) on the loaded bill instead of paying it off.
  const [depositMode, setDepositMode] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  // "Batalkan Bill dengan DP" for a loaded bill whose deposit is already in a cash closing.
  const [settleVisible, setSettleVisible] = useState(false);
  const [settleError, setSettleError] = useState('');
  // Registered customer on the current sale (null = Guest); it never outlives the sale or the branch/warehouse.
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [customerPickerVisible, setCustomerPickerVisible] = useState(false);
  const can = (permission: string) => user?.permissions.includes(permission) ?? false;
  // The dashboard deep-links here with ?openBillId= (load that bill) or ?openBillList=1 (show the list).
  const params = useLocalSearchParams<{ openBillId?: string; openBillList?: string }>();

  useEffect(() => {
    let active = true;
    void getSavedPrinter().then((saved) => { if (active) setPrinter(saved); });
    void Promise.all([getStationPrinter('BAR'), getStationPrinter('KITCHEN')]).then(([bar, kitchen]) => { if (active) setStationPrinters({ BAR: bar, KITCHEN: kitchen }); }).catch(() => undefined);
    void getQuickSaleTickets().then((enabled) => { if (active) setQuickSaleTickets(enabled); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void authorizedRequest<{ data: Branch[] }>('catalog/branches?page=1&perPage=100')
      .then((result) => { if (active) { setBranches(result.data); if (!branchId && result.data[0]) setBranchId(result.data[0].id); } })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  // Initial branch options are loaded once; the user-scoped branch is stable for this session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizedRequest]);

  useEffect(() => {
    if (!branchId) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWarehouseId(''); setProducts([]); loadedWarehouseId.current = '';
    void authorizedRequest<{ data: Warehouse[] }>('catalog/warehouses?page=1&perPage=100')
      .then((result) => { if (!active) return; const choices = result.data.filter((row) => row.branchId === branchId); setWarehouses(choices); if (choices[0]) setWarehouseId(choices[0].id); else setProductsLoading(false); })
      .catch((e: Error) => { if (active) { setError(e.message); setProductsLoading(false); } })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [branchId, warehouseReloadKey, authorizedRequest]);

  useEffect(() => {
    if (!warehouseId) return;
    let active = true;
    // Keep the current catalog on screen during a refresh; only clear it when the warehouse changes.
    if (loadedWarehouseId.current !== warehouseId) {
      setProducts([]); setProductsLoading(true);
    }
    void authorizedRequest<Product[]>(`pos/catalog?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((rows) => { if (active) { setProducts(rows); setError(''); loadedWarehouseId.current = warehouseId; setCatalogWarehouseId(warehouseId); } })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) { setProductsLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [warehouseId, reloadKey, authorizedRequest]);

  function refreshCatalog() {
    setRefreshing(true);
    if (warehouseId) setReloadKey((value) => value + 1);
    else setWarehouseReloadKey((value) => value + 1);
  }

  const categories = useMemo(() => ['Semua', ...new Set(products.map((product) => product.category?.name).filter((name): name is string => Boolean(name)))], [products]);
  // A category from a previous catalog may no longer exist; fall back to "Semua" instead of showing an empty grid.
  const activeCategory = categories.includes(selectedCategory) ? selectedCategory : 'Semua';
  const visible = useMemo(() => products.filter((p) => (!displayOnly || Number(p.displayQuantity ?? 0) > 0) && (activeCategory === 'Semua' || p.category?.name === activeCategory) && `${p.name} ${p.sku} ${p.barcode ?? ''} ${p.category?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())), [activeCategory, displayOnly, products, search]);
  // Add-ons loaded from a bill keep their stored quantity; add-ons picked in the POS count once per item.
  const addonQuantity = (line: Line, addonId: string) => Number(line.bill?.addons.find((addon) => addon.addonId === addonId)?.quantity ?? 1);
  // A bill line left unchanged keeps its stored price on the server; anything else is priced from the catalog.
  const priceFor = (line: Line) => line.bill && line.quantity === line.bill.quantity ? line.bill.total / line.bill.quantity : Number(line.product.sellingUnits.find((unit) => unit.unitId === line.unitId)?.sellingPrice ?? line.product.basePrice) + Number(line.product.variants?.find((v) => v.id === line.variantId)?.priceDelta ?? 0) + line.addonIds.reduce((sum, id) => sum + Number(line.product.addons?.find((a) => a.id === id)?.basePrice ?? 0) * addonQuantity(line, id), 0);
  const subtotal = cart.reduce((sum, line) => sum + priceFor(line) * line.quantity, 0);
  const discountAmount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = subtotal - discountAmount;

  function conversionFactor(product: Product, unitId: string) {
    return Number(product.sellingUnits.find((unit) => unit.unitId === unitId)?.conversionFactor ?? 1);
  }
  function canAddUnit(product: Product, unitId = product.unit?.id ?? product.sellingUnits[0]?.unitId ?? '') {
    if (!product.trackInventory) return true;
    const usedBaseQuantity = cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity * conversionFactor(product, line.unitId), 0);
    return usedBaseQuantity + conversionFactor(product, unitId) <= Math.max(Number(product.available) || 0, 0) + 0.000001;
  }
  function reportStockLimit(product: Product, unitId: string) {
    const usedBaseQuantity = cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity * conversionFactor(product, line.unitId), 0);
    const remainingBaseQuantity = Math.max(Number(product.available) - usedBaseQuantity, 0);
    const maxUnitQuantity = remainingBaseQuantity / conversionFactor(product, unitId);
    const unit = product.sellingUnits.find((entry) => entry.unitId === unitId)?.unit.code ?? product.unit?.code ?? '';
    setError(`Stok ${product.name} tidak cukup. Sisa maksimal ${maxUnitQuantity.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${unit}.`);
  }

  function add(product: Product) {
    if ((product.sellingUnits?.length ?? 0) > 1 || (product.variants?.length ?? 0) > 0 || (product.addons?.length ?? 0) > 0) {
      setOptionProduct(product); setOptionUnit(product.sellingUnits[0]?.unitId ?? product.unit?.id ?? ''); setOptionVariant(''); setOptionAddons([]); setError('');
      return;
    }
    addConfigured(product, product.sellingUnits[0]?.unitId ?? product.unit?.id ?? '', '', []);
  }
  function addConfigured(product: Product, unitId: string, variantId: string, addonIds: string[]) {
    if (!canAddUnit(product, unitId)) { reportStockLimit(product, unitId); return; }
    const key = `${product.id}:${unitId}:${variantId}:${[...addonIds].sort().join(',')}`;
    setError(''); setNotice('');
    setCart((current) => {
      const found = current.find((line) => line.key === key);
      return found ? current.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { key, product, unitId, quantity: 1, variantId, addonIds }];
    });
  }
  function quantity(lineKey: string, delta: number) {
    const line = cart.find((entry) => entry.key === lineKey);
    if (line?.bill?.sentAt) { setError(`${line.product.name} sudah dikirim ke dapur sehingga tidak bisa diubah. Tambahkan sebagai item baru, atau void untuk mengurangi.`); return; }
    if (line?.bill?.missing && line.quantity + delta > 0) { setError(`${line.product.name} tidak ada di katalog gudang ini; jumlahnya tidak bisa diubah, hanya bisa dihapus.`); return; }
    if (delta > 0 && line && !canAddUnit(line.product, line.unitId)) { reportStockLimit(line.product, line.unitId); return; }
    setError('');
    setCart((current) => current.flatMap((line) => line.key !== lineKey ? [line] : line.quantity + delta <= 0 ? [] : [{ ...line, quantity: line.quantity + delta }]));
  }
  /**
   * Cart lines as order items. For an open bill update, lines loaded from the bill carry their orderItemId and stored
   * note/add-on quantities, so unchanged lines are kept exactly as saved (price included, even for off-catalog products).
   */
  const orderItems = (billUpdate = false) => cart.map((line) => ({
    ...(billUpdate && line.bill ? { orderItemId: line.bill.orderItemId } : {}),
    productId: line.product.id, unitId: line.unitId || undefined, variantId: line.variantId || undefined, quantity: String(line.quantity),
    ...(line.bill?.note ? { note: line.bill.note } : {}),
    addons: line.bill ? line.bill.addons : line.addonIds.map((addonId) => ({ addonId, quantity: '1' })),
  }));
  const serviceType = serviceTypeOf(takeaway);
  const openBillDirty = Boolean(openBill) && cartSignature(cart, discount, customer, selectedCustomer?.id ?? '', serviceType) !== openBill?.signature;

  /** Empties the cart and forgets the loaded open bill (the bill itself stays saved on the server). */
  function resetCart() {
    setCart([]); setPendingOrder(null); setOpenBill(null); setPaymentStep(false); setTakeaway(false); setCustomer(''); setCustomerPhone(''); setDiscount('0'); setSelectedCustomer(null); setDepositMode(false); setSplitMethods(null);
  }

  /** Attaches a registered customer; the sale is filed under its name (and phone, when it has one). */
  function selectCustomer(picked: PosCustomer) {
    setSelectedCustomer(picked); setCustomer(picked.name); setError('');
    if (picked.phone) setCustomerPhone(picked.phone);
  }

  /** Back to Guest: forgets the selected customer and the name/phone that came from it. The cart is kept. */
  function detachCustomer() {
    if (!selectedCustomer) return;
    setSelectedCustomer(null); setCustomer('');
    if (selectedCustomer.phone) setCustomerPhone('');
  }

  /** A customer belongs to one branch, so it is dropped when the cashier switches branch or warehouse. */
  function switchLocation(apply: () => void) {
    if (selectedCustomer) { detachCustomer(); setNotice(`Customer ${selectedCustomer.name} dilepas karena cabang/gudang berganti.`); }
    apply();
  }

  /** Keeps the cart and the typed name, but drops a customer the server no longer accepts for this branch. */
  function handleCustomerUnavailable(e: unknown) {
    const denied = e instanceof ApiError && e.code === 'PERMISSION_DENIED' && Boolean(selectedCustomer);
    if (!isCustomerUnavailable(e) && !denied) return false;
    setSelectedCustomer(null);
    return true;
  }

  async function checkout() {
    if (!customer.trim()) return setError('Nama pelanggan wajib diisi.');
    if (total <= 0) return setError('Total pembayaran harus lebih dari Rp 0.');
    if (!branchId || !warehouseId) return setError('Pilih cabang dan gudang terlebih dahulu.');
    setSubmitting(true); setError(''); setNotice(''); setWarning('');
    // Station tickets after paying are only for quick sales; an open bill sends its items with "Kirim ke Dapur".
    const quickSale = !openBill;
    try {
      let order = pendingOrder;
      if (!order && openBill) {
        // A loaded bill is paid as-is; unsaved cart changes are saved to it first instead of creating a new order.
        order = openBillDirty ? await updateOpenBill(openBill, customer.trim(), openBill.customerPhone) : await authorizedRequest<Order>(`orders/${openBill.id}`);
        if (!order) return;
        setPendingOrder(order);
      }
      if (!order) {
        order = await authorizedRequest<Order>('orders', { method: 'POST', body: JSON.stringify({ branchId, warehouseId, ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}), customerName: customer.trim(), serviceType, discountAmount: String(discountAmount), items: orderItems() }) });
        setPendingOrder(order);
      }
      // A deposit (DP) already taken on an open bill is kept; only the remaining balance is paid now.
      const due = Math.max(0, Number(order.grandTotal) - paidTotalOf(order));
      // "Bagi rata" pays the same balance as one payment per person, each with its own method.
      const shares = splitMethods && due >= splitMethods.length ? equalShares(due, splitMethods.length).map((amount, index) => ({ method: splitMethods[index], amount })) : [{ method, amount: due }];
      const payments = shares.map((share) => ({ method: share.method, amount: String(share.amount), ...(share.method === 'CASH' ? { receivedAmount: String(share.amount) } : {}) }));
      const paid = order.status === 'PAID' ? order : await authorizedRequest<Order>(`orders/${order.id}/pay`, { method: 'POST', body: JSON.stringify({ payments }) });
      setPendingOrder(paid);
      const completed = await authorizedRequest<Order>(`orders/${paid.id}/complete`, { method: 'POST' });
      setReceipt(completed); resetCart(); setCartVisible(false);
      // Stock changed on the server; reload the catalog so the next order sees current availability.
      setReloadKey((value) => value + 1);
      void refreshNotifications();
      // KITCHEN-HIDDEN: if (quickSale && quickSaleTickets) printStationTickets(completed, completed.items ?? [], completed.completedAt ?? new Date().toISOString());
    } catch (e) {
      // A failed checkout keeps the customer for the retry, unless the server rejected the customer itself.
      if (handleCustomerUnavailable(e)) setError(customerErrorMessage(e));
      else if (openBill && e instanceof ApiError && e.code !== 'PERMISSION_DENIED') setError(openBillErrorMessage(e, 'Transaksi gagal.'));
      else setError(e instanceof Error ? e.message : 'Transaksi gagal.');
    }
    finally { setSubmitting(false); }
  }

  /**
   * Replaces the cart of a loaded open bill. Returns null when the bill was changed on another device:
   * the latest version is then reloaded into the cart for the cashier to check before saving again.
   */
  async function updateOpenBill(bill: LoadedBill, name: string, phone: string) {
    // customerId: a string links/changes the customer, null detaches it (guest bill), omitted keeps the current link.
    const customerId = selectedCustomer?.id ?? null;
    const link = customerId === bill.customerId ? {} : { customerId };
    try {
      const updated = await authorizedRequest<Order & { version: number; customerId?: string | null; stockWarnings?: StockShortage[] }>(`orders/${bill.id}/open-bill`, { method: 'PUT', body: JSON.stringify({ version: bill.version, ...link, customerName: name, customerPhone: phone, serviceType, discountAmount: String(discountAmount), items: orderItems(true) }) });
      const savedName = updated.customerName ?? name;
      const savedCustomerId = updated.customerId === undefined ? customerId : updated.customerId;
      setCustomer(savedName); setCustomerPhone(updated.customerPhone ?? phone);
      // The bill snapshots the customer's current name, which may have been edited since it was picked.
      if (selectedCustomer && savedCustomerId === selectedCustomer.id) setSelectedCustomer({ ...selectedCustomer, name: savedName });
      setOpenBill({ ...bill, customerName: savedName, customerPhone: updated.customerPhone ?? phone, customerId: savedCustomerId, version: updated.version, signature: cartSignature(cart, discount, savedName, savedCustomerId ?? '', serviceType) });
      return updated;
    } catch (e) {
      if (!isVersionConflict(e)) throw e;
      setBillSheetVisible(false);
      void loadOpenBill(bill.id, VERSION_CONFLICT_MESSAGE);
      return null;
    }
  }

  /** Saves pending cart edits of the loaded bill and returns the version to act on; null after a reload (version conflict). */
  /** Also null when the save brought the total down to the deposit: the bill is then PAID and only needs completing. */
  async function saveBeforeBillAction(bill: LoadedBill) {
    if (!openBillDirty) return { version: bill.version, stockWarnings: undefined };
    const saved = await updateOpenBill(bill, customer.trim() || bill.customerName, bill.customerPhone);
    if (saved?.status === 'PAID') { settlePaidBill(saved); return null; }
    return saved ? { version: saved.version, stockWarnings: saved.stockWarnings } : null;
  }

  /**
   * The bill is fully covered by its deposits (a DP, or an edit/void that brought the total down to the DP) and the server
   * locked it as PAID. It is kept as the pending order, so "Bayar" only completes it (no payment is sent) and shows the receipt.
   */
  function settlePaidBill(order: Order, message = 'Total bill sudah tertutup DP, jadi bill sudah lunas. Tekan Bayar untuk menyelesaikan transaksi.') {
    setPendingOrder(order); setOpenBill((current) => current && { ...current, paidTotal: paidTotalOf(order), payments: order.payments });
    setDepositMode(false); setPaymentStep(true); setCartVisible(true); setNotice(message);
  }

  /** "Kirim ke Dapur": saves the bill if it changed, marks its unsent lines as sent and prints one ticket per station (bar, kitchen). */
  async function sendToKitchen() {
    const bill = openBill;
    if (!bill) return;
    setBillBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      const saved = await saveBeforeBillAction(bill);
      if (!saved) return;
      const sent = await authorizedRequest<BillOrder & { sentItems: BillItem[] }>(`orders/${bill.id}/open-bill/send`, { method: 'POST', body: JSON.stringify({ version: saved.version }) });
      // The response has every line with its id and sentAt, so the cart is rebuilt from it.
      applyOpenBill(sent, '', `${sent.sentItems.length} item dikirim ke ${sent.sentItems.some((item) => item.product?.category?.station === 'BAR') ? 'bar/dapur' : 'dapur'}.`);
      setWarning(stockWarningText(saved.stockWarnings));
      if (sent.sentItems.length) printStationTickets(sent, sent.sentItems, sent.sentItems[0].sentAt ?? new Date().toISOString());
    } catch (e) {
      if (isVersionConflict(e)) { void loadOpenBill(bill.id, VERSION_CONFLICT_MESSAGE); return; }
      handleCustomerUnavailable(e); setError(openBillErrorMessage(e, 'Item gagal dikirim ke dapur.'));
    } finally { setBillBusy(false); }
  }

  /**
   * Voids a sent line fully (no quantity) or partly; needs order.void_item. Blocked while the cart has unsaved edits, so the
   * cashier saves them knowingly first instead of having them saved as a side effect of a void.
   */
  async function voidLine(line: Line, quantity: string | undefined, reason: string) {
    const bill = openBill;
    if (!bill || !line.bill) return;
    if (openBillDirty) { setVoidError(VOID_BLOCKED_MESSAGE); return; }
    setBillBusy(true); setVoidError(''); setError(''); setNotice(''); setWarning('');
    try {
      const updated = await authorizedRequest<BillOrder>(`orders/${bill.id}/items/${line.bill.orderItemId}/void`, { method: 'POST', body: JSON.stringify({ version: bill.version, ...(quantity ? { quantity } : {}), reason }) });
      setVoidTarget(null);
      applyOpenBill(updated, '', `${line.product.name} × ${Number(quantity ?? line.quantity)} di-void.`);
      // The void brought the total down to the deposit: the cart shows the repriced bill, which now only needs completing.
      if (updated.status === 'PAID') settlePaidBill(updated, `${line.product.name} × ${Number(quantity ?? line.quantity)} di-void. Total bill sudah tertutup DP, tekan Bayar untuk menyelesaikan transaksi.`);
    } catch (e) {
      if (isVersionConflict(e)) { setVoidTarget(null); void loadOpenBill(bill.id, VERSION_CONFLICT_MESSAGE); return; }
      setVoidError(e instanceof ApiError && e.status === 403 ? 'Akun ini belum memiliki izin void item.' : openBillErrorMessage(e, 'Item gagal di-void.'));
    } finally { setBillBusy(false); }
  }

  /** "Cetak Tagihan": saves the bill if it changed, records the print on the server (which numbers reprints) and prints the pre-bill. */
  async function printPreBill() {
    const bill = openBill;
    if (!bill) return;
    setBillBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      const saved = await saveBeforeBillAction(bill);
      if (!saved) return;
      setWarning(stockWarningText(saved.stockWarnings));
      const preBill = await authorizedRequest<PreBill>(`orders/${bill.id}/pre-bill`, { method: 'POST' });
      setNotice(preBill.preBillPrintCount > 1 ? `Tagihan ${preBill.orderNumber} dicetak ulang (ke-${preBill.preBillPrintCount}).` : `Tagihan ${preBill.orderNumber} siap dicetak.`);
      void printSlip({ title: `Tagihan ${preBill.orderNumber}`, text: formatPreBill(preBill, user?.name ?? 'Kasir') }, 'Tagihan gagal dicetak.');
    } catch (e) {
      if (isVersionConflict(e)) { void loadOpenBill(bill.id, VERSION_CONFLICT_MESSAGE); return; }
      handleCustomerUnavailable(e); setError(openBillErrorMessage(e, 'Tagihan gagal dicetak.'));
    } finally { setBillBusy(false); }
  }

  /** Opens the payment step in DP mode for the loaded bill. */
  function startDeposit() {
    setDepositMode(true); setDepositAmount(''); setError(''); setNotice(''); setPaymentStep(true);
  }

  /**
   * "Terima DP": takes part of the bill now. The bill stays open (still editable, still in the open bill list) and the
   * cart is refreshed from the server; paying the full balance is the normal "Bayar" instead.
   */
  async function receiveDeposit() {
    const bill = openBill;
    if (!bill) return;
    const amount = Number(depositAmount) || 0;
    const due = total - (bill.paidTotal ?? 0);
    if (amount <= 0) return setError('Jumlah DP wajib diisi dan lebih dari Rp 0.');
    if (amount >= due) return setError(`DP harus kurang dari sisa tagihan ${money(due)}. Untuk melunasi, gunakan Bayar.`);
    setSubmitting(true); setError(''); setNotice(''); setWarning('');
    try {
      // The deposit is checked against the saved bill, so pending cart edits are saved first.
      const saved = await saveBeforeBillAction(bill);
      if (!saved) return;
      setWarning(stockWarningText(saved.stockWarnings));
      const payment = { method, amount: String(amount), ...(method === 'CASH' ? { receivedAmount: String(amount) } : {}) };
      const updated = await authorizedRequest<BillOrder>(`orders/${bill.id}/pay`, { method: 'POST', body: JSON.stringify({ payments: [payment] }) });
      const paidTotal = paidTotalOf(updated);
      setDepositMode(false); setDepositAmount('');
      if (updated.status !== 'OPEN') {
        // The deposit settled the whole bill after all; it is now locked and only needs completing via "Bayar".
        settlePaidBill(updated, `DP ${money(amount)} diterima dan bill sudah lunas. Tekan Bayar untuk menyelesaikan transaksi.`);
      } else {
        applyOpenBill(updated, '', `DP ${money(amount)} diterima. Sisa tagihan ${money(Number(updated.grandTotal) - paidTotal)}.`);
      }
      void refreshNotifications();
      void printSlip({ title: `Bukti DP ${updated.orderNumber}`, text: formatDepositReceipt({ order: updated, payment, paidTotal, cashierName: user?.name ?? 'Kasir', paidAt: new Date().toISOString() }) }, 'Bukti DP gagal dicetak.');
    } catch (e) {
      if (isVersionConflict(e)) { setDepositMode(false); void loadOpenBill(bill.id, VERSION_CONFLICT_MESSAGE); return; }
      handleCustomerUnavailable(e); setError(openBillErrorMessage(e, 'DP gagal diterima.'));
    } finally { setSubmitting(false); }
  }

  /** One ticket per station (bar, kitchen) that has lines, each printed on that station's printer. */
  function printStationTickets(order: Pick<Order, 'orderNumber' | 'customerName' | 'customerPhone' | 'serviceType'>, items: KitchenTicket['items'], sentAt: string) {
    const tickets = stationTickets({ orderNumber: order.orderNumber, customerName: order.customerName, customerPhone: order.customerPhone, serviceType: order.serviceType, sentAt }, items);
    void printSlip(tickets.map((ticket) => ({ title: `Tiket ${stationLabel(ticket.station).toLowerCase()} ${order.orderNumber}`, text: formatKitchenTicket(ticket), station: ticket.station })), 'Tiket bar/dapur gagal dicetak.');
  }

  /**
   * "Split Bill": saves pending edits, reloads the bill so every line has its id (the split refers to saved lines), then
   * opens the split sheet. Bills with a deposit or a discount cannot be split, so those are stopped here already.
   */
  async function startSplit() {
    const bill = openBill;
    if (!bill) return;
    if (bill.paidTotal) { setError('Bill yang sudah ada DP tidak bisa di-split. Gunakan "Bagi rata" saat pembayaran.'); return; }
    if (discountAmount > 0) { setError('Hapus diskon bill terlebih dahulu sebelum split.'); return; }
    setBillBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      const saved = await saveBeforeBillAction(bill);
      if (!saved) return;
      const fresh = await authorizedRequest<BillOrder>(`orders/${bill.id}`);
      if (fresh.status !== 'OPEN') { setError(`Bill ${fresh.orderNumber} sudah tidak bisa diubah (${formatStatus(fresh.status)}).`); return; }
      applyOpenBill(fresh, '');
      setWarning(stockWarningText(saved.stockWarnings));
      setSplitError('');
      setSplitLines((fresh.items ?? []).map((item) => ({
        id: item.id, name: item.productNameSnapshot, variant: item.variantNameSnapshot ?? null, quantity: Number(item.inputQuantity ?? item.quantity), unit: item.unit?.code ?? null,
        total: Number(item.totalPrice), sent: Boolean(item.sentAt), addons: (item.addons ?? []).map((addon) => `${addon.addonNameSnapshot}${Number(addon.quantity) > 1 ? ` x${Number(addon.quantity)}` : ''}`),
      })));
    } catch (e) {
      if (isVersionConflict(e)) { void loadOpenBill(bill.id, VERSION_CONFLICT_MESSAGE); return; }
      handleCustomerUnavailable(e); setError(openBillErrorMessage(e, 'Bill gagal disiapkan untuk split.'));
    } finally { setBillBusy(false); }
  }

  /** Moves the picked lines to a new open bill; the original stays loaded (refreshed) and the new one can be opened next. */
  async function submitSplit(part: SplitPart) {
    const bill = openBill;
    if (!bill) return;
    setBillBusy(true); setSplitError('');
    try {
      const result = await authorizedRequest<{ original: BillOrder; parts: BillOrder[] }>(`orders/${bill.id}/split`, { method: 'POST', body: JSON.stringify({ version: bill.version, parts: [part] }) });
      const created = result.parts[0];
      const message = `Bill baru ${created.orderNumber} dibuat (${money(Number(created.grandTotal))}).`;
      setSplitLines(null);
      applyOpenBill(result.original, '', message);
      setSplitNotice({ message, partId: created.id, orderNumber: created.orderNumber });
      void refreshNotifications();
    } catch (e) {
      if (isVersionConflict(e)) { setSplitLines(null); void loadOpenBill(bill.id, VERSION_CONFLICT_MESSAGE); return; }
      setSplitError(openBillErrorMessage(e, 'Bill gagal di-split.'));
    } finally { setBillBusy(false); }
  }

  /** "Gabung Bill": saves pending edits first, then lists the other open bills to bring into this one. */
  async function startMerge() {
    const bill = openBill;
    if (!bill) return;
    setBillBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      const saved = await saveBeforeBillAction(bill);
      if (!saved) return;
      setWarning(stockWarningText(saved.stockWarnings));
      setMergeListVisible(true);
    } catch (e) {
      if (isVersionConflict(e)) { void loadOpenBill(bill.id, VERSION_CONFLICT_MESSAGE); return; }
      handleCustomerUnavailable(e); setError(openBillErrorMessage(e, 'Bill gagal disimpan sebelum digabung.'));
    } finally { setBillBusy(false); }
  }

  /** Fetches the picked bill (for its version and deposit) and asks before merging it into the loaded one. */
  async function pickMergeSource(row: OpenBillRow) {
    const bill = openBill;
    if (!bill) return;
    setBillLoadingId(row.id);
    try {
      const source = await authorizedRequest<BillOrder>(`orders/${row.id}`);
      if (source.status !== 'OPEN') { setMergeListVisible(false); setError(`Bill ${source.orderNumber} sudah tidak bisa digabung (${formatStatus(source.status)}).`); return; }
      if (source.branchId !== branchId || source.warehouseId !== warehouseId) { setMergeListVisible(false); setError(MERGE_MISMATCH_MESSAGE); return; }
      const deposit = paidTotalOf(source);
      const summary = [source.customerName, money(Number(source.grandTotal)), deposit > 0 ? `DP ${money(deposit)}` : ''].filter(Boolean).join(', ');
      Alert.alert('Gabung bill?', `Gabungkan ${source.orderNumber} (${summary}) ke bill ini?\n\nSemua item${deposit > 0 ? ' dan DP' : ''} pindah ke ${bill.orderNumber}, lalu ${source.orderNumber} ditutup.`, [
        { text: 'Kembali', style: 'cancel' },
        { text: 'Gabungkan', onPress: () => void mergeBill(bill, source) },
      ]);
    } catch (e) { setMergeListVisible(false); setError(e instanceof Error ? e.message : 'Bill gagal dimuat.'); }
    finally { setBillLoadingId(''); }
  }

  async function mergeBill(bill: LoadedBill, source: BillOrder) {
    setMergeListVisible(false); setBillBusy(true); setError(''); setNotice(''); setWarning('');
    try {
      const merged = await authorizedRequest<BillOrder>(`orders/${bill.id}/merge`, { method: 'POST', body: JSON.stringify({ version: bill.version, sourceOrderId: source.id, sourceVersion: source.version }) });
      applyOpenBill(merged, '', `Bill ${source.orderNumber} digabung ke bill ini. Total sekarang ${money(Number(merged.grandTotal))}.`);
      void refreshNotifications();
    } catch (e) {
      if (isVersionConflict(e)) { void loadOpenBill(bill.id, 'Salah satu bill sudah diubah di perangkat lain. Data terbaru sudah dimuat ulang, coba gabungkan lagi.'); return; }
      setError(openBillErrorMessage(e, 'Bill gagal digabung.'));
    } finally { setBillBusy(false); }
  }

  async function saveOpenBill(name: string, phone: string) {
    if (!cart.length) return setBillError('Keranjang masih kosong.');
    if (!branchId || !warehouseId) return setBillError('Pilih cabang dan gudang terlebih dahulu.');
    setBillBusy(true); setBillError(''); setWarning('');
    try {
      const saved = openBill
        ? await updateOpenBill(openBill, name, phone)
        : await authorizedRequest<Order & { stockWarnings?: StockShortage[] }>('orders', { method: 'POST', body: JSON.stringify({ branchId, warehouseId, openBill: true, ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}), customerName: name, customerPhone: phone, serviceType, discountAmount: String(discountAmount), items: orderItems() }) });
      if (!saved) return;
      if (saved.status === 'PAID') { setBillSheetVisible(false); settlePaidBill(saved); return; }
      // The bill is parked on the server; the cart is cleared for the next customer.
      resetCart(); setBillSheetVisible(false); setCartVisible(false); setError('');
      setNotice(`Open bill ${saved.orderNumber} atas nama ${saved.customerName ?? name} disimpan.`);
      // Short stock does not block saving (payment re-checks it), but the cashier should know now.
      setWarning(stockWarningText(saved.stockWarnings));
      void refreshNotifications();
    } catch (e) { handleCustomerUnavailable(e); setBillError(openBillErrorMessage(e)); }
    finally { setBillBusy(false); }
  }

  /** Fetches a bill and queues it; the effect below fills the cart once its warehouse catalog is loaded. */
  async function loadOpenBill(id: string, message = '') {
    setBillLoadingId(id); setError(''); setNotice(''); setWarning('');
    try {
      const bill = await authorizedRequest<BillOrder>(`orders/${id}`);
      if (bill.status !== 'OPEN') { setBillListVisible(false); setError(`Bill ${bill.orderNumber} sudah tidak bisa diubah (${formatStatus(bill.status)}).`); return; }
      setBillListVisible(false);
      if (bill.branchId !== branchId) setBranchId(bill.branchId);
      setPendingBill({ bill, message });
    } catch (e) { setBillListVisible(false); setError(e instanceof Error ? e.message : 'Open bill gagal dimuat.'); }
    finally { setBillLoadingId(''); }
  }

  function selectOpenBill(row: Pick<OpenBillRow, 'id' | 'orderNumber'>) {
    if (row.id === openBill?.id) { setBillListVisible(false); setCartVisible(true); return; }
    if (!cart.length || (openBill && !openBillDirty)) { void loadOpenBill(row.id); return; }
    Alert.alert('Ganti isi keranjang?', `Pesanan di keranjang yang belum disimpan akan diganti dengan bill ${row.orderNumber}.`, [
      { text: 'Kembali', style: 'cancel' },
      { text: 'Ganti', onPress: () => void loadOpenBill(row.id) },
    ]);
  }

  /** Fills the cart from a bill; `message` is shown as an error (e.g. after a reload), `success` as a notice. */
  function applyOpenBill(bill: BillOrder, message: string, success = '') {
    // Every bill line stays its own cart line with its identity, so unchanged lines are kept as stored on the next save.
    // Lines whose product left this warehouse's catalog are kept too, read-only, instead of refusing the whole bill.
    const lines: Line[] = (bill.items ?? []).map((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      // POS lines count in the selling unit, which the server keeps as inputQuantity.
      const lineQuantity = Number(item.inputQuantity ?? item.quantity);
      const addons = (item.addons ?? []).map((addon) => ({ addonId: addon.addonId, quantity: String(Number(addon.quantity)) }));
      return {
        key: `bill:${item.id}`, product: product ?? offCatalogProduct(item), unitId: item.unitId ?? '', quantity: lineQuantity, variantId: item.variantId ?? '', addonIds: addons.map((addon) => addon.addonId),
        bill: { orderItemId: item.id, quantity: lineQuantity, note: item.note ?? null, addons, total: Number(item.totalPrice), variantName: item.variantNameSnapshot ?? null, sentAt: item.sentAt ?? null, missing: !product },
      };
    });
    const billDiscount = String(Number(bill.discountAmount) || 0);
    const name = bill.customerName ?? '';
    const customerId = bill.customerId ?? null;
    // Older bills have no service type; they load as Dine in, the default.
    const billTakeaway = bill.serviceType === 'TAKEAWAY';
    setCart(lines); setDiscount(billDiscount); setCustomer(name); setCustomerPhone(bill.customerPhone ?? ''); setPendingOrder(null); setPaymentStep(false); setTakeaway(billTakeaway); setSplitMethods(null);
    setSelectedCustomer(customerId ? { id: customerId, name, phone: bill.customerPhone } : null);
    setOpenBill({ id: bill.id, orderNumber: bill.orderNumber, customerName: name, customerPhone: bill.customerPhone ?? '', itemVoids: bill.itemVoids ?? [], paidTotal: paidTotalOf(bill), payments: bill.payments, customerId, version: bill.version, signature: cartSignature(lines, billDiscount, name, customerId ?? '', serviceTypeOf(billTakeaway)) });
    setError(message); setNotice(success); setCartVisible(true);
    if (customerId && can('customer.read')) {
      // The bill only snapshots name and phone; fetch the customer's own phone (the bill's may have been typed
      // because the customer has none) and its transaction count. Failing here just keeps the snapshot.
      void authorizedRequest<Customer>(`customers/${encodeURIComponent(customerId)}`)
        .then((found) => setSelectedCustomer((current) => current?.id === found.id ? { ...current, phone: found.phone, transactionCount: found.transactionCount } : current))
        .catch(() => undefined);
    }
  }

  function confirmCancelOpenBill() {
    const bill = openBill;
    if (!bill) return;
    // A deposit already counted by a cash closing cannot simply be voided; an admin refunds or forfeits it instead.
    if (closedDepositOf(bill.payments) > 0) { setSettleError(''); setSettleVisible(true); return; }
    // Deposits not yet in a cash closing are voided with the bill; the cashier hands the money back.
    const deposit = bill.paidTotal ? `\n\nDP ${money(bill.paidTotal)} akan dibatalkan; kembalikan uang ke pelanggan.` : '';
    Alert.alert('Batalkan open bill?', `Bill ${bill.orderNumber} atas nama ${bill.customerName} akan dibatalkan dan tidak bisa dibuka lagi.${deposit}`, [
      { text: 'Kembali', style: 'cancel' },
      { text: 'Ya, batalkan', style: 'destructive', onPress: () => void cancelOpenBill(bill) },
    ]);
  }

  async function cancelOpenBill(bill: LoadedBill) {
    setBillBusy(true); setError('');
    try {
      await authorizedRequest(`orders/${bill.id}/cancel`, { method: 'POST' });
      resetCart(); setCartVisible(false);
      setNotice(`Open bill ${bill.orderNumber} dibatalkan.`);
      void refreshNotifications();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ORDER_PAYMENT_ALREADY_CLOSED') {
        // A cash closing ran after the bill was loaded: fetch its payments so the sheet shows what is closed.
        const latest = await authorizedRequest<BillOrder>(`orders/${bill.id}`).catch(() => null);
        if (latest) setOpenBill((current) => current?.id === bill.id ? { ...current, payments: latest.payments } : current);
        setSettleError(''); setSettleVisible(true);
        return;
      }
      setError(openBillErrorMessage(e));
    } finally { setBillBusy(false); }
  }

  /** Cancels the loaded bill and refunds or forfeits its deposit (order.deposit_settle), then clears the cart. */
  async function settleDeposit(settlement: DepositSettlement, reason: string) {
    const bill = openBill;
    if (!bill) return;
    setBillBusy(true); setSettleError(''); setError(''); setWarning('');
    try {
      const result = await authorizedRequest<DepositSettlementResult>(`orders/${bill.id}/cancel-with-deposit`, { method: 'POST', body: JSON.stringify({ settlement, reason }) });
      setSettleVisible(false); resetCart(); setCartVisible(false);
      setNotice(depositSettlementNotice(result));
      void refreshNotifications();
    } catch (e) { setSettleError(depositSettlementErrorMessage(e)); }
    finally { setBillBusy(false); }
  }

  useEffect(() => {
    if (!pendingBill) return;
    const { bill, message } = pendingBill;
    // Wait until the bill's branch has its warehouses loaded, then switch to the bill's warehouse and wait for its catalog.
    if (branchId !== bill.branchId || !warehouseId || warehouses[0]?.branchId !== bill.branchId) return;
    if (warehouseId !== bill.warehouseId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (warehouses.some((warehouse) => warehouse.id === bill.warehouseId)) setWarehouseId(bill.warehouseId);
      else { setError(`Gudang bill ${bill.orderNumber} tidak tersedia di POS.`); setPendingBill(null); }
      return;
    }
    if (catalogWarehouseId !== warehouseId || productsLoading) return;
    setPendingBill(null);
    applyOpenBill(bill, message);
  // applyOpenBill reads the catalog this effect waits for; it is not a trigger on its own.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBill, branchId, warehouseId, warehouses, catalogWarehouseId, productsLoading]);

  useEffect(() => {
    if (params.openBillList) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBillListVisible(true);
      router.setParams({ openBillList: undefined });
    }
    if (params.openBillId) {
      void loadOpenBill(params.openBillId);
      router.setParams({ openBillId: undefined });
    }
  // Deep-link params are handled once each and then cleared.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.openBillId, params.openBillList]);

  async function printReceipt() {
    if (!receipt) return;
    setPrintError('');
    if (Platform.OS === 'android') {
      // Bluetooth printing always goes through the preview; a missing printer is picked first.
      if (!printer) { await showPrinterPicker(true); return; }
      setPreviewVisible(true);
      return;
    }
    setPrinting(true);
    const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    const date = receipt.completedAt ?? receipt.createdAt;
    const rows = (receipt.items ?? []).map((item) => `<div class="item"><div class="row"><span>${esc(item.productNameSnapshot)}${item.variantNameSnapshot ? ` (${esc(item.variantNameSnapshot)})` : ''}</span><span>${money(Number(item.totalPrice))}</span></div><div class="sub">${Number(item.inputQuantity ?? item.quantity)} ${esc(item.unit?.code ?? '')} x ${money(Number(item.unitPrice))}</div>${(item.addons ?? []).map((addon) => `<div class="sub">+ ${esc(addon.addonNameSnapshot)} x ${Number(addon.quantity)} (${money(Number(addon.totalPrice))})</div>`).join('')}</div>`).join('');
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page{margin:5mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111;width:72mm;margin:0 auto}.center{text-align:center}.title{font-size:18px;font-weight:bold}.muted{color:#555;font-size:10px}.line{border-top:1px dashed #555;margin:9px 0}.row{display:flex;justify-content:space-between;gap:8px}.item{margin:8px 0}.sub{color:#555;font-size:10px;margin-top:3px}.total{font-weight:bold;font-size:15px}</style></head><body><div class="center"><div class="title">${esc(receipt.branch?.name ?? 'NOTA PEMBELIAN')}</div>${receipt.branch?.code ? `<div class="muted">${esc(receipt.branch.code)}</div>` : ''}<div class="line"></div><div>${esc(receipt.orderNumber)}</div><div class="muted">${date ? formatDate(date) : ''}</div>${receipt.serviceType ? `<div>${esc(formatServiceType(receipt.serviceType))}</div>` : ''}${receipt.customerName || receipt.customerPhone ? `<div>Pelanggan: ${esc(customerLabel(receipt.customerName, receipt.customerPhone))}</div>` : ''}</div><div class="line"></div>${rows}<div class="line"></div><div class="row"><span>Subtotal</span><span>${money(Number(receipt.subtotal))}</span></div><div class="row"><span>Diskon</span><span>-${money(Number(receipt.discountAmount))}</span></div>${Number(receipt.taxAmount ?? 0) ? `<div class="row"><span>Pajak</span><span>${money(Number(receipt.taxAmount))}</span></div>` : ''}${Number(receipt.serviceCharge ?? 0) ? `<div class="row"><span>Layanan</span><span>${money(Number(receipt.serviceCharge))}</span></div>` : ''}<div class="row total"><span>TOTAL</span><span>${money(Number(receipt.grandTotal))}</span></div>${(receipt.payments ?? []).map((payment) => `<div class="row"><span>${esc(formatStatus(payment.method))}</span><span>${money(Number(payment.amount))}</span></div>${payment.receivedAmount ? `<div class="row"><span>Diterima</span><span>${money(Number(payment.receivedAmount))}</span></div>` : ''}${payment.changeAmount ? `<div class="row"><span>Kembalian</span><span>${money(Number(payment.changeAmount))}</span></div>` : ''}`).join('')}<div class="line"></div><div class="center">Terima kasih</div></body></html>`;
    try { await Print.printAsync({ html }); }
    catch (e) { setPrintError(e instanceof Error ? e.message : 'Nota gagal dicetak.'); }
    finally { setPrinting(false); }
  }

  /**
   * Kitchen tickets, pre-bills and DP receipts use the receipt printer: the thermal preview on Android, the system print
   * dialog elsewhere. `failure` is shown when the print dialog fails.
   */
  async function printSlip(next: Slip | Slip[], failure: string) {
    const queue = Array.isArray(next) ? next : [next];
    if (!queue.length) return;
    setPrintError('');
    if (Platform.OS === 'android') {
      // Several slips (bar and kitchen tickets) are previewed and printed one after another.
      setSlipQueue(queue);
      if (!printerFor(queue[0])) { await showPrinterPicker(true, queue[0].station ?? 'receipt'); return; }
      setSlipPreviewVisible(true);
      return;
    }
    try { for (const entry of queue) await Print.printAsync({ html: `<!doctype html><html><body><pre style="font:12px monospace">${escapeHtml(entry.text)}</pre></body></html>` }); }
    catch (e) { setError(e instanceof Error ? e.message : failure); }
  }

  /** A station ticket goes to that station's printer; anything else, or a station without its own printer, to the receipt printer. */
  function printerFor(entry: Slip) {
    return (entry.station ? stationPrinters[entry.station] : null) ?? printer;
  }

  /** Drops the slip on screen and moves on to the next one, asking for a printer when the next station has none. */
  function nextSlip() {
    const rest = slipQueue.slice(1);
    setSlipQueue(rest); setPrintError('');
    if (!rest.length) { setSlipPreviewVisible(false); return; }
    if (!printerFor(rest[0])) { setSlipPreviewVisible(false); void showPrinterPicker(true, rest[0].station ?? 'receipt'); }
  }

  async function sendSlip(target: PairedPrinter) {
    if (!slip) return;
    setPrinting(true); setPrintError('');
    try { await printThermalSlip(slip.text, target); nextSlip(); }
    catch (e) { setPrintError(e instanceof Error ? e.message : `${slip.title} gagal dikirim ke printer.`); }
    finally { setPrinting(false); }
  }

  async function showPrinterPicker(printAfterSelection = false, target: PrinterTarget = 'receipt') {
    setPrintError(''); setPrintAfterPrinterSelection(printAfterSelection); setPrinterTarget(target); setPrinterPickerVisible(true); setPrinterLoading(true);
    try { setPrinterDevices(await getPairedPrinters()); }
    catch (e) { setPrintError(e instanceof Error ? e.message : 'Tidak dapat membaca perangkat Bluetooth.'); }
    finally { setPrinterLoading(false); }
  }

  /** Closing the picker drops pending slips and returns to the print settings when it was opened from there. */
  function closePrinterPicker() {
    setPrinterPickerVisible(false); setPrintAfterPrinterSelection(false); setSlipQueue([]);
    if (settingsAfterPick) { setSettingsAfterPick(false); setPrintSettingsVisible(true); }
  }

  /** Picks a printer from the print settings; the settings sheet steps aside while the picker is open. */
  function pickPrinterFromSettings(target: PrinterTarget) {
    setPrintSettingsVisible(false); setSettingsAfterPick(true);
    void showPrinterPicker(false, target);
  }

  async function resetStationPrinter(station: Station) {
    try { await saveStationPrinter(station, null); setStationPrinters((current) => ({ ...current, [station]: null })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Printer gagal disimpan.'); }
  }

  function changeQuickSaleTickets(enabled: boolean) {
    setQuickSaleTickets(enabled);
    void saveQuickSaleTickets(enabled).catch(() => undefined);
  }

  async function sendBluetoothReceipt(target: PairedPrinter) {
    if (!receipt) return;
    setPrinting(true); setPrintError('');
    try { await printThermalReceipt(receipt, target); setPreviewVisible(false); }
    catch (e) { setPrintError(e instanceof Error ? e.message : 'Nota gagal dikirim ke printer.'); }
    finally { setPrinting(false); }
  }

  async function choosePrinter(target: PairedPrinter) {
    setPrinterLoading(true); setPrintError('');
    try {
      if (printerTarget === 'receipt') { await savePrinter(target); setPrinter(target); }
      else { await saveStationPrinter(printerTarget, target); setStationPrinters((current) => ({ ...current, [printerTarget]: target })); }
      setPrinterPickerVisible(false);
      // A pending slip (ticket, pre-bill or DP receipt) takes the freshly chosen printer; otherwise it is the receipt.
      if (printAfterPrinterSelection) { if (slip) setSlipPreviewVisible(true); else setPreviewVisible(true); }
      if (settingsAfterPick) { setSettingsAfterPick(false); setPrintSettingsVisible(true); }
    } catch (e) { setPrintError(e instanceof Error ? e.message : 'Printer gagal disimpan.'); }
    finally { setPrinterLoading(false); setPrintAfterPrinterSelection(false); }
  }

  const thermalPreview = receipt ? <ThermalPreview
    visible={previewVisible}
    title={`Nota ${receipt.orderNumber}`}
    text={formatOrderReceipt(receipt)}
    printer={printer}
    printing={printing}
    error={printError}
    onPrint={() => { if (printer) void sendBluetoothReceipt(printer); }}
    onChangePrinter={() => { setPreviewVisible(false); void showPrinterPicker(true); }}
    onClose={() => { setPreviewVisible(false); setPrintError(''); }}
  /> : null;

  const printerPickerTitle = printerTarget === 'receipt' ? undefined : `Pilih Printer ${stationLabel(printerTarget)}`;
  // Closing the preview skips this slip; the next one (e.g. the bar ticket after the kitchen ticket) follows.
  const slipPreview = slip ? <ThermalPreview
    visible={slipPreviewVisible}
    title={slipQueue.length > 1 ? `${slip.title} (${slipQueue.length - 1} lagi)` : slip.title}
    text={slip.text}
    printer={printerFor(slip)}
    printing={printing}
    error={printError}
    onPrint={() => { const target = printerFor(slip); if (target) void sendSlip(target); }}
    onChangePrinter={() => { setSlipPreviewVisible(false); void showPrinterPicker(true, slip.station ?? 'receipt'); }}
    onClose={nextSlip}
  /> : null;

  if (receipt && receipt.orderNumber.length > 0) return <>{thermalPreview}{slipPreview}<PosReceiptScreen
    order={receipt}
    topInset={insets.top + 8}
    bottomInset={insets.bottom}
    cashierName={user?.name ?? 'Kasir'}
    printing={printing}
    printError={printError}
    printer={printer}
    printerPickerVisible={printerPickerVisible}
    printerDevices={printerDevices}
    printerLoading={printerLoading}
    printerPickerTitle={printerPickerTitle}
    onPrint={() => void printReceipt()}
    onNewOrder={() => { setReceipt(null); setPendingOrder(null); setPrintError(''); setError(''); }}
    onChoosePrinter={(target) => void choosePrinter(target)}
    onClosePrinterPicker={closePrinterPicker}
    onOpenBluetoothSettings={openAndroidBluetoothSettings}
  /></>;

  const billSheets = <>
    {billSheetVisible ? <OpenBillSaveSheet
      editing={Boolean(openBill)}
      initialName={customer}
      initialPhone={customerPhone}
      saving={billBusy}
      error={billError}
      bottomInset={insets.bottom}
      linkedCustomer={selectedCustomer}
      onSave={(name, phone) => void saveOpenBill(name, phone)}
      onClose={() => { setBillSheetVisible(false); setBillError(''); }}
    /> : null}
    {billListVisible ? <OpenBillListSheet
      request={authorizedRequest}
      bottomInset={insets.bottom}
      loadingId={billLoadingId}
      onSelect={selectOpenBill}
      onClose={() => setBillListVisible(false)}
    /> : null}
    {customerPickerVisible && branchId ? <CustomerPickerSheet
      request={authorizedRequest}
      branchId={branchId}
      selectedId={selectedCustomer?.id ?? ''}
      canCreate={can('customer.create')}
      bottomInset={insets.bottom}
      onSelect={selectCustomer}
      onGuest={detachCustomer}
      onClose={() => setCustomerPickerVisible(false)}
    /> : null}
    {voidTarget ? <OpenBillVoidSheet
      line={voidTarget}
      saving={billBusy}
      error={voidError}
      bottomInset={insets.bottom}
      onVoid={(quantity, reason) => void voidLine(voidTarget, quantity, reason)}
      onClose={() => { setVoidTarget(null); setVoidError(''); }}
    /> : null}
    {settleVisible && openBill ? <DepositSettlementSheet
      orderNumber={openBill.orderNumber}
      payments={openBill.payments}
      canSettle={can(DEPOSIT_SETTLE_PERMISSION)}
      saving={billBusy}
      error={settleError}
      bottomInset={insets.bottom}
      onSubmit={(settlement, reason) => void settleDeposit(settlement, reason)}
      onClose={() => { setSettleVisible(false); setSettleError(''); }}
    /> : null}
    {splitLines && openBill ? <SplitBillSheet
      orderNumber={openBill.orderNumber}
      customer={customerLabel(openBill.customerName, openBill.customerPhone)}
      lines={splitLines}
      saving={billBusy}
      error={splitError}
      bottomInset={insets.bottom}
      onSubmit={(part) => void submitSplit(part)}
      onClose={() => { setSplitLines(null); setSplitError(''); }}
    /> : null}
    {mergeListVisible && openBill ? <OpenBillListSheet
      request={authorizedRequest}
      bottomInset={insets.bottom}
      loadingId={billLoadingId}
      excludeId={openBill.id}
      title={`Gabung ke ${openBill.orderNumber}`}
      subtitle="Pilih bill yang item dan DP-nya dipindah ke bill ini."
      onSelect={(row) => void pickMergeSource(row)}
      onClose={() => setMergeListVisible(false)}
    /> : null}
    {printSettingsVisible ? <PrintSettingsSheet
      receiptPrinter={printer}
      stationPrinters={stationPrinters}
      showPrinters={Platform.OS === 'android'}
      quickSaleTickets={quickSaleTickets}
      bottomInset={insets.bottom}
      onPickReceiptPrinter={() => pickPrinterFromSettings('receipt')}
      onPickStationPrinter={pickPrinterFromSettings}
      onResetStationPrinter={(station) => void resetStationPrinter(station)}
      onQuickSaleTicketsChange={changeQuickSaleTickets}
      onClose={() => setPrintSettingsVisible(false)}
    /> : null}
    {printerPickerVisible ? <PrinterPickerSheet
      devices={printerDevices}
      loading={printerLoading}
      error={printError}
      bottomInset={insets.bottom}
      title={printerPickerTitle}
      onChoose={(target) => void choosePrinter(target)}
      onClose={closePrinterPicker}
      onOpenBluetoothSettings={openAndroidBluetoothSettings}
    /> : null}
    {slipPreview}
  </>;

  if (cartVisible) return <><PosCheckoutFlow
    lines={cart}
    topInset={insets.top + 8}
    paymentStep={paymentStep}
    onPaymentStepChange={(value) => { setPaymentStep(value); if (!value) setDepositMode(false); }}
    customer={customer}
    onCustomerChange={setCustomer}
    discount={discount}
    onDiscountChange={setDiscount}
    method={method}
    onMethodChange={setMethod}
    total={total}
    subtotal={subtotal}
    discountAmount={discountAmount}
    priceFor={priceFor}
    onQuantity={quantity}
    canIncrease={(line) => canAddUnit(line.product, line.unitId)}
    onCheckout={() => void checkout()}
    onClear={() => { setCart([]); setPendingOrder(null); setOpenBill(null); setCustomerPhone(''); setPaymentStep(false); setDepositMode(false); setTakeaway(false); setSplitMethods(null); setError(''); setNotice(''); setWarning(''); detachCustomer(); }}
    onClose={() => { setCartVisible(false); setPaymentStep(false); setDepositMode(false); }}
    submitting={submitting}
    error={error}
    onError={setError}
    takeaway={takeaway}
    onTakeawayChange={setTakeaway}
    bottomInset={insets.bottom}
    openBill={openBill}
    openBillDirty={openBillDirty}
    billBusy={billBusy}
    onSaveOpenBill={() => { setBillError(''); setBillSheetVisible(true); }}
    onCancelOpenBill={can('order.cancel') ? confirmCancelOpenBill : undefined}
    selectedCustomer={selectedCustomer}
    onPickCustomer={can('customer.read') && branchId ? () => setCustomerPickerVisible(true) : undefined}
    onRemoveCustomer={detachCustomer}
    notice={notice}
    warning={warning}
    // KITCHEN-HIDDEN: fitur dapur/bar disembunyikan sementara; hapus comment untuk mengaktifkan lagi.
    // onSendToKitchen={openBill ? () => void sendToKitchen() : undefined}
    onVoidLine={can('order.void_item') ? (line) => { setVoidError(openBillDirty ? VOID_BLOCKED_MESSAGE : ''); setVoidTarget(line as Line); } : undefined}
    onPrintPreBill={openBill ? () => void printPreBill() : undefined}
    onStartDeposit={openBill && can('payment.create') ? startDeposit : undefined}
    depositMode={depositMode}
    depositAmount={depositAmount}
    onDepositAmountChange={setDepositAmount}
    onReceiveDeposit={() => void receiveDeposit()}
    splitMethods={splitMethods}
    onSplitMethodsChange={setSplitMethods}
    quickSaleTickets={quickSaleTickets}
    // KITCHEN-HIDDEN: onQuickSaleTicketsChange={openBill ? undefined : changeQuickSaleTickets}
    // KITCHEN-HIDDEN: onOpenPrintSettings={Platform.OS === 'android' ? () => setPrintSettingsVisible(true) : undefined}
    onSplitBill={openBill && can('order.create') ? () => void startSplit() : undefined}
    onMergeBill={openBill && can('order.create') ? () => void startMerge() : undefined}
    noticeAction={splitNotice && notice === splitNotice.message && openBill?.id !== splitNotice.partId ? { label: `Buka bill baru ${splitNotice.orderNumber}`, onPress: () => selectOpenBill({ id: splitNotice.partId, orderNumber: splitNotice.orderNumber }) } : null}
  />{billSheets}</>;
    if (!receipt && !cartVisible) return <><PosCatalogScreen
      branches={branches}
      warehouses={warehouses}
      branchId={branchId}
      warehouseId={warehouseId}
      userBranchId={user?.branchId ?? null}
      products={products}
      categories={categories}
      selectedCategory={activeCategory}
      displayOnly={displayOnly}
      search={search}
      visibleProducts={visible}
      cart={cart}
      total={total}
      loading={Boolean(warehouseId) && productsLoading}
      refreshing={refreshing}
      onRefresh={refreshCatalog}
      error={error}
      optionProduct={optionProduct}
      optionUnit={optionUnit}
      optionVariant={optionVariant}
      optionAddons={optionAddons}
      topInset={0}
      bottomInset={0}
      onBranchChange={(id) => { if (id !== branchId) switchLocation(() => setBranchId(id)); }}
      onWarehouseChange={(id) => { if (id !== warehouseId) switchLocation(() => setWarehouseId(id)); }}
      onCategoryChange={setSelectedCategory}
      onDisplayOnlyChange={setDisplayOnly}
      onSearchChange={setSearch}
      onAdd={add}
      onQuantity={quantity}
      canAdd={(product, unitId) => canAddUnit(product as Product, unitId)}
      priceFor={priceFor}
      onOpenCart={() => { setPaymentStep(false); setCartVisible(true); }}
      onClear={() => { setCart([]); setPendingOrder(null); setOpenBill(null); setCustomerPhone(''); setTakeaway(false); setSplitMethods(null); setError(''); setWarning(''); detachCustomer(); }}
      onScan={(value) => { const match = products.find((product) => product.barcode === value || product.sku === value); if (match) add(match); else { setSearch(value); setError('Barcode tidak ditemukan pada katalog gudang ini.'); } }}
      onCloseOption={() => setOptionProduct(null)}
      onOptionUnitChange={setOptionUnit}
      onOptionVariantChange={setOptionVariant}
      onOptionAddonsChange={setOptionAddons}
      onAddConfigured={() => { if (optionProduct) addConfigured(optionProduct, optionUnit, optionVariant, optionAddons); setOptionProduct(null); }}
      notice={notice}
      openBillLabel={openBill ? `Open Bill ${openBill.orderNumber} · ${openBill.customerName}${openBill.paidTotal ? ` · DP ${money(openBill.paidTotal)} · sisa ${money(total - openBill.paidTotal)}` : ''}${openBillDirty ? ' · belum disimpan' : ''}` : null}
      onOpenBills={can('order.read') ? () => { setNotice(''); setBillListVisible(true); } : undefined}
      openBillCount={openBillCount}
      warning={warning}
  />{billSheets}</>;
  if (receipt) return <ScrollView style={styles.screen} contentContainerStyle={[styles.page, { paddingTop: 18 + insets.top }]}><Text style={styles.eyebrow}>TRANSAKSI BERHASIL</Text><Text style={styles.title}>Nota pembayaran</Text><View style={styles.receiptCard}><Text style={styles.receiptStore}>{receipt.branch?.name ?? 'Inventory Replenishment'}</Text><Text style={styles.muted}>{receipt.orderNumber}{receipt.createdAt ? ` Â· ${formatDate(receipt.createdAt)}` : ''}</Text>{receipt.customerName ? <Text style={styles.receiptCustomer}>Pelanggan: {receipt.customerName}</Text> : null}<View style={styles.receiptDivider} />{receipt.items?.map((item, index) => <View key={`${item.productNameSnapshot}-${index}`} style={styles.receiptItem}><View style={styles.receiptRow}><Text style={styles.receiptItemName}>{item.productNameSnapshot}{item.variantNameSnapshot ? ` (${item.variantNameSnapshot})` : ''}</Text><Text style={styles.receiptItemPrice}>{money(Number(item.totalPrice))}</Text></View><Text style={styles.muted}>{Number(item.quantity)} Ã— {money(Number(item.unitPrice))}</Text>{item.addons?.map((addon, addIndex) => <Text key={`${addon.addonNameSnapshot}-${addIndex}`} style={styles.muted}>+ {addon.addonNameSnapshot} Ã— {Number(addon.quantity)} Â· {money(Number(addon.totalPrice))}</Text>)}</View>)}<View style={styles.receiptDivider} /><Text style={styles.receiptRow}>Subtotal<Text>{money(Number(receipt.subtotal))}</Text></Text><Text style={styles.receiptRow}>Diskon<Text>-{money(Number(receipt.discountAmount))}</Text></Text>{Number(receipt.taxAmount ?? 0) > 0 ? <Text style={styles.receiptRow}>Pajak<Text>{money(Number(receipt.taxAmount))}</Text></Text> : null}{Number(receipt.serviceCharge ?? 0) > 0 ? <Text style={styles.receiptRow}>Layanan<Text>{money(Number(receipt.serviceCharge))}</Text></Text> : null}<Text style={styles.receiptTotal}>TOTAL<Text>{money(Number(receipt.grandTotal))}</Text></Text>{receipt.payments?.map((payment, index) => <View key={`${payment.method}-${index}`}><Text style={styles.receiptRow}>{formatStatus(payment.method)}<Text>{money(Number(payment.amount))}</Text></Text>{payment.receivedAmount ? <Text style={styles.receiptRow}>Diterima<Text>{money(Number(payment.receivedAmount))}</Text></Text> : null}{payment.changeAmount && Number(payment.changeAmount) > 0 ? <Text style={styles.receiptRow}>Kembalian<Text>{money(Number(payment.changeAmount))}</Text></Text> : null}</View>)}<View style={styles.receiptDivider} /><Text style={styles.receiptThanks}>Terima kasih</Text></View>{Platform.OS === 'android' ? <View style={styles.printerBox}><View style={styles.productInfo}><Text style={styles.label}>Printer Bluetooth</Text><Text style={styles.printerName}>{printer?.name ?? 'Belum dipilih'}</Text></View><Pressable onPress={() => void showPrinterPicker(false)} style={styles.scanButton}><Text style={styles.scanText}>{printer ? 'Ganti' : 'Pilih'}</Text></Pressable></View> : null}{printError ? <View style={styles.errorBox}><Text style={styles.errorText}>{printError}</Text></View> : null}<Pressable disabled={printing} style={[styles.primary, printing && styles.disabled]} onPress={() => void printReceipt()}><Text style={styles.primaryText}>{printing ? 'Mencetak nota...' : 'Cetak nota'}</Text></Pressable><Text style={styles.printHint}>{Platform.OS === 'android' ? 'Printer tersimpan akan tersambung otomatis saat cetak. Pastikan printer sudah dipasangkan di pengaturan Bluetooth Android.' : 'Buka layanan cetak yang tersedia untuk mencetak atau menyimpan nota.'}</Text><Pressable style={styles.secondary} onPress={() => { setReceipt(null); setPrintError(''); }}><Text style={styles.secondaryText}>Transaksi baru</Text></Pressable><Modal visible={printerPickerVisible} animationType="slide" transparent onRequestClose={() => { setPrinterPickerVisible(false); setPrintAfterPrinterSelection(false); }}><View style={styles.modalBackdrop}><View style={styles.optionPanel}><Text style={styles.sectionTitle}>Pilih printer Bluetooth</Text><Text style={styles.muted}>Pilih perangkat thermal yang sudah dipasangkan di pengaturan Android.</Text>{printError ? <View style={styles.errorBox}><Text style={styles.errorText}>{printError}</Text></View> : null}{printerLoading ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : printerDevices.length ? printerDevices.map((device) => <Pressable key={device.address} disabled={printerLoading} onPress={() => void choosePrinter(device)} style={styles.optionRow}><Text style={styles.optionText}>{device.name}</Text><Text style={styles.muted}>{device.address}</Text></Pressable>) : !printerLoading ? <Text style={styles.empty}>Belum ada perangkat Bluetooth yang dipasangkan.</Text> : null}<View style={styles.modalActions}><Pressable style={styles.cancelButton} onPress={openAndroidBluetoothSettings}><Text style={styles.cancelText}>Pengaturan Bluetooth</Text></Pressable><Pressable style={styles.primary} disabled={printerLoading} onPress={() => void showPrinterPicker(printAfterPrinterSelection)}><Text style={styles.primaryText}>Muat ulang</Text></Pressable></View><Pressable style={styles.cancelButton} onPress={() => { setPrinterPickerVisible(false); setPrintAfterPrinterSelection(false); }}><Text style={styles.cancelText}>Tutup</Text></Pressable></View></View></Modal></ScrollView>;

  if (cartVisible) return <View style={[styles.cartFlow, { paddingTop: insets.top + 8 }]}>
    <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{paymentStep ? 'Pembayaran' : `Pesanan (${cart.reduce((n, line) => n + line.quantity, 0)})`}</Text><Pressable onPress={() => { setCart([]); setPaymentStep(false); }}><Text style={styles.clearCart}>Hapus</Text></Pressable><Pressable onPress={() => setCartVisible(false)}><Text style={styles.sheetClose}>âŒ„</Text></Pressable></View>
    <View style={styles.stepTabs}><Pressable onPress={() => setPaymentStep(false)} style={[styles.stepTab, !paymentStep && styles.stepTabActive]}><Text style={[styles.stepTabText, !paymentStep && styles.stepTabTextActive]}>1 Pesanan</Text></Pressable><Pressable disabled={!cart.length} onPress={() => setPaymentStep(true)} style={[styles.stepTab, paymentStep && styles.stepTabActive]}><Text style={[styles.stepTabText, paymentStep && styles.stepTabTextActive]}>2 Bayar</Text></Pressable></View>
    {!paymentStep ? <KeyboardAwareScrollView bottomOffset={24} style={styles.flowContent} keyboardShouldPersistTaps="handled"><TextInput autoFocus style={styles.flowInput} value={customer} onChangeText={setCustomer} placeholder="Nama customer" placeholderTextColor="#75808d"/><View style={styles.flowChoices}><Pressable style={[styles.choiceChip, !takeaway && styles.choiceChipActive]} onPress={() => setTakeaway(false)}><Text style={[styles.choiceText, !takeaway && styles.choiceTextActive]}>Dine in</Text></Pressable><Pressable style={[styles.choiceChip, takeaway && styles.choiceChipActive]} onPress={() => setTakeaway(true)}><Text style={[styles.choiceText, takeaway && styles.choiceTextActive]}>Take away</Text></Pressable></View>{cart.map((line) => <View key={line.key} style={styles.flowItem}><Text style={styles.productName}>{line.product.name}</Text><Text style={styles.muted}>{line.product.variants?.find((v) => v.id === line.variantId)?.name ?? line.product.sku}</Text><View style={styles.flowItemBottom}><View style={styles.flowChoices}><Pressable style={styles.qtyButton} onPress={() => quantity(line.key, -1)}><Minus size={16} color="#c70d17" /></Pressable><Text style={styles.qty}>{line.quantity}</Text><Pressable style={styles.qtyButton} onPress={() => quantity(line.key, 1)}><Plus size={16} color="#c70d17" /></Pressable></View><Text style={styles.price}>{money(priceFor(line) * line.quantity)}</Text></View></View>)}</KeyboardAwareScrollView> : <KeyboardAwareScrollView bottomOffset={24} style={styles.flowContent} keyboardShouldPersistTaps="handled"><TextInput style={styles.flowInput} value={customer} onChangeText={setCustomer} placeholder="Nama customer" placeholderTextColor="#75808d"/><MoneyInput style={styles.flowInput} value={discount} onChangeText={setDiscount} placeholder="Diskon nominal" placeholderTextColor="#75808d"/><Text style={styles.label}>METODE PEMBAYARAN</Text><View style={styles.flowChoices}>{(['CASH', 'QRIS', 'TRANSFER', 'GRAB', 'GOBIZ'] as Method[]).map((item) => <Pressable key={item} onPress={() => setMethod(item)} style={[styles.choiceChip, method === item && styles.choiceChipActive]}><Text style={[styles.choiceText, method === item && styles.choiceTextActive]}>{item === 'CASH' ? 'Cash' : item === 'GOBIZ' ? 'GoBiz' : item}</Text></Pressable>)}</View><View style={styles.paymentSummary}><Text style={styles.paymentSummaryLine}>Subtotal <Text>{money(subtotal)}</Text></Text><Text style={styles.paymentSummaryLine}>Diskon <Text>{money(discountAmount)}</Text></Text><Text style={styles.paymentGrandTotal}>Total <Text>{money(total)}</Text></Text></View>{error ? <Text style={styles.errorText}>{error}</Text> : null}</KeyboardAwareScrollView>}
    {paymentStep ? <View style={[styles.flowChoices, { paddingHorizontal: 16, marginVertical: 0 }]}><Pressable onPress={() => setMethod('GOBIZ')} style={[styles.choiceChip, method === 'GOBIZ' && styles.choiceChipActive]}><Text style={[styles.choiceText, method === 'GOBIZ' && styles.choiceTextActive]}>GoBiz</Text></Pressable></View> : null}
    <View style={[styles.flowFooter, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>{paymentStep ? <Pressable onPress={() => setPaymentStep(false)} style={styles.footerSecondary}><Text style={styles.footerSecondaryText}>Kembali</Text></Pressable> : null}<Pressable disabled={!cart.length || submitting} onPress={() => paymentStep ? void checkout() : setPaymentStep(true)} style={[styles.footerPrimary, (!cart.length || submitting) && styles.disabled]}><Text style={styles.footerPrimaryText}>{paymentStep ? submitting ? 'Memproses...' : `Bayar ${money(total)}` : `Lanjut Â· ${money(total)}`}</Text></Pressable></View>
  </View>;

  return <View style={styles.posRoot}><KeyboardAwareScrollView bottomOffset={24} style={styles.screen} contentContainerStyle={[styles.page, { paddingTop: 18 + insets.top, paddingBottom: 18 }]} keyboardShouldPersistTaps="handled">
    <View style={styles.posHeader}><View style={styles.brandMark}><Image accessibilityLabel="Logo Inventory Replenishment" source={require('../../../assets/brand-splash.png')} style={styles.brandMarkImage} resizeMode="contain" /></View><View style={styles.brandDetails}><Text numberOfLines={1} style={styles.brandName}>{branches.find((b) => b.id === branchId)?.name ?? 'Kasir'}</Text><Text numberOfLines={1} style={styles.brandEmail}>{user?.email ?? user?.name}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Keluar dari akun" onPress={() => void signOut()} style={styles.logoutButton}><LogOut size={22} color="#c70d17" /></Pressable></View>
    <View style={styles.branchWarehouseCard}><View style={styles.locationSide}><Text style={styles.locationSideLabel}>Cabang</Text>{user?.branchId ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.locationSideValue}>{branches.find((b) => b.id === branchId)?.name ?? 'Memuat cabang...'}</Text> : <ScrollView horizontal showsHorizontalScrollIndicator={false}>{branches.map((b) => <Pressable key={b.id} onPress={() => setBranchId(b.id)} style={[styles.locationChip, branchId === b.id && styles.locationChipActive]}><Text numberOfLines={1} ellipsizeMode="tail" style={[styles.locationText, branchId === b.id && styles.locationTextActive]}>{b.name}</Text></Pressable>)}</ScrollView>}</View><View style={styles.locationDivider} /><View style={styles.locationSide}><Text style={styles.locationSideLabel}>Gudang</Text>{warehouses.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{warehouses.map((w) => <Pressable key={w.id} onPress={() => setWarehouseId(w.id)} style={[styles.locationChip, warehouseId === w.id && styles.locationChipActive]}><Text numberOfLines={1} ellipsizeMode="tail" style={[styles.locationText, warehouseId === w.id && styles.locationTextActive]}>{warehouses.length === 1 ? 'Stok cabang' : w.name}</Text></Pressable>)}</ScrollView> : <Text numberOfLines={1} style={styles.locationSideEmpty}>{branchId ? 'Belum ada gudang' : 'Pilih cabang'}</Text>}</View></View>
    <View style={styles.searchRow}><TextInput style={[styles.search, styles.searchFlex, styles.catalogSearch]} value={search} onChangeText={setSearch} placeholder="Cari menu atau SKU..." placeholderTextColor="#87948c" /><Pressable accessibilityRole="button" accessibilityLabel="Scan barcode" onPress={() => setScannerVisible(true)} style={styles.scanButton}><Barcode size={22} color="#fff" /></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>{categories.map((category) => <Pressable key={category} onPress={() => setSelectedCategory(category)} style={[styles.categoryChip, selectedCategory === category && styles.categoryChipActive]}><Text style={[styles.categoryText, selectedCategory === category && styles.categoryTextActive]}>{category}</Text></Pressable>)}</ScrollView>
    {productsLoading ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : null}
    {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
    <View style={styles.catalogGrid}>{visible.map((p) => { const selectedQuantity = cart.filter((line) => line.product.id === p.id).reduce((sum, line) => sum + line.quantity, 0); const selectedLine = cart.find((line) => line.product.id === p.id); return <View key={p.id} style={styles.catalogCard}><View style={styles.productArtwork}><Utensils size={38} color="#8145d8" /></View><Text style={styles.productCategory}>{p.category?.name ?? 'Produk'}</Text><Text numberOfLines={2} style={styles.catalogProductName}>{p.name}</Text><Text style={styles.catalogStock}>{p.available} {p.unit?.code ?? ''} tersedia</Text><View style={styles.productCardBottom}><Text numberOfLines={1} style={styles.price}>{money(Number(p.basePrice))}</Text>{selectedQuantity && selectedLine ? <View style={styles.productQtyControls}><Pressable accessibilityRole="button" accessibilityLabel={'Kurangi ' + p.name} style={styles.productQtyButton} onPress={() => quantity(selectedLine.key, -1)}><Minus size={17} color="#c70d17" /></Pressable><Text style={styles.productQtyValue}>{selectedQuantity}</Text><Pressable accessibilityRole="button" accessibilityLabel={'Tambah ' + p.name} style={styles.productQtyButtonActive} onPress={() => add(p)}><Plus size={18} color="#fff" /></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel={'Tambah ' + p.name} style={styles.addCircle} onPress={() => add(p)}><Plus size={25} color="#fff" strokeWidth={2.5} /></Pressable>}</View></View>; })}</View>
    {!productsLoading && !visible.length ? <Text style={styles.empty}>Produk tidak ditemukan di gudang ini.</Text> : null}
    <Modal visible={Boolean(optionProduct)} animationType="slide" transparent onRequestClose={() => setOptionProduct(null)}>
      <View style={styles.modalBackdrop}><View style={styles.optionPanel}><Text style={styles.sectionTitle}>{optionProduct?.name}</Text><Text style={styles.muted}>Pilih varian dan add-on</Text>
        {(optionProduct?.sellingUnits?.length ?? 0) > 1 ? <><Text style={styles.label}>Satuan</Text>{optionProduct?.sellingUnits.map((entry) => <Pressable key={entry.unitId} onPress={() => setOptionUnit(entry.unitId)} style={[styles.optionRow, optionUnit === entry.unitId && styles.optionSelected]}><Text style={styles.optionText}>{entry.unit.name} ({entry.unit.code})</Text><Text style={styles.optionText}>{money(Number(entry.sellingPrice))}{optionUnit === entry.unitId ? '  ✓' : ''}</Text></Pressable>)}</> : null}
        {(optionProduct?.variants?.length ?? 0) > 0 ? <><Text style={styles.label}>Varian</Text><Pressable onPress={() => setOptionVariant('')} style={[styles.optionRow, !optionVariant && styles.optionSelected]}><Text style={styles.optionText}>Tanpa varian</Text><Text style={styles.optionText}>âœ“</Text></Pressable>{optionProduct?.variants?.map((v) => <Pressable key={v.id} onPress={() => setOptionVariant(v.id)} style={[styles.optionRow, optionVariant === v.id && styles.optionSelected]}><Text style={styles.optionText}>{v.name}</Text><Text style={styles.optionText}>{money(Number(v.priceDelta))}{optionVariant === v.id ? '  âœ“' : ''}</Text></Pressable>)}</> : null}
        {(optionProduct?.addons?.length ?? 0) > 0 ? <><Text style={styles.label}>Add-on</Text>{optionProduct?.addons?.map((addon) => { const active = optionAddons.includes(addon.id); return <Pressable key={addon.id} onPress={() => setOptionAddons((current) => active ? current.filter((id) => id !== addon.id) : [...current, addon.id])} style={[styles.optionRow, active && styles.optionSelected]}><Text style={styles.optionText}>{addon.name}</Text><Text style={styles.optionText}>{money(Number(addon.basePrice))}{active ? '  âœ“' : ''}</Text></Pressable>; })}</> : null}
        <View style={styles.modalActions}><Pressable style={styles.cancelButton} onPress={() => setOptionProduct(null)}><Text style={styles.cancelText}>Batal</Text></Pressable><Pressable style={styles.primary} onPress={() => { if (optionProduct) addConfigured(optionProduct, optionUnit, optionVariant, optionAddons); setOptionProduct(null); }}><Text style={styles.primaryText}>Tambah ke keranjang</Text></Pressable></View>
      </View></View>
    </Modal>
<BarcodeScanner visible={scannerVisible} onClose={() => setScannerVisible(false)} onScanned={(value) => { setScannerVisible(false); const match = products.find((product) => product.barcode === value || product.sku === value); if (match) add(match); else { setSearch(value); setError('Barcode tidak ditemukan pada katalog gudang ini.'); } }} />
  </KeyboardAwareScrollView><Pressable accessibilityRole="button" onPress={() => { setPaymentStep(false); setCartVisible(true); }} style={styles.cartBar}><ShoppingCart size={23} color="#c70d17" /><Text style={styles.cartBarTitle}>{cart.length ? `Pesanan (${cart.reduce((n, line) => n + line.quantity, 0)})` : 'Keranjang kosong'}</Text><Text style={styles.cartBarTotal}>{money(total)}</Text><ChevronUp size={20} color="#172033" /></Pressable></View>;
}

const styles = StyleSheet.create({ posRoot: { flex: 1, backgroundColor: '#f5f7f6' }, cartFlow: { flex: 1, backgroundColor: '#fff' }, flowContent: { flex: 1, paddingHorizontal: 18, paddingTop: 14 }, flowFooter: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: '#e5e9ed', backgroundColor: '#fff' }, sheetHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 }, sheetTitle: { flex: 1, color: '#111827', fontSize: 14, fontWeight: '900' }, clearCart: { color: '#c70d17', fontWeight: '800' }, sheetClose: { color: '#111827', fontSize: 24 }, stepTabs: { flexDirection: 'row', gap: 8, padding: 12 }, stepTab: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: '#fbe7e8' }, stepTabActive: { backgroundColor: '#c70d17' }, stepTabText: { color: '#718078', fontSize: 12, fontWeight: '800' }, stepTabTextActive: { color: '#fff' }, flowInput: { height: 54, marginBottom: 12, paddingHorizontal: 15, borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 15, color: '#172033' }, flowChoices: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 }, choiceChip: { padding: 10, borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 14 }, choiceChipActive: { borderColor: '#c70d17', backgroundColor: '#c70d17' }, choiceText: { color: '#344052', fontSize: 11, fontWeight: '800' }, choiceTextActive: { color: '#fff' }, flowItem: { marginTop: 12, padding: 15, borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 18 }, flowItemBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, paymentSummary: { marginTop: 16, padding: 16, borderRadius: 18, backgroundColor: '#fbe7e8' }, paymentSummaryLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, color: '#26372e', fontSize: 12 }, paymentGrandTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 12, color: '#c70d17', fontSize: 15, fontWeight: '900' }, footerPrimary: { flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#c70d17' }, footerPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '900' }, footerSecondary: { minWidth: 90, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 16 }, footerSecondaryText: { color: '#172033', fontWeight: '800' }, cartBar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginTop: 5, marginBottom: 8, paddingHorizontal: 15, borderWidth: 1, borderColor: '#e3e7eb', borderRadius: 18, backgroundColor: '#fff', elevation: 5 }, cartIcon: { fontSize: 19 }, cartBarTitle: { flex: 1, color: '#172033', fontSize: 12, fontWeight: '900' }, cartBarTotal: { color: '#b20e17', fontSize: 14, fontWeight: '900' }, cartChevron: { fontSize: 18, fontWeight: '900' }, posHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: -18, marginTop: -18, marginBottom: 12, paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#e5e9ed', backgroundColor: '#fff' }, brandMark: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#ecfdf5', padding: 6 }, brandMarkImage: { width: '100%', height: '100%' }, brandDetails: { flex: 1, minWidth: 0 }, brandName: { color: '#172033', fontSize: 14, fontWeight: '900' }, brandEmail: { marginTop: 3, color: '#718078', fontSize: 11 }, logoutButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }, logoutText: { color: '#172033', fontSize: 28, fontWeight: '700' }, locationChip: { maxWidth: 135, marginRight: 7, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, backgroundColor: '#f1f4f6' }, locationChipActive: { backgroundColor: '#fbe7e8' }, locationText: { color: '#66746c', fontSize: 10, fontWeight: '800' }, locationTextActive: { color: '#c70d17' }, branchWarehouseCard: { flexDirection: 'row', alignItems: 'stretch', marginTop: 8, padding: 12, borderWidth: 1, borderColor: '#e4e9ed', borderRadius: 16, backgroundColor: '#fff' }, locationSide: { flex: 1, minWidth: 0, justifyContent: 'center' }, locationSideLabel: { marginBottom: 7, color: '#718078', fontSize: 10, fontWeight: '800' }, locationSideValue: { color: '#172033', fontSize: 12, fontWeight: '800' }, locationSideEmpty: { color: '#84918b', fontSize: 11 }, locationDivider: { width: 1, marginHorizontal: 10, backgroundColor: '#e7ebee' }, catalogSearch: { height: 54, borderRadius: 17, fontSize: 14 }, categoryList: { gap: 8, paddingVertical: 12 }, categoryChip: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: '#e2e6ea', borderRadius: 15, backgroundColor: '#fff' }, categoryChipActive: { borderColor: '#c70d17', backgroundColor: '#c70d17' }, categoryText: { color: '#344052', fontSize: 11, fontWeight: '800' }, categoryTextActive: { color: '#fff' }, catalogGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 5 }, catalogCard: { width: '48.5%', minHeight: 300, padding: 9, borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 23, backgroundColor: '#fff' }, productArtwork: { height: 145, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#f3e5fb' }, productArtworkIcon: { color: '#8145d8', fontSize: 45 }, productCategory: { marginTop: 10, color: '#718078', fontSize: 10, fontWeight: '700' }, catalogProductName: { marginTop: 7, color: '#172033', fontSize: 14, fontWeight: '900' }, catalogStock: { marginTop: 5, color: '#8994a0', fontSize: 9 }, productCardBottom: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 5, marginTop: 15 }, productQtyControls: { flexDirection: 'row', alignItems: 'center', gap: 5 }, productQtyButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1e5e9', borderRadius: 12, backgroundColor: '#fff' }, productQtyButtonActive: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#c70d17' }, productQtyValue: { minWidth: 18, color: '#172033', textAlign: 'center', fontSize: 12, fontWeight: '900' }, addCircle: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#c70d17' }, addCircleText: { color: '#fff', fontSize: 25, fontWeight: '700' }, categoryPlaceholder: {}, screen: { flex: 1, backgroundColor: '#f5f7f6' }, page: { padding: 18, paddingBottom: 40 }, eyebrow: { color: '#c70d17', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '900' }, subtitle: { marginTop: 5, marginBottom: 14, color: '#718078', fontSize: 12, lineHeight: 18 }, selector: { marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: '#fff' }, label: { marginTop: 10, marginBottom: 7, color: '#59685f', fontSize: 11, fontWeight: '800' }, selectorValue: { color: '#26372e', fontSize: 12, fontWeight: '700' }, chip: { marginRight: 7, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#f1f4f2' }, chipActive: { backgroundColor: '#c70d17' }, chipText: { color: '#66746c', fontSize: 11, fontWeight: '800' }, chipTextActive: { color: '#fff' }, search: { height: 46, marginTop: 12, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff', color: '#172820' }, searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' }, searchFlex: { flex: 1 }, scanButton: { marginTop: 12, paddingHorizontal: 14, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#c70d17' }, scanText: { color: '#fff', fontSize: 12, fontWeight: '800' }, loader: { margin: 18 }, products: { marginTop: 10, gap: 8 }, product: { minHeight: 78, flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 15, backgroundColor: '#fff' }, productInfo: { flex: 1 }, productName: { color: '#26372e', fontSize: 12, fontWeight: '800' }, muted: { marginTop: 4, color: '#84918b', fontSize: 10 }, price: { marginTop: 6, color: '#b20e17', fontSize: 12, fontWeight: '900' }, addButton: { paddingHorizontal: 11, paddingVertical: 10, borderRadius: 10, backgroundColor: '#fbe7e8' }, addText: { color: '#c70d17', fontSize: 11, fontWeight: '900' }, empty: { marginTop: 14, padding: 18, borderRadius: 14, backgroundColor: '#fff', color: '#84918b', textAlign: 'center' }, section: { marginTop: 18, padding: 14, borderRadius: 17, backgroundColor: '#fff' }, sectionTitle: { color: '#172820', fontSize: 14, fontWeight: '900' }, cartLine: { minHeight: 55, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#edf1ee' }, qtyButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#fbe7e8' }, qtyText: { color: '#c70d17', fontSize: 18, fontWeight: '900' }, qty: { width: 28, textAlign: 'center', color: '#26372e', fontWeight: '800' }, input: { height: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 12, color: '#26372e' }, methods: { flexDirection: 'row' }, summary: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: '#f3f7f4' }, summaryLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, color: '#59685f', fontSize: 12 }, grandTotal: { paddingTop: 9, color: '#172820', fontSize: 15, fontWeight: '900' }, change: { marginTop: 6, color: '#c70d17', fontSize: 12, fontWeight: '800' }, primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 14, borderRadius: 14, backgroundColor: '#c70d17' }, primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' }, disabled: { opacity: 0.45 }, errorBox: { marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: '#fff1f0' }, errorText: { color: '#a3332a', fontSize: 11, lineHeight: 17 }, card: { marginTop: 18, padding: 20, borderRadius: 18, backgroundColor: '#fff' }, orderNo: { marginTop: 5, color: '#172820', fontSize: 14, fontWeight: '900' }, total: { marginTop: 18, color: '#c70d17', fontSize: 25, fontWeight: '900' }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0007' }, optionPanel: { maxHeight: '80%', padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#fff' }, optionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 11 }, optionSelected: { borderColor: '#c70d17', backgroundColor: '#eff9f3' }, optionText: { color: '#34453b', fontSize: 12, fontWeight: '700' }, modalActions: { flexDirection: 'row', gap: 8, marginTop: 10 }, cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 14, borderRadius: 14, backgroundColor: '#f1f4f2' }, cancelText: { color: '#59685f', fontSize: 12, fontWeight: '800' }, receiptCard: { marginTop: 16, padding: 18, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5ebe7' }, receiptStore: { color: '#172820', textAlign: 'center', fontSize: 14, fontWeight: '900' }, receiptCustomer: { marginTop: 8, color: '#59685f', fontSize: 11 }, receiptDivider: { marginVertical: 12, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#cfd9d3' }, receiptItem: { paddingVertical: 6 }, receiptRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, color: '#59685f', fontSize: 12 }, receiptItemName: { flex: 1, paddingRight: 8, color: '#26372e', fontSize: 12, fontWeight: '700' }, receiptItemPrice: { color: '#26372e', fontSize: 12, fontWeight: '700' }, receiptTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, color: '#172820', fontSize: 15, fontWeight: '900' }, receiptThanks: { color: '#59685f', textAlign: 'center', fontSize: 11 }, printHint: { marginTop: 10, color: '#718078', fontSize: 11, lineHeight: 17, textAlign: 'center' }, secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 14, backgroundColor: '#fbe7e8' }, secondaryText: { color: '#c70d17', fontSize: 12, fontWeight: '900' }, printerBox: { flexDirection: 'row', alignItems: 'center', marginTop: 14, padding: 12, borderRadius: 13, backgroundColor: '#fff' }, printerName: { color: '#26372e', fontSize: 12, fontWeight: '800' } });
