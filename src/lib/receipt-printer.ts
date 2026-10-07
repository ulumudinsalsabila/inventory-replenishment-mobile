import * as SecureStore from 'expo-secure-store';
import { PermissionsAndroid, Platform } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { formatDate, formatStatus } from './display';

export type PairedPrinter = { name: string; address: string };
export type ReceiptLine = {
  productNameSnapshot: string;
  variantNameSnapshot?: string | null;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
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
  createdAt?: string;
  completedAt?: string | null;
  branch?: { name: string; code?: string } | null;
  items?: ReceiptLine[];
  payments?: { method: string; amount: string; receivedAmount?: string | null; changeAmount?: string | null }[];
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

function receiptText(order: ReceiptOrder, width: number) {
  const rule = '-'.repeat(width);
  const date = order.completedAt ?? order.createdAt;
  const lines = [
    ...wrap(order.branch?.name ?? 'INVENTORY REPLENISHMENT', width),
    ...(order.branch?.code ? [fit(order.branch.code, width)] : []),
    rule,
    fit(order.orderNumber, width),
    ...(date ? [fit(formatDate(date), width)] : []),
    ...(order.customerName ? wrap(`Pelanggan: ${order.customerName}`, width) : []),
    rule,
  ];

  for (const item of order.items ?? []) {
    lines.push(...wrap(`${item.productNameSnapshot}${item.variantNameSnapshot ? ` (${item.variantNameSnapshot})` : ''}`, width));
    const addonTotal = (item.addons ?? []).reduce((sum, addon) => sum + Number(addon.totalPrice), 0);
    lines.push(columns(`${item.quantity} x ${rupiah(Number(item.unitPrice))}`, rupiah(Math.max(0, Number(item.totalPrice) - addonTotal)), width));
    for (const addon of item.addons ?? []) lines.push(...wrap(`+ ${addon.addonNameSnapshot} x ${addon.quantity} ${rupiah(Number(addon.totalPrice))}`, width));
  }

  lines.push(rule, columns('Subtotal', rupiah(Number(order.subtotal)), width));
  lines.push(columns('Diskon', `-${rupiah(Number(order.discountAmount))}`, width));
  if (Number(order.taxAmount ?? 0) > 0) lines.push(columns('Pajak', rupiah(Number(order.taxAmount)), width));
  if (Number(order.serviceCharge ?? 0) > 0) lines.push(columns('Layanan', rupiah(Number(order.serviceCharge)), width));
  lines.push(columns('TOTAL', rupiah(Number(order.grandTotal)), width));
  for (const payment of order.payments ?? []) {
    lines.push(columns(formatStatus(payment.method), rupiah(Number(payment.amount)), width));
    if (payment.receivedAmount) lines.push(columns('Diterima', rupiah(Number(payment.receivedAmount)), width));
    if (Number(payment.changeAmount ?? 0) > 0) lines.push(columns('Kembalian', rupiah(Number(payment.changeAmount)), width));
  }
  lines.push(rule, 'Terima kasih');
  return lines.join('\n');
}

export async function printThermalReceipt(order: ReceiptOrder, printer: PairedPrinter) {
  await ensureAndroidBluetoothAccess();
  const paired = await RNBluetoothClassic.getBondedDevices();
  const device = paired.find((candidate) => candidate.address === printer.address);
  if (!device) throw new Error('Printer pilihan tidak lagi dipasangkan. Pasangkan kembali dari pengaturan Bluetooth.');

  const connected = (await RNBluetoothClassic.isDeviceConnected(printer.address))
    ? await RNBluetoothClassic.getConnectedDevice(printer.address)
    : await RNBluetoothClassic.connectToDevice(printer.address);
  if (!(await connected.isConnected())) throw new Error(`Gagal tersambung ke ${printer.name}. Pastikan printer menyala.`);

  const width = 32; // format umum kertas thermal 58 mm
  const payload = `${String.fromCharCode(0x1b, 0x40)}${receiptText(order, width)}\n\n\n\n${String.fromCharCode(0x1b, 0x64, 3)}`;
  if (!(await connected.write(payload, 'ascii'))) throw new Error('Printer tidak menerima nota. Periksa koneksi dan dukungan ESC/POS.');
}
