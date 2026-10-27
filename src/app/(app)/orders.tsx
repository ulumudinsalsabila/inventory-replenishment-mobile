import { useEffect, useState } from 'react';
import { AdminOnly } from '../../auth/admin-only';
import { ActivityIndicator, BackHandler, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MoneyInput } from '../../components/money-input';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Printer, ShoppingCart, Undo2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/auth-provider';
import { customRangeLabel, getRange, jakartaDate, rangeLabel, rangeOptions, type CustomRange, type RangePreset } from '../../lib/date-range';
import { DateRangeSheet } from '../../components/date-range-sheet';
import { customerLabel, formatDate, formatDateTime, formatRefundType, formatServiceType, formatStatus, defaultRefundMethod, refundMethodsFor, type OpenBillStockAction } from '../../lib/display';
import { ApiError } from '../../lib/api';
import { receiptStoreLines, formatExchangeReceipt, formatOrderReceipt, formatPreBill, getPairedPrinters, getSavedPrinter, openAndroidBluetoothSettings, paidTotalOf, printThermalExchangeReceipt, printThermalReceipt, printThermalSlip, savePrinter, type ExchangeReceipt, type PairedPrinter, type PreBill, type ReceiptOrder } from '../../lib/receipt-printer';
import { receiptHtml } from '../../lib/receipt-pdf';
import { ThermalPreview } from '../../components/thermal-preview';
import { ExchangeSheet, type ExchangeResult } from '../../components/exchange-sheet';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { useDebouncedValue, useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { PreviewImage } from '../../components/image-viewer';
import { DEPOSIT_SETTLE_PERMISSION, DepositSettlementSheet, closedDepositOf, depositSettlementErrorMessage, depositSettlementNotice, type DepositSettlement, type DepositSettlementResult } from '../../components/deposit-settlement-sheet';
import { PrinterPickerSheet } from '../../components/pos-flow';
import { shrinkPhotos } from '../../lib/photo';

type OrderLine = NonNullable<ReceiptOrder['items']>[number] & { id: string; note?: string | null; sentAt?: string | null };
/** A sent open bill line (or part of it) taken off before payment; kept for the audit trail. */
type ItemVoid = { id: string; productNameSnapshot: string; variantNameSnapshot: string | null; quantity: string; amount: string; reason: string; createdAt: string };
type PaymentLine = NonNullable<ReceiptOrder['payments']>[number] & { status: string };
type RefundEvidence = { id: string; url: string; fileName: string; createdAt: string };
/** How the deposit of a cancelled order was settled (POST /orders/:id/cancel-with-deposit). */
type DepositSettlementInfo = { depositSettlement?: DepositSettlement | null; depositSettledAt?: string | null; depositSettlementReason?: string | null; depositForfeitedAmount?: string | null };
type ExchangeSummary = { id: string; exchangeNumber: string; creditAmount: string; newOrderTotal: string; differenceAmount: string; status: string; voidReason?: string | null; createdAt: string };
/** An open bill carved out of another (split) or emptied into another (merge) points at that bill. */
type BillLinks = { splitFromOrderId?: string | null; mergedIntoOrderId?: string | null };
type Order = Omit<ReceiptOrder, 'items' | 'payments' | 'createdAt'> & DepositSettlementInfo & BillLinks & { createdAt: string; warehouseId?: string; customerId?: string | null; itemVoids?: ItemVoid[]; items?: OrderLine[]; payments?: PaymentLine[]; exchangesOut?: (ExchangeSummary & { newOrder: { id: string; orderNumber: string } })[]; exchangeIn?: (ExchangeSummary & { originalOrder: { id: string; orderNumber: string } }) | null; refunds?: { refundNumber?: string; exchangeId?: string | null; type?: string; method?: string; status: string; amount: string; reason: string; createdAt: string; items?: { orderItemId: string; quantity: string }[]; evidenceImages?: RefundEvidence[] }[] };
type CountResult = { meta: { total: number } };
const money = (value: string) => `Rp ${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
/** "Cash, QRIS": the methods of an order's completed payments, each once; empty while nothing is paid. */
/** Whether an order's money is already in a cash closing: every completed payment ('all'), only some ('partial'), or none. */
const closingStateOf = (payments: { status?: string; cashClosingId?: string | null }[] | undefined) => {
  const paid = (payments ?? []).filter((payment) => (payment.status ?? 'COMPLETED') === 'COMPLETED');
  const closed = paid.filter((payment) => payment.cashClosingId).length;
  return !paid.length || !closed ? 'none' : closed === paid.length ? 'all' : 'partial';
};
const closingStateLabel = { all: 'Sudah tutup kas', partial: 'Sebagian sudah tutup kas', none: 'Belum tutup kas' } as const;
const paymentMethodsLabel = (payments: { method: string; status?: string }[] | undefined) => [...new Set((payments ?? []).filter((payment) => (payment.status ?? 'COMPLETED') === 'COMPLETED').map((payment) => formatStatus(payment.method)))].join(', ');
const printStyles = StyleSheet.create({
  printCard: { marginBottom: 12, padding: 12, borderWidth: 1, borderColor: '#dceee5', borderRadius: 13, backgroundColor: '#fff' },
  printerInfo: { flexDirection: 'row', alignItems: 'center', gap: 9 }, printerLabels: { flex: 1, minWidth: 0 }, printTitle: { color: '#26384a', fontSize: 11, fontWeight: '900' }, printerLabel: { marginTop: 3, color: '#7b8b9b', fontSize: 9 },
  printButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, borderRadius: 10, backgroundColor: '#07885b' }, printButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' }, continueButton: { backgroundColor: '#1d5fbf' }, actionRow: { flexDirection: 'row', gap: 8 }, actionButton: { flex: 1 }, refundOpenButton: { borderWidth: 1, borderColor: '#f3c5c0', backgroundColor: '#fff4f2' }, refundOpenText: { color: '#b42318', fontSize: 11, fontWeight: '900' }, exchangeOpenButton: { borderWidth: 1, borderColor: '#c6d8f5', backgroundColor: '#f2f7ff' }, exchangeOpenText: { color: '#1d5fbf', fontSize: 11, fontWeight: '900' }, notice: { marginTop: 8, color: '#087f5b', fontSize: 10, fontWeight: '800', lineHeight: 15 }, printError: { marginTop: 8, color: '#a3332a', fontSize: 10, lineHeight: 15 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' }, printerSheet: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 25, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }, modalTitle: { color: '#172338', fontSize: 14, fontWeight: '900' }, closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' },
  printerLoader: { padding: 16 }, printerEmpty: { paddingVertical: 14, color: '#75869a', fontSize: 10, textAlign: 'center' }, printerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#edf1f3' }, settingsButton: { alignItems: 'center', marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: '#edf7f2' }, settingsText: { color: '#087f5b', fontSize: 10, fontWeight: '800' }, changePrinterButton: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, backgroundColor: '#edf7f2' }, changePrinterText: { color: '#087f5b', fontSize: 9, fontWeight: '900' },
});
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

const cents = (value: number) => Math.round(value * 100) / 100;

/** Indonesian text for the refund endpoint's error codes; anything unknown keeps the server message. */
function refundErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'REFUND_VALUE_MISMATCH') return 'Nominal refund tidak sama dengan nilai item yang dikembalikan. Muat ulang pesanan lalu coba lagi.';
    if (error.code === 'INVALID_REFUND_AMOUNT') return 'Nominal refund melebihi sisa yang bisa dikembalikan.';
    if (error.code === 'REFUND_QUANTITY_EXCEEDED') return 'Jumlah item yang dikembalikan melebihi jumlah yang terjual.';
    if (error.code === 'INVALID_REFUND_METHOD') return 'Refund lewat Grab/GoBiz hanya untuk pesanan yang dibayar lewat platform itu.';
    if (error.code === 'REFUND_REASON_REQUIRED') return 'Alasan pengembalian wajib diisi.';
    if (error.status === 403) return 'Akun ini tidak punya izin untuk refund.';
  }
  return error instanceof Error ? error.message : 'Pengembalian gagal diproses.';
}

export default function OrdersScreen() {
  const { authorizedRequest, user } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [selected, setSelected] = useState<Order | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim());
  const [rangePreset, setRangePreset] = useState<RangePreset | 'custom'>('today');
  // Picked with the Custom chip; only used while rangePreset is 'custom'.
  const [customRange, setCustomRange] = useState<CustomRange>(() => ({ from: jakartaDate(), to: jakartaDate() }));
  const [rangeSheetVisible, setRangeSheetVisible] = useState(false);
  const [rangeCounts, setRangeCounts] = useState<Partial<Record<RangePreset, number>>>({});
  const [error, setError] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [returnToStock, setReturnToStock] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState('');
  const [refundEvidence, setRefundEvidence] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [refundVisible, setRefundVisible] = useState(false);
  const [exchangeVisible, setExchangeVisible] = useState(false);
  const [notice, setNotice] = useState('');
  const [exchangeReceipt, setExchangeReceipt] = useState<ExchangeReceipt | null>(null);
  // A pre-bill (tagihan) of an unpaid order waiting in the thermal preview instead of the order receipt.
  const [preBill, setPreBill] = useState<{ title: string; text: string } | null>(null);
  const [voidTarget, setVoidTarget] = useState<NonNullable<Order['exchangesOut']>[number] | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');
  // "Batalkan Bill dengan DP" for an unfinished order whose deposit is already in a cash closing.
  const [settleVisible, setSettleVisible] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState('');
  const [printer, setPrinter] = useState<PairedPrinter | null>(null);
  const [printerPickerVisible, setPrinterPickerVisible] = useState(false);
  const [printerDevices, setPrinterDevices] = useState<PairedPrinter[]>([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  // The bill a split part came from or a merged bill went into, fetched for its number and opened from the link.
  const [linkedOrders, setLinkedOrders] = useState<Record<string, Order>>({});

  useEffect(() => {
    navigation.setOptions({
      title: selected ? 'Detail Pesanan' : 'Pesanan',
      headerLeft: selected ? () => <Pressable accessibilityRole="button" accessibilityLabel="Kembali ke daftar pesanan" hitSlop={8} onPress={() => { setSelected(null); setPrintError(''); }}><ChevronLeft size={22} color="#172338" /></Pressable> : undefined,
    });
  }, [navigation, selected]);

  useEffect(() => {
    if (!selected) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setSelected(null); setPrintError(''); return true; });
    return () => subscription.remove();
  }, [selected]);

  useEffect(() => { void getSavedPrinter().then(setPrinter).catch(() => setPrinter(null)); }, []);

  // Notifications deep-link here with ?orderId=; open that order's detail, then drop the param so back/refresh stay on the list.
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  useEffect(() => {
    if (!orderId) return;
    let active = true;
    void authorizedRequest<Order>(`orders/${orderId}`)
      .then((detail) => { if (active) void openOrder(detail); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Pesanan dari notifikasi tidak ditemukan.'); })
      .finally(() => router.setParams({ orderId: undefined }));
    return () => { active = false; };
    // openOrder only sets local state; re-running on its identity would reopen the same order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizedRequest, orderId]);

  const { from, to } = rangePreset === 'custom' ? customRange : getRange(rangePreset);
  const periodLabel = rangePreset === 'custom' ? customRangeLabel(customRange) : rangeLabel(rangePreset);
  const params = new URLSearchParams({ sortBy: 'createdAt', sortOrder: 'desc', from, to });
  if (search) params.set('search', search);
  const list = useInfiniteList<Order>(authorizedRequest, `orders?${params.toString()}`);
  const scrollProps = useLoadMoreOnScroll(list.loadMore);
  const orders = list.items;

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => void Promise.all(rangeOptions.map(async (item) => {
      const { from, to } = getRange(item.id);
      const params = new URLSearchParams({ page: '1', perPage: '10', from, to });
      if (search) params.set('search', search);
      const total = await authorizedRequest<CountResult>(`orders?${params.toString()}`).then((response) => response.meta.total).catch(() => undefined);
      return [item.id, total] as const;
    })).then((entries) => { if (active) setRangeCounts(Object.fromEntries(entries)); }), 300);
    return () => { active = false; clearTimeout(timer); };
  }, [authorizedRequest, search]);

  async function openOrder(order: Order) {
    setRefundAmount(''); setRefundReason(''); setReturnToStock(false); setReturnQuantities({}); setRefundEvidence([]); setRefundError('');
    // List rows carry only payment/refund amounts (no method or status), so the detail waits for GET orders/:id for those.
    setSelected({ ...order, payments: undefined, refunds: undefined }); setDetailLoading(true); setPrintError(''); setError(''); setNotice('');
    try { const detail = await authorizedRequest<Order>(`orders/${order.id}`); setSelected(detail); setRefundMethod(defaultRefundMethod(detail.payments)); loadLinkedOrders(detail); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat detail pesanan.'); }
    finally { setDetailLoading(false); }
  }

  /** Fetches the bills a split part or merged bill links to; failing only leaves the link without its number. */
  function loadLinkedOrders(order: Order) {
    for (const id of [order.splitFromOrderId, order.mergedIntoOrderId]) {
      if (!id || linkedOrders[id]) continue;
      void authorizedRequest<Order>(`orders/${id}`).then((linked) => setLinkedOrders((current) => ({ ...current, [id]: linked }))).catch(() => undefined);
    }
  }

  async function showPrinterPicker() {
    setPrinterPickerVisible(true); setPrinterLoading(true); setPrintError('');
    try { setPrinterDevices(await getPairedPrinters()); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Perangkat printer tidak dapat dimuat.'); }
    finally { setPrinterLoading(false); }
  }

  async function sendBluetoothReceipt(target: PairedPrinter) {
    if (!selected) return;
    setPrinting(true); setPrintError('');
    try { await (exchangeReceipt ? printThermalExchangeReceipt(exchangeReceipt, target) : preBill ? printThermalSlip(preBill.text, target) : printThermalReceipt(selected, target)); setPreviewVisible(false); setExchangeReceipt(null); setPreBill(null); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Nota gagal dicetak.'); }
    finally { setPrinting(false); }
  }

  async function choosePrinter(target: PairedPrinter) {
    setPrinterLoading(true); setPrintError('');
    // After choosing a printer the user reviews the receipt before it is sent.
    try { await savePrinter(target); setPrinter(target); setPrinterPickerVisible(false); setPreviewVisible(true); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Printer gagal disimpan.'); }
    finally { setPrinterLoading(false); }
  }

  /** Exchange receipts reuse the order receipt preview and printer; `originalOrderId` owns the exchange. */
  async function printExchange(originalOrderId: string, exchangeId: string) {
    setPrintError(''); setPrinting(true); setPreBill(null);
    try {
      const receipt = await authorizedRequest<ExchangeReceipt>(`orders/${originalOrderId}/exchanges/${exchangeId}`);
      if (Platform.OS === 'android') {
        setExchangeReceipt(receipt);
        if (!printer) await showPrinterPicker(); else setPreviewVisible(true);
      } else await Print.printAsync({ html: `<!doctype html><html><body><pre style="font:12px monospace">${escapeHtml(formatExchangeReceipt(receipt))}</pre></body></html>` });
    } catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Nota tukar barang gagal dimuat.'); }
    finally { setPrinting(false); }
  }

  async function submitVoidExchange() {
    if (!selected || !voidTarget) return;
    if (!voidReason.trim()) { setVoidError('Alasan pembatalan wajib diisi.'); return; }
    setVoiding(true); setVoidError('');
    try {
      await authorizedRequest(`orders/${selected.id}/exchanges/${voidTarget.id}/void`, { method: 'POST', body: JSON.stringify({ reason: voidReason.trim() }) });
      setNotice(`${voidTarget.exchangeNumber} dibatalkan. Pesanan ${voidTarget.newOrder.orderNumber} dibatalkan dan stok dikembalikan.`);
      setVoidTarget(null); setVoidReason('');
      setSelected(await authorizedRequest<Order>(`orders/${selected.id}`));
      await list.reload();
    } catch (cause) { setVoidError(cause instanceof Error ? cause.message : 'Tukar barang gagal dibatalkan.'); }
    finally { setVoiding(false); }
  }

  /** Pre-bill (tagihan) of an unpaid order through the receipt printer; the server counts the print so reprints are marked. */
  async function printPreBill() {
    if (!selected || detailLoading) return;
    setPrintError(''); setNotice(''); setExchangeReceipt(null); setPrinting(true);
    try {
      const bill = await authorizedRequest<PreBill>(`orders/${selected.id}/pre-bill`, { method: 'POST' });
      const text = formatPreBill(bill, user?.name ?? 'Kasir');
      if (Platform.OS === 'android') {
        setPreBill({ title: `Tagihan ${bill.orderNumber}`, text });
        if (!printer) await showPrinterPicker(); else setPreviewVisible(true);
      } else await Print.printAsync({ html: `<!doctype html><html><body><pre style="font:12px monospace">${escapeHtml(text)}</pre></body></html>` });
    } catch (cause) {
      setPrintError(cause instanceof ApiError && cause.code === 'INVALID_ORDER_STATE' ? 'Tagihan hanya bisa dicetak untuk pesanan yang belum dibayar.' : cause instanceof Error ? cause.message : 'Tagihan gagal dicetak.');
    } finally { setPrinting(false); }
  }

  /** Cancels the order and refunds or forfeits its deposit (order.deposit_settle); the response is the updated order. */
  async function settleDeposit(settlement: DepositSettlement, reason: string, stockAction: OpenBillStockAction) {
    if (!selected) return;
    setSettling(true); setSettleError('');
    try {
      const result = await authorizedRequest<Order & DepositSettlementResult>(`orders/${selected.id}/cancel-with-deposit`, { method: 'POST', body: JSON.stringify({ settlement, reason, stockAction }) });
      setSettleVisible(false); setSelected(result); setNotice(depositSettlementNotice(result));
      await list.reload();
    } catch (cause) { setSettleError(depositSettlementErrorMessage(cause)); }
    finally { setSettling(false); }
  }

  async function reprintOrder() {
    if (!selected || detailLoading) return;
    setPrintError(''); setPreBill(null); setExchangeReceipt(null);
    if (Platform.OS === 'android') {
      if (!printer) { await showPrinterPicker(); return; }
      setPreviewVisible(true);
      return;
    }
    setPrinting(true);
    try { await Print.printAsync({ html: receiptHtml(selected) }); }
    catch (cause) { setPrintError(cause instanceof Error ? cause.message : 'Nota gagal dicetak.'); }
    finally { setPrinting(false); }
  }

  const refundedAmount = (selected?.refunds ?? []).filter((refund) => refund.status === 'COMPLETED' && refund.type !== 'DEPOSIT').reduce((total, refund) => total + Number(refund.amount), 0);
  const refundableAmount = Math.max(0, Number(selected?.grandTotal ?? 0) - refundedAmount);
  const returnable = Boolean(selected && ['COMPLETED', 'PARTIALLY_REFUNDED'].includes(selected.status) && refundableAmount > 0);
  const canRefund = returnable && Boolean(user?.permissions.includes('order.refund'));
  const alreadyReturned = (lineId: string) => (selected?.refunds ?? []).filter((refund) => refund.status === 'COMPLETED').flatMap((refund) => refund.items ?? []).filter((item) => item.orderItemId === lineId).reduce((total, item) => total + Number(item.quantity), 0);
  // Mirrors the server: each returned line is worth its share of the grand total (discounts, tax and service included),
  // rounded to cents per line; returning everything left refunds exactly what remains, so rounding never blocks it.
  const subtotal = Number(selected?.subtotal ?? 0);
  const unitPaid = (item: OrderLine) => subtotal > 0 && Number(item.quantity) > 0 ? (Number(selected?.grandTotal ?? 0) * Number(item.totalPrice) / subtotal) / Number(item.quantity) : 0;
  const lineRefund = (item: OrderLine) => subtotal > 0 && Number(item.quantity) > 0 ? cents((Number(selected?.grandTotal ?? 0) * Number(item.totalPrice) / subtotal) * Number(returnQuantities[item.id] || 0) / Number(item.quantity)) : 0;
  const serverRemaining = Number(selected?.grandTotal ?? 0) - (selected?.refunds ?? []).filter((refund) => refund.status === 'COMPLETED').reduce((total, refund) => total + Number(refund.amount), 0);
  const returningEverything = (selected?.items ?? []).some((item) => Number(returnQuantities[item.id] || 0) > 0) && (selected?.items ?? []).every((item) => alreadyReturned(item.id) + Number(returnQuantities[item.id] || 0) === Number(item.quantity));
  const returnedAmount = returningEverything ? cents(serverRemaining) : cents((selected?.items ?? []).reduce((total, item) => total + lineRefund(item), 0));
  // Cashiers may exchange goods (only the difference moves money); cash refunds stay with admins.
  const canExchange = returnable && Boolean(user?.permissions.includes('order.exchange') && user.permissions.includes('order.create'));
  const canVoidExchange = Boolean(user?.permissions.includes('order.refund'));
  const canReadCustomer = Boolean(user?.permissions.includes('customer.read'));
  // An open bill is continued (add items, pay) in the POS; employees have it as the POS tab, admins as a stack route.
  const isEmployee = user?.roles.some((role) => role.toUpperCase() === 'PEGAWAI') ?? false;
  const canContinueBill = (order: Pick<Order, 'status' | 'mergedIntoOrderId'>) => order.status === 'OPEN' && !order.mergedIntoOrderId && Boolean(user?.permissions.includes('order.create'));
  const continueBill = (orderId: string) => router.push({ pathname: isEmployee ? '/(app)/(tabs)/kasir' : '/(app)/pos', params: { openBillId: orderId } });
  const openCustomer = (customerId: string) => router.push({ pathname: '/(app)/customer-detail', params: { id: customerId } });
  const canReprint = Boolean(selected && ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(selected.status) && selected.items?.length);
  // Unpaid orders get a pre-bill instead of a receipt; a deposit (DP) already taken shows with what is left to pay.
  const unpaid = Boolean(selected && ['DRAFT', 'OPEN', 'PENDING_PAYMENT'].includes(selected.status));
  const depositPaid = selected && unpaid ? paidTotalOf(selected) : 0;
  // Unfinished orders whose deposit a cash closing already counted can only be cancelled by settling that deposit.
  const closedDeposit = selected && ['DRAFT', 'OPEN', 'PENDING_PAYMENT', 'PAID'].includes(selected.status) ? closedDepositOf(selected.payments) : 0;
  const canCancelWithDeposit = closedDeposit > 0 && Boolean(user?.permissions.includes('order.cancel'));
  // A refunded DP left through deposit refunds (closed payments) plus the payments voided on cancel; a forfeited one is stored.
  const settledDeposit = selected?.depositSettlement === 'FORFEITED'
    ? Number(selected.depositForfeitedAmount ?? 0)
    : (selected?.refunds ?? []).filter((refund) => refund.type === 'DEPOSIT' && refund.status === 'COMPLETED').reduce((total, refund) => total + Number(refund.amount), 0)
      + (selected?.payments ?? []).filter((payment) => payment.status === 'VOIDED').reduce((total, payment) => total + Number(payment.amount), 0);

  async function selectRefundEvidence(useCamera: boolean) {
    if (refundEvidence.length >= 8) { setRefundError('Maksimal 8 foto bukti untuk satu refund.'); return; }
    const permission = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setRefundError(useCamera ? 'Izin kamera diperlukan untuk mengambil foto.' : 'Izin galeri diperlukan untuk memilih foto.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75, cameraType: ImagePicker.CameraType.back })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 8 - refundEvidence.length, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    const assets = await shrinkPhotos(result.assets);
    if (assets.some((asset) => Number(asset.fileSize ?? 0) > 5 * 1024 * 1024)) { setRefundError('Ukuran setiap foto bukti maksimal 5 MB.'); return; }
    setRefundEvidence((current) => [...current, ...assets].slice(0, 8));
    setRefundError('');
  }

  async function submitRefund() {
    if (!selected) return;
    setRefundError('');
    const amount = returnToStock ? returnedAmount : Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > refundableAmount) { setRefundError(`Nominal harus lebih dari 0 dan maksimal ${money(String(refundableAmount))}.`); return; }
    if (!refundReason.trim()) { setRefundError('Alasan pengembalian wajib diisi.'); return; }
    const items = Object.entries(returnQuantities).filter(([, quantity]) => Number(quantity) > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (returnToStock && !items.length) { setRefundError('Isi jumlah item yang dikembalikan ke stok.'); return; }
    const overLimit = (selected.items ?? []).find((item) => Number(returnQuantities[item.id] || 0) > Number(item.quantity) - alreadyReturned(item.id));
    if (returnToStock && overLimit) { setRefundError(`Jumlah retur ${overLimit.productNameSnapshot} melebihi sisa yang bisa dikembalikan.`); return; }
    setRefunding(true);
    try {
      const form = new FormData();
      form.append('method', refundMethod); form.append('amount', amount.toFixed(2)); form.append('reason', refundReason.trim()); form.append('returnToStock', String(returnToStock));
      if (returnToStock) form.append('items', JSON.stringify(items));
      refundEvidence.forEach((asset, index) => {
        const name = asset.fileName ?? asset.uri.split('/').pop() ?? `refund-${index}.jpg`;
        if (Platform.OS === 'web') {
          if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
          form.append('images', asset.file, name);
        } else form.append('images', new File(asset.uri), name);
      });
      await authorizedRequest(`orders/${selected.id}/refund`, { method: 'POST', body: form });
      setRefundAmount(''); setRefundReason(''); setReturnToStock(false); setReturnQuantities({}); setRefundEvidence([]); setRefundVisible(false);
      setSelected(await authorizedRequest<Order>(`orders/${selected.id}`));
      await list.reload();
    } catch (e) { setRefundError(refundErrorMessage(e)); }
    finally { setRefunding(false); }
  }

  async function finishExchange(result: ExchangeResult) {
    setExchangeVisible(false);
    const difference = Number(result.exchange.differenceAmount);
    const settlement = difference > 0 ? ` · pelanggan bayar ${money(String(difference))}` : difference < 0 ? ` · toko kembalikan ${money(String(-difference))}` : '';
    setNotice(`${result.exchange.exchangeNumber} berhasil. Pesanan baru ${result.newOrder.orderNumber}${settlement}.`);
    if (selected) setSelected(await authorizedRequest<Order>(`orders/${selected.id}`));
    await list.reload();
  }

  /** "Pecahan dari INV-…" / "Digabung ke INV-…": opens the linked bill once its number is loaded. */
  const billLink = (label: string, id: string | null | undefined) => id ? <View style={styles.row}><Text style={styles.muted}>{label}</Text><Pressable accessibilityRole="link" accessibilityHint="Buka detail bill" hitSlop={6} disabled={!linkedOrders[id]} onPress={() => { const linked = linkedOrders[id]; if (linked) void openOrder(linked); }} style={styles.customerLink}><Text style={[styles.value, styles.linkText]}>{linkedOrders[id]?.orderNumber ?? 'Memuat...'}</Text><ChevronRight size={14} color="#087f5b" /></Pressable></View> : null;

  if (selected) return <View style={styles.screen}><KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.page}>
    <Pressable accessibilityRole="button" accessibilityLabel="Kembali ke daftar pesanan" hitSlop={8} onPress={() => { setSelected(null); setPrintError(''); }} style={styles.back}><ChevronLeft size={18} color="#087f5b" /><Text style={styles.backText}>Kembali</Text><Text numberOfLines={1} style={styles.backOrder}>{selected.orderNumber}</Text></Pressable>
    <View style={printStyles.printCard}>
          <View style={printStyles.printerInfo}><Printer size={19} color="#087f5b" /><View style={printStyles.printerLabels}><Text style={printStyles.printTitle}>{unpaid ? 'Tagihan' : 'Nota pembayaran'}</Text><Text style={printStyles.printerLabel}>{Platform.OS === 'android' ? printer?.name ?? 'Printer Bluetooth belum dipilih' : 'Cetak atau simpan melalui dialog sistem'}</Text></View>{Platform.OS === 'android' ? <Pressable accessibilityRole="button" onPress={() => void showPrinterPicker()} style={printStyles.changePrinterButton}><Text style={printStyles.changePrinterText}>{printer ? 'Ganti' : 'Pilih'}</Text></Pressable> : null}</View>
          {canContinueBill(selected) ? <View style={printStyles.actionRow}>
            <Pressable accessibilityRole="button" accessibilityHint="Membuka bill ini di POS untuk menambah pesanan atau menerima pembayaran" disabled={detailLoading} onPress={() => continueBill(selected.id)} style={[printStyles.printButton, printStyles.actionButton, printStyles.continueButton, detailLoading && styles.disabled]}><ShoppingCart size={16} color="#fff" /><Text style={printStyles.printButtonText}>Lanjutkan proses</Text></Pressable>
          </View> : null}
          <View style={printStyles.actionRow}>
            {unpaid ? <Pressable accessibilityRole="button" accessibilityHint="Mencetak tagihan yang belum lunas, bukan bukti pembayaran" disabled={detailLoading || printing || !selected.items?.length} onPress={() => void printPreBill()} style={[printStyles.printButton, printStyles.actionButton, (detailLoading || printing || !selected.items?.length) && styles.disabled]}>{printing ? <ActivityIndicator color="#fff" /> : <><Printer size={16} color="#fff" /><Text style={printStyles.printButtonText}>Cetak Tagihan</Text></>}</Pressable>
              : <Pressable accessibilityRole="button" disabled={detailLoading || printing || !canReprint} onPress={() => void reprintOrder()} style={[printStyles.printButton, printStyles.actionButton, (detailLoading || printing || !canReprint) && styles.disabled]}>{printing ? <ActivityIndicator color="#fff" /> : <><Printer size={16} color="#fff" /><Text style={printStyles.printButtonText}>Cetak ulang nota</Text></>}</Pressable>}
          </View>
          {canRefund || canExchange ? <View style={printStyles.actionRow}>
            {canRefund ? <Pressable accessibilityRole="button" onPress={() => { setRefundError(''); setRefundVisible(true); }} style={[printStyles.printButton, printStyles.actionButton, printStyles.refundOpenButton]}><Undo2 size={16} color="#b42318" /><Text style={printStyles.refundOpenText}>Pengembalian</Text></Pressable> : null}
            {canExchange ? <Pressable accessibilityRole="button" onPress={() => setExchangeVisible(true)} style={[printStyles.printButton, printStyles.actionButton, printStyles.exchangeOpenButton]}><ArrowLeftRight size={16} color="#1d5fbf" /><Text style={printStyles.exchangeOpenText}>Tukar barang</Text></Pressable> : null}
          </View> : null}
          {canCancelWithDeposit ? <View style={printStyles.actionRow}>
            <Pressable accessibilityRole="button" accessibilityHint="Membatalkan pesanan dan mengembalikan atau menghanguskan DP yang sudah masuk tutup kas" disabled={detailLoading} onPress={() => { setSettleError(''); setSettleVisible(true); }} style={[printStyles.printButton, printStyles.actionButton, printStyles.refundOpenButton, detailLoading && styles.disabled]}><X size={16} color="#b42318" /><Text style={printStyles.refundOpenText}>Batalkan Bill dengan DP</Text></Pressable>
          </View> : null}
          {notice ? <Text style={printStyles.notice}>{notice}</Text> : null}
      {printError ? <Text style={printStyles.printError}>{printError}</Text> : null}
    </View>
      <View style={styles.card}><View style={styles.row}><Text style={styles.muted}>Status</Text><Text style={styles.status}>{formatStatus(selected.status)}</Text></View>{paymentMethodsLabel(selected.payments) ? <View style={styles.row}><Text style={styles.muted}>Metode bayar</Text><Text style={styles.value}>{paymentMethodsLabel(selected.payments)}</Text></View> : null}{paymentMethodsLabel(selected.payments) ? <View style={styles.row}><Text style={styles.muted}>Tutup kas</Text><Text style={[styles.value, closingStateOf(selected.payments) === 'all' && styles.closedValue]}>{closingStateLabel[closingStateOf(selected.payments)]}</Text></View> : null}<View style={styles.row}><Text style={styles.muted}>Cabang</Text><Text style={styles.value}>{selected.branch?.name ?? '—'}</Text></View>{selected.customerName || selected.customerPhone ? <View style={styles.row}><Text style={styles.muted}>Pelanggan</Text>{selected.customerId && canReadCustomer ? <Pressable accessibilityRole="link" accessibilityHint="Buka detail customer" hitSlop={6} onPress={() => openCustomer(selected.customerId!)} style={styles.customerLink}><Text style={[styles.value, styles.linkText]}>{customerLabel(selected.customerName, selected.customerPhone)}</Text><ChevronRight size={14} color="#087f5b" /></Pressable> : <Text style={styles.value}>{customerLabel(selected.customerName, selected.customerPhone)}</Text>}</View> : null}<View style={styles.row}><Text style={styles.muted}>Tanggal</Text><Text style={styles.value}>{formatDate(selected.createdAt)}</Text></View>{selected.serviceType ? <View style={styles.row}><Text style={styles.muted}>Layanan</Text><Text style={styles.value}>{formatServiceType(selected.serviceType)}</Text></View> : null}{billLink('Pecahan dari', selected.splitFromOrderId)}{billLink('Digabung ke', selected.mergedIntoOrderId)}<View style={styles.row}><Text style={styles.muted}>Total</Text><Text style={styles.total}>{money(selected.grandTotal)}</Text></View>{depositPaid > 0 ? <><View style={styles.row}><Text style={styles.muted}>Sudah dibayar (DP)</Text><Text style={styles.value}>{money(String(depositPaid))}</Text></View><View style={styles.row}><Text style={styles.muted}>Sisa tagihan</Text><Text style={styles.value}>{money(String(Number(selected.grandTotal) - depositPaid))}</Text></View></> : null}{selected.depositSettlement ? <><View style={styles.row}><Text style={styles.muted}>{selected.depositSettlement === 'FORFEITED' ? 'DP hangus' : 'DP dikembalikan'}</Text><Text style={styles.value}>{money(String(settledDeposit))}</Text></View>{selected.depositSettledAt ? <View style={styles.row}><Text style={styles.muted}>Waktu</Text><Text style={styles.value}>{formatDateTime(selected.depositSettledAt)}</Text></View> : null}{selected.depositSettlementReason ? <Text style={styles.muted}>Alasan: {selected.depositSettlementReason}</Text> : null}</> : null}</View>
    <Text style={styles.sectionTitle}>Item pesanan</Text>
    {(selected.items ?? []).map((item) => <View key={item.id} style={styles.line}><View style={styles.flex}><Text style={styles.value}>{item.productNameSnapshot}{item.variantNameSnapshot ? ` · ${item.variantNameSnapshot}` : ''}{item.isBonus ? ' (BONUS)' : ''}</Text><Text style={styles.muted}>{item.quantity} item{selected.status === 'OPEN' && item.sentAt ? ' · Terkirim ke dapur' : ''}</Text>{item.note ? <Text style={styles.muted}>Catatan: {item.note}</Text> : null}{item.addons?.map((addon, i) => <Text key={`${item.id}-${i}`} style={styles.muted}>+ {addon.addonNameSnapshot} × {addon.quantity}</Text>)}</View><Text style={styles.value}>{money(item.totalPrice)}</Text></View>)}
    {selected.itemVoids?.length ? <><Text style={styles.sectionTitle}>Item void</Text>
      {selected.itemVoids.map((entry) => <View key={entry.id} style={styles.line}><View style={styles.flex}><Text style={[styles.value, styles.struck]}>{entry.productNameSnapshot}{entry.variantNameSnapshot ? ` · ${entry.variantNameSnapshot}` : ''}</Text><Text style={styles.muted}>Void × {Number(entry.quantity)} · {formatDate(entry.createdAt)}</Text><Text style={styles.voidedText}>Alasan: {entry.reason}</Text></View><Text style={[styles.value, styles.struck]}>{money(entry.amount)}</Text></View>)}</> : null}
    <Text style={styles.sectionTitle}>Pembayaran</Text>
      {(selected.payments ?? []).map((payment, i) => <View key={`${payment.method}-${i}`} style={styles.line}><Text style={styles.value}>{formatStatus(payment.method)} · {formatStatus(payment.status)}{payment.cashClosingId ? ' · sudah tutup kas' : ''}</Text><Text style={styles.value}>{money(payment.amount)}</Text></View>)}
    {selected.exchangeIn || selected.exchangesOut?.length ? <><Text style={styles.sectionTitle}>Tukar barang</Text>
      {selected.exchangeIn ? <View style={styles.line}><View style={styles.flex}><Text style={styles.value}>Hasil tukar dari {selected.exchangeIn.originalOrder.orderNumber}</Text><Text style={styles.muted}>{selected.exchangeIn.exchangeNumber} · kredit {money(selected.exchangeIn.creditAmount)}{selected.exchangeIn.status === 'VOIDED' ? ' · Dibatalkan' : ''}</Text></View><Pressable accessibilityRole="button" disabled={printing} onPress={() => void printExchange(selected.exchangeIn!.originalOrder.id, selected.exchangeIn!.id)} style={styles.smallAction}><Text style={styles.smallActionText}>Nota</Text></Pressable></View> : null}
      {selected.exchangesOut?.map((exchange) => <View key={exchange.id} style={styles.exchangeRow}>
        <View style={styles.row}><View style={styles.flex}><Text style={styles.value}>Ditukar ke {exchange.newOrder.orderNumber}</Text><Text style={styles.muted}>{exchange.exchangeNumber} · {formatDate(exchange.createdAt)}</Text></View><Text style={styles.value}>{Number(exchange.differenceAmount) > 0 ? '+' : Number(exchange.differenceAmount) < 0 ? '−' : ''}{money(String(Math.abs(Number(exchange.differenceAmount))))}</Text></View>
        {exchange.status === 'VOIDED' ? <Text style={styles.voidedText}>Dibatalkan{exchange.voidReason ? `: ${exchange.voidReason}` : ''}</Text> : null}
        <View style={styles.exchangeActions}>
          <Pressable accessibilityRole="button" disabled={printing} onPress={() => void printExchange(selected.id, exchange.id)} style={styles.smallAction}><Text style={styles.smallActionText}>Nota</Text></Pressable>
          {canVoidExchange && exchange.status === 'COMPLETED' ? <Pressable accessibilityRole="button" onPress={() => { setVoidTarget(exchange); setVoidReason(''); setVoidError(''); }} style={[styles.smallAction, styles.smallDanger]}><Text style={[styles.smallActionText, styles.smallDangerText]}>Batalkan tukar</Text></Pressable> : null}
        </View>
      </View>)}</> : null}
    {(selected.refunds?.length ?? 0) > 0 ? <><Text style={styles.sectionTitle}>Pengembalian</Text>{selected.refunds?.map((refund, i) => <View key={`${refund.refundNumber ?? i}`} style={styles.refundHistory}><View style={styles.line}><View style={styles.flex}><Text style={styles.value}>{refund.refundNumber ?? 'Refund'}{refund.exchangeId ? ' · Tukar barang' : ''}{formatRefundType(refund.type) ? ` · ${formatRefundType(refund.type)}${refund.method ? ` ${formatStatus(refund.method)}` : ''}` : ''}</Text><Text style={styles.muted}>{refund.reason}</Text></View><Text style={styles.value}>{money(refund.amount)}</Text></View>{(refund.evidenceImages?.length ?? 0) > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.evidenceRow}>{refund.evidenceImages?.map((image, index, all) => <PreviewImage key={image.id} uri={image.url} images={all.map((entry) => entry.url)} index={index} style={styles.evidenceImage} />)}</ScrollView> : null}</View>)}</> : null}
  </KeyboardAwareScrollView>
  <Modal visible={refundVisible} transparent animationType="slide" onRequestClose={() => setRefundVisible(false)}><View style={printStyles.modalBackdrop}><View style={[styles.refundSheet, { paddingBottom: Math.max(insets.bottom + 8, 16) }]}>
    <View style={styles.refundSheetHeader}><View style={styles.flex}><Text style={styles.refundSheetTitle}>Proses pengembalian</Text><Text style={styles.muted}>{selected.orderNumber}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup form pengembalian" disabled={refunding} onPress={() => setRefundVisible(false)} style={styles.refundClose}><X size={18} color="#53677e" /></Pressable></View>
    <KeyboardAwareScrollView bottomOffset={24} style={styles.refundSheetBody} contentContainerStyle={styles.refundSheetContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>Sisa yang dapat dikembalikan: {money(String(refundableAmount))}</Text>
      <Text style={styles.fieldLabel}>Metode pengembalian</Text><View style={styles.methodRow}>{refundMethodsFor(selected.payments).map((method) => <Pressable key={method} onPress={() => setRefundMethod(method)} style={[styles.method, refundMethod === method && styles.methodSelected]}><Text style={[styles.methodText, refundMethod === method && styles.methodTextSelected]}>{formatStatus(method)}</Text></Pressable>)}</View>
      <Text style={styles.fieldLabel}>Alasan *</Text><TextInput accessibilityLabel="Alasan pengembalian" style={[styles.input, styles.multiline]} value={refundReason} onChangeText={setRefundReason} placeholder="Wajib diisi, contoh: barang rusak" placeholderTextColor="#87948c" multiline />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: returnToStock }} onPress={() => { setReturnToStock((value) => !value); setRefundError(''); }} style={styles.checkRow}><View style={[styles.checkbox, returnToStock && styles.checkboxChecked]}><Text style={styles.checkMark}>{returnToStock ? '✓' : ''}</Text></View><Text style={styles.value}>Kembalikan item ke stok</Text></Pressable>
      {returnToStock ? (selected.items ?? []).map((item) => { const max = Math.max(0, Number(item.quantity) - alreadyReturned(item.id)); return <View key={item.id} style={styles.returnLine}><View style={styles.flex}><Text style={styles.value}>{item.productNameSnapshot} (sisa {max})</Text><Text style={styles.muted}>{money(String(Math.round(unitPaid(item))))} / item</Text></View><TextInput accessibilityLabel={`Jumlah retur ${item.productNameSnapshot}`} keyboardType="decimal-pad" style={styles.quantityInput} value={returnQuantities[item.id] ?? ''} onChangeText={(value) => setReturnQuantities((current) => ({ ...current, [item.id]: value }))} placeholder="0" placeholderTextColor="#87948c" /></View>; }) : null}
      <Text style={styles.fieldLabel}>Nominal *</Text><MoneyInput accessibilityLabel="Nominal pengembalian" editable={!returnToStock} style={[styles.input, returnToStock && styles.inputReadonly]} value={returnToStock ? String(returnedAmount) : refundAmount} onChangeText={setRefundAmount} placeholder={String(refundableAmount)} placeholderTextColor="#87948c" />
      {returnToStock ? <Text style={styles.muted}>Dihitung otomatis dari jumlah item yang dikembalikan.</Text> : null}
      <Text style={styles.fieldLabel}>Bukti refund (opsional)</Text><Text style={styles.muted}>Maksimal 8 foto.</Text><View style={styles.evidenceActions}><Pressable onPress={() => void selectRefundEvidence(true)} style={styles.evidenceButton}><Text style={styles.evidenceButtonText}>Ambil foto</Text></Pressable><AdminOnly><Pressable onPress={() => void selectRefundEvidence(false)} style={styles.evidenceButton}><Text style={styles.evidenceButtonText}>Pilih galeri</Text></Pressable></AdminOnly></View>
      {refundEvidence.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.evidenceRow}>{refundEvidence.map((asset, index) => <View key={`${asset.assetId ?? asset.uri}-${index}`}><PreviewImage uri={asset.uri} images={refundEvidence.map((entry) => entry.uri)} index={index} style={styles.evidenceImage} /><Pressable accessibilityLabel={`Hapus foto ${index + 1}`} onPress={() => setRefundEvidence((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeEvidence}><Text style={styles.removeEvidenceText}>×</Text></Pressable></View>)}</ScrollView> : null}
    </KeyboardAwareScrollView>
    {refundError ? <Text style={[styles.errorText, styles.refundSheetError]}>{refundError}</Text> : null}
      <Pressable accessibilityRole="button" disabled={refunding || !refundReason.trim()} onPress={() => void submitRefund()} style={[styles.refundButton, styles.refundSheetButton, (refunding || !refundReason.trim()) && styles.disabled]}>{refunding ? <ActivityIndicator color="#fff" /> : <Text style={styles.refundButtonText}>Simpan pengembalian</Text>}</Pressable>
  </View></View></Modal>
  {settleVisible && canCancelWithDeposit ? <DepositSettlementSheet
    orderNumber={selected.orderNumber}
    payments={selected.payments}
    canSettle={Boolean(user?.permissions.includes(DEPOSIT_SETTLE_PERMISSION))}
    saving={settling}
    error={settleError}
    bottomInset={insets.bottom}
    onSubmit={(settlement, reason, stockAction) => void settleDeposit(settlement, reason, stockAction)}
    onClose={() => { setSettleVisible(false); setSettleError(''); }}
  /> : null}
  {canExchange && exchangeVisible ? <ExchangeSheet visible order={selected} onClose={() => setExchangeVisible(false)} onDone={(result) => void finishExchange(result)} /> : null}
  <ThermalPreview
    visible={previewVisible}
    title={exchangeReceipt ? `Nota ${exchangeReceipt.exchangeNumber}` : preBill ? preBill.title : `Nota ${selected.orderNumber}`}
    text={exchangeReceipt ? formatExchangeReceipt(exchangeReceipt) : preBill ? preBill.text : formatOrderReceipt(selected)}
    boldLines={exchangeReceipt || preBill ? 0 : receiptStoreLines(selected)}
    printer={printer}
    printing={printing}
    error={printError}
    onPrint={() => { if (printer) void sendBluetoothReceipt(printer); }}
    onChangePrinter={() => { setPreviewVisible(false); void showPrinterPicker(); }}
    onClose={() => { setPreviewVisible(false); setExchangeReceipt(null); setPreBill(null); setPrintError(''); }}
  />
  <Modal visible={Boolean(voidTarget)} transparent animationType="slide" onRequestClose={() => { if (!voiding) setVoidTarget(null); }}><View style={printStyles.modalBackdrop}><View style={[styles.refundSheet, { paddingBottom: Math.max(insets.bottom + 8, 16) }]}>
    <View style={styles.refundSheetHeader}><View style={styles.flex}><Text style={styles.refundSheetTitle}>Batalkan tukar barang</Text><Text style={styles.muted}>{voidTarget?.exchangeNumber}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup" disabled={voiding} onPress={() => setVoidTarget(null)} style={styles.refundClose}><X size={18} color="#53677e" /></Pressable></View>
    <View style={styles.refundSheetContent}>
      <Text style={styles.warningText}>Pesanan baru {voidTarget?.newOrder.orderNumber} akan dibatalkan, stok dikembalikan, dan pesanan asal dibuka kembali. Uang selisih yang sudah diterima atau dikembalikan perlu diselesaikan manual dengan pelanggan.</Text>
      <Text style={styles.fieldLabel}>Alasan *</Text><TextInput accessibilityLabel="Alasan pembatalan tukar barang" style={[styles.input, styles.multiline]} value={voidReason} onChangeText={setVoidReason} placeholder="Wajib diisi, contoh: salah input barang" placeholderTextColor="#87948c" multiline />
    </View>
    {voidError ? <Text style={[styles.errorText, styles.refundSheetError]}>{voidError}</Text> : null}
    <Pressable accessibilityRole="button" disabled={voiding || !voidReason.trim()} onPress={() => void submitVoidExchange()} style={[styles.refundButton, styles.refundSheetButton, styles.dangerButton, (voiding || !voidReason.trim()) && styles.disabled]}>{voiding ? <ActivityIndicator color="#fff" /> : <Text style={styles.refundButtonText}>Batalkan tukar barang</Text>}</Pressable>
  </View></View></Modal>
  {printerPickerVisible ? <PrinterPickerSheet devices={printerDevices} loading={printerLoading} error={printError} bottomInset={insets.bottom} onChoose={(target) => void choosePrinter(target)} onClose={() => setPrinterPickerVisible(false)} onOpenBluetoothSettings={() => { openAndroidBluetoothSettings(); setPrinterPickerVisible(false); }} /> : null}</View>;

  return <View style={styles.screen}><KeyboardAwareScrollView {...scrollProps} bottomOffset={24} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor="#087f5b" />}>
    <Text style={styles.subtitle}>Riwayat transaksi dan rincian pembayaran.</Text>
    <View style={styles.rangeControl}>{rangeOptions.map((item) => { const count = rangeCounts[item.id]; const active = rangePreset === item.id; return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label}${count !== undefined ? `, ${count} pesanan` : ''}`} accessibilityState={{ selected: active }} onPress={() => setRangePreset(item.id)} style={[styles.rangeButton, active && styles.rangeButtonActive]}>
      <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{item.label}</Text>
      {count ? <View style={[styles.rangeBadge, active && styles.rangeBadgeActive]}><Text style={[styles.rangeBadgeText, active && styles.rangeBadgeTextActive]}>{count > 99 ? '99+' : count}</Text></View> : null}
    </Pressable>; })}
      <Pressable accessibilityRole="button" accessibilityLabel={rangePreset === 'custom' ? `Custom, ${periodLabel}` : 'Pilih rentang tanggal'} accessibilityState={{ selected: rangePreset === 'custom' }} onPress={() => setRangeSheetVisible(true)} style={[styles.rangeButton, rangePreset === 'custom' && styles.rangeButtonActive]}>
        <Text numberOfLines={1} style={[styles.rangeText, rangePreset === 'custom' && styles.rangeTextActive]}>Custom</Text>
      </Pressable>
    </View>
    {rangePreset === 'custom' ? <Text style={styles.muted}>Periode: {periodLabel}</Text> : null}
    <TextInput style={styles.search} accessibilityLabel="Cari nomor pesanan" returnKeyType="search" value={searchInput} onChangeText={setSearchInput} placeholder="Cari nomor pesanan" placeholderTextColor="#87948c" autoCapitalize="characters" />
    {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
    {list.error && !orders.length ? <View style={styles.errorBox}><Text style={styles.errorText}>{list.error}</Text><Pressable accessibilityRole="button" onPress={() => void list.reload()}><Text style={styles.retry}>Coba lagi</Text></Pressable></View> : null}
    {list.loading && orders.length === 0 ? <ActivityIndicator style={styles.loader} color="#087f5b" /> : null}
      {orders.map((order) => { const closing = closingStateOf(order.payments); return <Pressable key={order.id} onPress={() => void openOrder(order)} style={({ pressed }) => [styles.orderCard, closing === 'all' && styles.orderCardClosed, closing === 'partial' && styles.orderCardPartial, pressed && styles.pressed]}><View style={styles.row}><Text style={styles.orderNumber}>{order.orderNumber}</Text><Text style={styles.status}>{order.mergedIntoOrderId ? 'Digabung' : formatStatus(order.status)}</Text></View><Text style={styles.muted}>{order.branch?.name ?? 'Cabang'} · {formatDate(order.createdAt)}{order.serviceType ? ` · ${formatServiceType(order.serviceType)}` : ''}{order.splitFromOrderId ? ' · Hasil split' : ''}</Text>{order.customerName || order.customerPhone ? order.customerId && canReadCustomer ? <Pressable accessibilityRole="link" accessibilityHint="Buka detail customer" hitSlop={4} onPress={() => openCustomer(order.customerId!)} style={styles.customerLink}><Text style={[styles.muted, styles.linkText]}>{customerLabel(order.customerName, order.customerPhone)}</Text><ChevronRight size={12} color="#087f5b" /></Pressable> : <Text style={styles.muted}>{customerLabel(order.customerName, order.customerPhone)}</Text> : null}{paymentMethodsLabel(order.payments) ? <Text style={styles.muted}>Bayar: {paymentMethodsLabel(order.payments)}</Text> : null}{paymentMethodsLabel(order.payments) ? <View style={[styles.closedTag, closing === 'partial' && styles.closedTagPartial, closing === 'none' && styles.closedTagOpen]}><Text style={[styles.closedTagText, closing === 'partial' && styles.closedTagTextPartial, closing === 'none' && styles.closedTagTextOpen]}>{closingStateLabel[closing]}</Text></View> : null}{order.status === 'OPEN' && paidTotalOf(order) > 0 ? <Text style={styles.muted}>DP {money(String(paidTotalOf(order)))} · sisa {money(String(Number(order.grandTotal) - paidTotalOf(order)))}</Text> : null}<View style={[styles.row, styles.orderFooter]}><Text style={styles.total}>{money(order.grandTotal)}</Text>{canContinueBill(order) ? <Pressable accessibilityRole="button" accessibilityLabel={`Lanjutkan proses ${order.orderNumber} di POS`} hitSlop={6} onPress={() => continueBill(order.id)} style={styles.continueChip}><ShoppingCart size={13} color="#fff" /><Text style={styles.continueChipText}>Lanjutkan</Text></Pressable> : <Text style={styles.detailLink}>Lihat detail  ›</Text>}</View></Pressable>; })}
    {!list.loading && !list.error && !orders.length ? <View style={styles.empty}><Text style={styles.value}>Belum ada pesanan</Text><Text style={styles.muted}>Tidak ada transaksi untuk periode {periodLabel.toLowerCase()}.</Text></View> : null}
    <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={orders.length} error={list.error} onRetry={list.loadMore} />
    {rangeSheetVisible ? <DateRangeSheet initial={customRange} bottomInset={insets.bottom} onApply={(range) => { setCustomRange(range); setRangePreset('custom'); setRangeSheetVisible(false); }} onClose={() => setRangeSheetVisible(false)} /> : null}
  </KeyboardAwareScrollView></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#f5f7f6' }, rangeControl: { flexDirection: 'row', gap: 4, marginBottom: 10, padding: 4, borderRadius: 11, backgroundColor: '#e9eef1' }, rangeButton: { flex: 1, minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 8 }, rangeButtonActive: { backgroundColor: '#07885f' }, rangeText: { color: '#63758b', fontSize: 9, fontWeight: '800' }, rangeTextActive: { color: '#fff' }, rangeBadge: { minWidth: 17, height: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: 9, backgroundColor: '#d92d2d' }, rangeBadgeActive: { backgroundColor: '#fff' }, rangeBadgeText: { color: '#fff', fontSize: 8, fontWeight: '900' }, rangeBadgeTextActive: { color: '#07885f' },page: { padding: 18, paddingBottom: 35 }, eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#172820', fontSize: 25, fontWeight: '900' }, subtitle: { marginTop: 5, marginBottom: 14, color: '#718078', fontSize: 12 }, search: { height: 46, marginBottom: 12, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dce4df', borderRadius: 13, backgroundColor: '#fff', color: '#172820' }, loader: { margin: 18 }, orderCard: { marginBottom: 9, padding: 14, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 15, backgroundColor: '#fff' }, orderCardClosed: { borderLeftWidth: 4, borderLeftColor: '#07885b' }, orderCardPartial: { borderLeftWidth: 4, borderLeftColor: '#e0a526' }, pressed: { borderColor: '#a8d7c2', backgroundColor: '#f7fcf9' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, orderNumber: { color: '#172820', fontSize: 14, fontWeight: '900' }, status: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#e7f5ee', color: '#087f5b', fontSize: 9, fontWeight: '900' }, muted: { marginTop: 5, color: '#84918b', fontSize: 10 }, value: { color: '#34453b', fontSize: 12, fontWeight: '700' }, total: { color: '#087f5b', fontSize: 15, fontWeight: '900' }, orderFooter: { marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#edf1ee' }, detailLink: { color: '#087f5b', fontSize: 11, fontWeight: '800' }, closedTag: { alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: '#ddf8eb' }, closedTagPartial: { backgroundColor: '#fff4dc' }, closedTagText: { color: '#087f57', fontSize: 9, fontWeight: '900' }, closedTagTextPartial: { color: '#9a6400' }, closedTagOpen: { backgroundColor: '#eef2f5' }, closedTagTextOpen: { color: '#63758b' }, closedValue: { color: '#087f57' }, continueChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: '#1d5fbf' }, continueChipText: { color: '#fff', fontSize: 10, fontWeight: '900' }, empty: { alignItems: 'center', marginTop: 14, padding: 22, borderRadius: 15, backgroundColor: '#fff' }, disabled: { opacity: 0.4 }, errorBox: { padding: 13, borderRadius: 13, backgroundColor: '#fff1f0' }, errorText: { color: '#a3332a', fontSize: 11 }, retry: { marginTop: 8, color: '#087f5b', fontSize: 11, fontWeight: '900' }, card: { marginTop: 16, padding: 14, borderRadius: 15, backgroundColor: '#fff' }, sectionTitle: { marginTop: 19, marginBottom: 7, color: '#172820', fontSize: 14, fontWeight: '900' }, line: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#e8eeea' }, flex: { flex: 1 }, back: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: 10, paddingRight: 10 }, backText: { color: '#087f5b', fontSize: 12, fontWeight: '800' }, backOrder: { marginLeft: 6, color: '#84918b', fontSize: 11, fontWeight: '700' }, refundSheet: { maxHeight: '90%', paddingTop: 14, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' }, refundSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#edf1ee' }, refundSheetTitle: { color: '#172820', fontSize: 15, fontWeight: '900' }, refundClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' }, refundSheetBody: { flexGrow: 0 }, refundSheetContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }, refundSheetError: { marginHorizontal: 16, marginTop: 8 }, refundSheetButton: { marginHorizontal: 16 }, inputReadonly: { backgroundColor: '#f1f5f2', color: '#087f5b', fontWeight: '900' }, refundCard: { marginTop: 20, padding: 14, borderRadius: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6ece8' }, fieldLabel: { marginTop: 13, marginBottom: 6, color: '#34453b', fontSize: 11, fontWeight: '800' }, input: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, color: '#172820', backgroundColor: '#fff' }, multiline: { minHeight: 76, paddingTop: 11, textAlignVertical: 'top' }, methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, method: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f1f5f2' }, methodSelected: { backgroundColor: '#e7f5ee' }, methodText: { color: '#718078', fontSize: 9, fontWeight: '800' }, methodTextSelected: { color: '#087f5b' }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16, minHeight: 44 }, checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#b8c8bf', borderRadius: 6 }, checkboxChecked: { borderColor: '#087f5b', backgroundColor: '#087f5b' }, checkMark: { color: '#fff', fontWeight: '900' }, returnLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }, quantityInput: { width: 74, height: 40, textAlign: 'center', borderWidth: 1, borderColor: '#dce4df', borderRadius: 10, color: '#172820' }, refundHistory: { borderBottomWidth: 1, borderBottomColor: '#e8eeea', paddingBottom: 8 }, evidenceActions: { flexDirection: 'row', gap: 8, marginTop: 8 }, evidenceButton: { flex: 1, alignItems: 'center', padding: 11, borderRadius: 10, backgroundColor: '#e7f5ee' }, evidenceButtonText: { color: '#087f5b', fontSize: 11, fontWeight: '800' }, evidenceRow: { gap: 8, paddingVertical: 9 }, evidenceImage: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#edf1ee' }, removeEvidence: { position: 'absolute', top: 3, right: 3, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#a3332a' }, removeEvidenceText: { color: '#fff', fontSize: 16, fontWeight: '900', lineHeight: 18 }, refundButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 13, borderRadius: 12, backgroundColor: '#087f5b' }, refundButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' }, exchangeRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#e8eeea' }, exchangeActions: { flexDirection: 'row', gap: 8, marginTop: 8 }, smallAction: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: '#e7f5ee' }, smallActionText: { color: '#087f5b', fontSize: 10, fontWeight: '900' }, smallDanger: { backgroundColor: '#fff1f0' }, smallDangerText: { color: '#b42318' }, voidedText: { marginTop: 5, color: '#b42318', fontSize: 10, fontWeight: '800' }, warningText: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#fff7e6', color: '#8a5a00', fontSize: 11, lineHeight: 16 }, dangerButton: { backgroundColor: '#b42318' }, struck: { color: '#9aa6b4', textDecorationLine: 'line-through' }, customerLink: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' }, linkText: { color: '#087f5b', fontWeight: '800' } });
