import * as SecureStore from 'expo-secure-store';
import { PermissionsAndroid, Platform } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { customerLabel, formatDate, formatStatus } from './display';

export type PairedPrinter = { name: string; address: string };
export type ReceiptLine = {
  productNameSnapshot: string;
  variantNameSnapshot?: string | null;
  quantity: string;
  inputQuantity?: string | null;
  unit?: { code: string } | null;
  unitPrice: string;
  totalPrice: string;
  note?: string | null;
  addons?: { addonNameSnapshot: string; quantity: string; totalPrice: string }[];
};
export type ReceiptOrder = {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  discountAmount: string;
  taxAmount?: string;
  serviceCharge?: string;
  grandTotal: string;
  customerName?: string | null;
  customerPhone?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  branch?: { name: string; code?: string } | null;
  items?: ReceiptLine[];
  /**
   * `status` and `cashClosingId` are present on order details (GET /orders/:id); only COMPLETED payments count as paid,
   * and one with a cashClosingId was already counted by a cash closing.
   */
  payments?: { method: string; amount: string; receivedAmount?: string | null; changeAmount?: string | null; status?: string; cashClosingId?: string | null }[];
};
export type CashClosingReceipt = {
  closingNumber: string;
  status: string;
  transactionCount: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  createdAt?: string | null;
  closedAt?: string | null;
  cashSales?: string;
  qrisSales?: string;
  transferSales?: string;
  grabSales?: string;
  gobizSales?: string;
  cardSales?: string;
  otherSales?: string;
  totalSales?: string;
  cashIn?: string;
  cashOut?: string;
  cashRefund?: string;
  qrisRefund?: string;
  transferRefund?: string;
  grabRefund?: string;
  gobizRefund?: string;
  cardRefund?: string;
  otherRefund?: string;
  totalRefund?: string;
  expectedCash?: string;
  actualCash?: string;
  difference?: string;
  note?: string | null;
};

const SAVED_PRINTER_KEY = 'inventory.bluetooth.receipt-printer.v1';
const PRINTER_NAME = /printer|thermal|pos|receipt|rpp|mtp|xp[- ]|pt[- ]|58|80/i;

async function ensureAndroidBluetoothAccess() {
  if (Platform.OS !== 'android') throw new Error('Cetak Bluetooth tersedia di Android.');
  if (!(await RNBluetoothClassic.isBluetoothAvailable())) throw new Error('Perangkat ini tidak mendukung Bluetooth.');
  if (Number(Platform.Version) >= 31) {
    const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    const result = await PermissionsAndroid.request(permission, {
      title: 'Izin printer Bluetooth',
      message: 'Aplikasi perlu mengakses printer Bluetooth yang sudah dipasangkan.',
      buttonPositive: 'Izinkan',
      buttonNegative: 'Batal',
    });
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Izin Bluetooth belum diberikan.');
  }
  if (!(await RNBluetoothClassic.isBluetoothEnabled())) {
    const enabled = await RNBluetoothClassic.requestBluetoothEnabled();
    if (!enabled || !(await RNBluetoothClassic.isBluetoothEnabled())) throw new Error('Aktifkan Bluetooth untuk mencetak nota.');
  }
}

export async function getPairedPrinters(): Promise<PairedPrinter[]> {
  await ensureAndroidBluetoothAccess();
  const devices = await RNBluetoothClassic.getBondedDevices();
  return devices
    .filter((device) => Boolean(device.address))
    .map(({ name, address }) => ({ name: name || 'Perangkat Bluetooth', address }))
    .sort((a, b) => Number(PRINTER_NAME.test(b.name)) - Number(PRINTER_NAME.test(a.name)) || a.name.localeCompare(b.name));
}

export async function getSavedPrinter(): Promise<PairedPrinter | null> {
  const raw = await SecureStore.getItemAsync(SAVED_PRINTER_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as PairedPrinter;
    return saved.name && saved.address ? saved : null;
  } catch {
    return null;
  }
}

export async function savePrinter(printer: PairedPrinter) {
  await SecureStore.setItemAsync(SAVED_PRINTER_KEY, JSON.stringify(printer));
}

export function openAndroidBluetoothSettings() {
  if (Platform.OS === 'android') RNBluetoothClassic.openBluetoothSettings();
}

const safeText = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x20-\x7E]/g, '');

const rupiah = (value: number) => `Rp ${Math.max(0, value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const cashRupiah = (value: unknown) => `Rp ${Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const fit = (value: unknown, width: number) => safeText(value).slice(0, width);
const columns = (left: unknown, right: unknown, width: number) => {
  const rightText = fit(right, width);
  const leftText = fit(left, Math.max(0, width - rightText.length - 1));
  return `${leftText}${' '.repeat(Math.max(1, width - leftText.length - rightText.length))}${rightText}`;
};

function wrap(value: unknown, width: number) {
  const words = safeText(value).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word.slice(0, width);
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word.slice(0, width); }
  }
  if (line) lines.push(line);
  return lines;
}

/** "Pelanggan: Budi · 0812…" on customer-facing printouts; nothing for a guest without name or phone. */
const customerLines = (name: string | null | undefined, phone: string | null | undefined, width: number) => name || phone ? wrap(`Pelanggan: ${customerLabel(name, phone)}`, width) : [];

const isCompleted = (payment: { status?: string }) => (payment.status ?? 'COMPLETED') === 'COMPLETED';

/** Sum of the completed payments on an order, i.e. the deposit (DP) already taken on an unpaid bill. */
export const paidTotalOf = (order: Pick<ReceiptOrder, 'payments'>) => (order.payments ?? []).filter(isCompleted).reduce((sum, payment) => sum + Number(payment.amount), 0);

function receiptText(order: ReceiptOrder, width: number) {
  const rule = '-'.repeat(width);
  const date = order.completedAt ?? order.createdAt;
  const lines = [
    ...wrap(order.branch?.name ?? 'INVENTORY REPLENISHMENT', width),
    ...(order.branch?.code ? [fit(order.branch.code, width)] : []),
    rule,
    fit(order.orderNumber, width),
    ...(date ? [fit(formatDate(date), width)] : []),
    ...customerLines(order.customerName, order.customerPhone, width),
    rule,
  ];

  for (const item of order.items ?? []) {
    lines.push(...wrap(`${item.productNameSnapshot}${item.variantNameSnapshot ? ` (${item.variantNameSnapshot})` : ''}`, width));
    const addonTotal = (item.addons ?? []).reduce((sum, addon) => sum + Number(addon.totalPrice), 0);
    lines.push(columns(`${item.inputQuantity ?? item.quantity} ${item.unit?.code ?? ''} x ${rupiah(Number(item.unitPrice))}`, rupiah(Math.max(0, Number(item.totalPrice) - addonTotal)), width));
    for (const addon of item.addons ?? []) lines.push(...wrap(`+ ${addon.addonNameSnapshot} x ${addon.quantity} ${rupiah(Number(addon.totalPrice))}`, width));
  }

  lines.push(rule, columns('Subtotal', rupiah(Number(order.subtotal)), width));
  lines.push(columns('Diskon', `-${rupiah(Number(order.discountAmount))}`, width));
  if (Number(order.taxAmount ?? 0) > 0) lines.push(columns('Pajak', rupiah(Number(order.taxAmount)), width));
  if (Number(order.serviceCharge ?? 0) > 0) lines.push(columns('Layanan', rupiah(Number(order.serviceCharge)), width));
  lines.push(columns('TOTAL', rupiah(Number(order.grandTotal)), width));
  // Voided payments are not money taken, so they stay off the receipt.
  for (const payment of (order.payments ?? []).filter(isCompleted)) {
    lines.push(columns(formatStatus(payment.method), rupiah(Number(payment.amount)), width));
    if (payment.receivedAmount) lines.push(columns('Diterima', rupiah(Number(payment.receivedAmount)), width));
    if (Number(payment.changeAmount ?? 0) > 0) lines.push(columns('Kembalian', rupiah(Number(payment.changeAmount)), width));
  }
  lines.push(rule, 'Terima kasih');
  return lines.join('\n');
}

const receiptDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' });
};

const receiptDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${receiptDate(value)} ${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' })}`;
};

const center = (value: unknown, width: number) => {
  const text = fit(value, width);
  return `${' '.repeat(Math.floor((width - text.length) / 2))}${text}`;
};

export function formatCashClosingReceipt(closing: CashClosingReceipt, width = 32) {
  const rule = '-'.repeat(width);
  const sales: [string, unknown][] = [
    ['Cash Sales', closing.cashSales],
    ['QRIS Sales', closing.qrisSales],
    ['Transfer Sales', closing.transferSales],
    ['E-Wallet Sales', Number(closing.grabSales ?? 0) + Number(closing.gobizSales ?? 0)],
    ['Card Sales', closing.cardSales],
    ['Other Sales', closing.otherSales],
  ];
  const refunds: [string, unknown][] = [
    ['Cash Refund', closing.cashRefund],
    ['QRIS Refund', closing.qrisRefund],
    ['Transfer Refund', closing.transferRefund],
    ['E-Wallet Refund', Number(closing.grabRefund ?? 0) + Number(closing.gobizRefund ?? 0)],
    ['Card Refund', closing.cardRefund],
    ['Other Refund', closing.otherRefund],
  ];
  const lines = [
    center('CASH CLOSING REPORT', width),
    center(closing.closingNumber, width),
    '',
    ...wrap(`Period Start : ${receiptDate(closing.periodStart)}`, width),
    ...wrap(`Period End   : ${receiptDate(closing.periodEnd)}`, width),
    ...wrap(`Transaction  : ${closing.transactionCount}`, width),
    ...wrap(`Created At   : ${receiptDateTime(closing.createdAt ?? closing.closedAt)}`, width),
    rule,
    'SALES',
    ...sales.map(([label, value]) => columns(label, cashRupiah(value), width)),
    rule,
    columns('TOTAL SALES', cashRupiah(closing.totalSales), width),
    rule,
    'CASH MOVEMENT',
    columns('Cash In', cashRupiah(closing.cashIn), width),
    columns('Cash Out', cashRupiah(closing.cashOut), width),
    rule,
    columns('NET CASH MOVEMENT', cashRupiah(Number(closing.cashIn ?? 0) - Number(closing.cashOut ?? 0)), width),
    rule,
    'REFUND',
    ...refunds.map(([label, value]) => columns(label, cashRupiah(value), width)),
    rule,
    columns('TOTAL REFUND', cashRupiah(closing.totalRefund), width),
    rule,
    columns('EXPECTED CASH', cashRupiah(closing.expectedCash), width),
    columns('ACTUAL CASH', cashRupiah(closing.actualCash), width),
    rule,
    columns('DIFFERENCE', cashRupiah(closing.difference), width),
    rule,
    columns('STATUS', formatStatus(closing.status).toLocaleUpperCase('id-ID'), width),
    ...wrap(`NOTE ${closing.note || '-'}`, width),
    rule,
    '',
    center('Prepared By', width),
    center('Approved By', width),
    '',
    columns('(____________)', '(____________)', width),
  ];
  return lines.join('\n');
}

async function printThermalText(text: string, printer: PairedPrinter) {
  await ensureAndroidBluetoothAccess();
  const paired = await RNBluetoothClassic.getBondedDevices();
  const device = paired.find((candidate) => candidate.address === printer.address);
  if (!device) throw new Error('Printer pilihan tidak lagi dipasangkan. Pasangkan kembali dari pengaturan Bluetooth.');

  const connected = (await RNBluetoothClassic.isDeviceConnected(printer.address))
    ? await RNBluetoothClassic.getConnectedDevice(printer.address)
    : await RNBluetoothClassic.connectToDevice(printer.address);
  if (!(await connected.isConnected())) throw new Error(`Gagal tersambung ke ${printer.name}. Pastikan printer menyala.`);

  const payload = `${String.fromCharCode(0x1b, 0x40)}${text}\n\n\n\n${String.fromCharCode(0x1b, 0x64, 3)}`;
  if (!(await connected.write(payload, 'ascii'))) throw new Error('Printer tidak menerima nota. Periksa koneksi dan dukungan ESC/POS.');
}

/** Characters per line on 58 mm thermal paper; previews use the same width as the printer. */
export const THERMAL_WIDTH = 32;

/** The exact text sent to the thermal printer for an order receipt. */
export function formatOrderReceipt(order: ReceiptOrder, width = THERMAL_WIDTH) {
  return receiptText(order, width);
}

export async function printThermalReceipt(order: ReceiptOrder, printer: PairedPrinter) {
  await printThermalText(formatOrderReceipt(order), printer);
}

/** Sends already formatted text (pre-bill, DP receipt, kitchen ticket) to the thermal printer. */
export async function printThermalSlip(text: string, printer: PairedPrinter) {
  await printThermalText(text, printer);
}

/** POST /orders/:id/pre-bill: the unpaid order plus its print count (already incremented, so 1 = first print) and the deposit taken. */
export type PreBill = ReceiptOrder & { preBillPrintCount: number; preBillPrintedAt?: string | null; paidTotal: string | number; balanceDue: string | number };

/** Tagihan (pre-bill): what the customer owes before paying. Marked as not a proof of payment; reprints are numbered. Voided lines are no longer on the order. */
export function formatPreBill(bill: PreBill, cashierName: string, width = THERMAL_WIDTH) {
  const rule = '-'.repeat(width);
  const paid = Number(bill.paidTotal);
  return [
    ...wrap(bill.branch?.name ?? 'INVENTORY REPLENISHMENT', width).map((line) => center(line, width)),
    center('TAGIHAN', width),
    center('BELUM LUNAS', width),
    center('BUKAN BUKTI PEMBAYARAN', width),
    ...(bill.preBillPrintCount > 1 ? [center(`CETAK ULANG ke-${bill.preBillPrintCount}`, width)] : []),
    rule,
    fit(bill.orderNumber, width),
    fit(receiptDateTime(bill.preBillPrintedAt ?? new Date().toISOString()), width),
    ...wrap(`Kasir: ${cashierName}`, width),
    ...customerLines(bill.customerName, bill.customerPhone, width),
    rule,
    ...(bill.items ?? []).flatMap((item) => {
      const addonTotal = (item.addons ?? []).reduce((sum, addon) => sum + Number(addon.totalPrice), 0);
      return [
        ...wrap(`${item.productNameSnapshot}${item.variantNameSnapshot ? ` (${item.variantNameSnapshot})` : ''}`, width),
        columns(`${Number(item.inputQuantity ?? item.quantity)} ${item.unit?.code ?? ''} x ${rupiah(Number(item.unitPrice))}`, rupiah(Math.max(0, Number(item.totalPrice) - addonTotal)), width),
        ...(item.addons ?? []).flatMap((addon) => wrap(`+ ${addon.addonNameSnapshot} x ${Number(addon.quantity)} ${rupiah(Number(addon.totalPrice))}`, width)),
        ...(item.note ? wrap(`  Catatan: ${item.note}`, width) : []),
      ];
    }),
    rule,
    columns('Subtotal', rupiah(Number(bill.subtotal)), width),
    columns('Diskon', `-${rupiah(Number(bill.discountAmount))}`, width),
    ...(Number(bill.taxAmount ?? 0) > 0 ? [columns('Pajak', rupiah(Number(bill.taxAmount)), width)] : []),
    ...(Number(bill.serviceCharge ?? 0) > 0 ? [columns('Layanan', rupiah(Number(bill.serviceCharge)), width)] : []),
    columns('TOTAL', rupiah(Number(bill.grandTotal)), width),
    ...(paid > 0 ? [columns('Sudah dibayar (DP)', rupiah(paid), width), columns('Sisa tagihan', rupiah(Number(bill.balanceDue)), width)] : []),
    rule,
    center('BELUM LUNAS', width),
  ].join('\n');
}

/** A deposit (DP) just taken on an open bill: the payment itself and what is left to pay. */
export type DepositReceipt = {
  order: Pick<ReceiptOrder, 'orderNumber' | 'grandTotal' | 'customerName' | 'customerPhone' | 'branch'>;
  payment: { method: string; amount: string | number; receivedAmount?: string | number | null; changeAmount?: string | number | null };
  /** All deposits on the bill so far, this one included. */
  paidTotal: number;
  cashierName: string;
  paidAt: string;
};

export function formatDepositReceipt(receipt: DepositReceipt, width = THERMAL_WIDTH) {
  const rule = '-'.repeat(width);
  const { order, payment } = receipt;
  const amount = Number(payment.amount);
  return [
    ...wrap(order.branch?.name ?? 'INVENTORY REPLENISHMENT', width).map((line) => center(line, width)),
    center('BUKTI DP', width),
    rule,
    fit(order.orderNumber, width),
    fit(receiptDateTime(receipt.paidAt), width),
    ...wrap(`Kasir: ${receipt.cashierName}`, width),
    ...customerLines(order.customerName, order.customerPhone, width),
    rule,
    columns('Total bill', rupiah(Number(order.grandTotal)), width),
    columns(`DP ${formatStatus(payment.method)}`, rupiah(amount), width),
    ...(payment.receivedAmount ? [columns('Diterima', rupiah(Number(payment.receivedAmount)), width)] : []),
    ...(Number(payment.changeAmount ?? 0) > 0 ? [columns('Kembalian', rupiah(Number(payment.changeAmount)), width)] : []),
    ...(receipt.paidTotal > amount ? [columns('Total DP dibayar', rupiah(receipt.paidTotal), width)] : []),
    columns('Sisa tagihan', rupiah(Number(order.grandTotal) - receipt.paidTotal), width),
    rule,
    center('Simpan bukti ini untuk pelunasan', width),
  ].join('\n');
}

/** Lines just sent to the kitchen (POST orders/:id/open-bill/send `sentItems`) with the bill they belong to. */
export type KitchenTicket = {
  orderNumber: string;
  customerName?: string | null;
  customerPhone?: string | null;
  sentAt: string;
  items: {
    productNameSnapshot: string;
    variantNameSnapshot?: string | null;
    quantity: string;
    inputQuantity?: string | null;
    unit?: { code: string } | null;
    note?: string | null;
    addons?: { addonNameSnapshot: string; quantity: string }[];
  }[];
};

/** Kitchen ticket: what to make, without prices. */
export function formatKitchenTicket(ticket: KitchenTicket, width = THERMAL_WIDTH) {
  const rule = '-'.repeat(width);
  return [
    center('TIKET DAPUR', width),
    center(ticket.orderNumber, width),
    center(receiptDateTime(ticket.sentAt), width),
    ...customerLines(ticket.customerName, ticket.customerPhone, width),
    rule,
    ...ticket.items.flatMap((item) => [
      ...wrap(`${Number(item.inputQuantity ?? item.quantity)}${item.unit?.code ? ` ${item.unit.code}` : ''} x ${item.productNameSnapshot}${item.variantNameSnapshot ? ` (${item.variantNameSnapshot})` : ''}`, width),
      ...(item.addons ?? []).flatMap((addon) => wrap(`  + ${addon.addonNameSnapshot} x ${Number(addon.quantity)}`, width)),
      ...(item.note ? wrap(`  Catatan: ${item.note}`, width) : []),
    ]),
    rule,
  ].join('\n');
}

/** Shape of GET orders/:id/exchanges/:exchangeId. */
export type ExchangeReceipt = {
  exchangeNumber: string;
  status: string;
  reason: string;
  voidReason?: string | null;
  createdAt: string;
  creditAmount: string;
  newOrderTotal: string;
  differenceAmount: string;
  branch: { name: string };
  originalOrder: { orderNumber: string; customerName?: string | null; customerPhone?: string | null };
  newOrder: { orderNumber: string };
  returned: { name: string; quantity: string; unit: string; amount: string }[];
  replacements: { name: string; quantity: string; unit: string; amount: string; addons: string[] }[];
  settlements: { method: string; amount: string }[];
};

export function formatExchangeReceipt(exchange: ExchangeReceipt, width = THERMAL_WIDTH) {
  const rule = '-'.repeat(width);
  const difference = Number(exchange.differenceAmount);
  const goods = (line: { name: string; quantity: string; unit: string; amount: string }) => [...wrap(line.name, width), columns(`${Number(line.quantity)} ${line.unit}`, cashRupiah(line.amount), width)];
  return [
    center(exchange.branch.name, width),
    center(exchange.status === 'VOIDED' ? 'TUKAR BARANG DIBATALKAN' : 'BUKTI TUKAR BARANG', width),
    center(exchange.exchangeNumber, width),
    center(receiptDateTime(exchange.createdAt), width),
    rule,
    columns('Pesanan asal', exchange.originalOrder.orderNumber, width),
    columns('Pesanan baru', exchange.newOrder.orderNumber, width),
    ...customerLines(exchange.originalOrder.customerName, exchange.originalOrder.customerPhone, width),
    rule,
    'DIKEMBALIKAN',
    ...exchange.returned.flatMap(goods),
    rule,
    'PENGGANTI',
    ...exchange.replacements.flatMap((line) => [...goods(line), ...line.addons.flatMap((addon) => wrap(`+ ${addon}`, width))]),
    rule,
    columns('Nilai kembali', cashRupiah(exchange.creditAmount), width),
    columns('Total pengganti', cashRupiah(exchange.newOrderTotal), width),
    rule,
    columns(difference > 0 ? 'PELANGGAN BAYAR' : difference < 0 ? 'TOKO KEMBALIKAN' : 'SELISIH', difference ? cashRupiah(Math.abs(difference)) : 'Rp 0', width),
    ...exchange.settlements.map((entry) => columns(formatStatus(entry.method), cashRupiah(entry.amount), width)),
    rule,
    ...wrap(`Alasan: ${exchange.reason}`, width),
    ...(exchange.status === 'VOIDED' && exchange.voidReason ? wrap(`Dibatalkan: ${exchange.voidReason}`, width) : []),
    '',
    center('Terima kasih', width),
  ].join('\n');
}

export async function printThermalExchangeReceipt(exchange: ExchangeReceipt, printer: PairedPrinter) {
  await printThermalText(formatExchangeReceipt(exchange), printer);
}

export async function printThermalCashClosingReceipt(closing: CashClosingReceipt, printer: PairedPrinter) {
  await printThermalText(formatCashClosingReceipt(closing), printer);
}
