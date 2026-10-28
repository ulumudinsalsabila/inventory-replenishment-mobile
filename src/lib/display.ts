/**
 * Methods a cashier can pick for refunds and exchange settlements: the same five as the POS (EXCHANGE credit is applied
 * automatically).
 */
export const refundPaymentMethods = ['CASH', 'QRIS', 'TRANSFER', 'GRAB', 'GOBIZ', 'KASBON'];
/** Offered for a refund only when the order was paid that way: platforms refund through themselves, kasbon only lowers the debt. */
const platformMethods = ['GRAB', 'GOBIZ', 'KASBON'];

/** Money can go back through any store method; platform methods only when the order was paid there (the server enforces this too). */
export function refundMethodsFor(payments: { method: string; status: string }[] | undefined) {
  const paid = new Set((payments ?? []).filter((payment) => payment.status === 'COMPLETED').map((payment) => payment.method));
  return refundPaymentMethods.filter((method) => !platformMethods.includes(method) || paid.has(method));
}

/** Preselected refund method: how the order was paid if that is still offered (older card payments are not), else cash. */
export function defaultRefundMethod(payments: { method: string; status: string }[] | undefined) {
  const offered = refundMethodsFor(payments);
  return payments?.find((payment) => payment.status === 'COMPLETED' && offered.includes(payment.method))?.method ?? 'CASH';
}

const movementLabels: Record<string, string> = {
  PURCHASE_IN: 'Pembelian masuk', PURCHASE: 'Pembelian', PURCHASE_BONUS: 'Bonus pembelian', TRANSFER_IN: 'Transfer masuk', TRANSFER_OUT: 'Transfer keluar',
  SALE: 'Penjualan', SALE_REVERSAL: 'Pembatalan penjualan', RETURN: 'Retur', WASTE: 'Barang rusak', ADJUSTMENT: 'Adjustment', STOCK_OPNAME: 'Stok opname',
};

/** Indonesian name of a stock movement type. */
export function formatMovementType(type: string) {
  return movementLabels[type] ?? type.replaceAll('_', ' ');
}

/**
 * Indonesian labels for the API's status, payment-method and reason codes. One code can belong to several enums
 * (COMPLETED is an order, payment and refund status), so each label reads right in all of them.
 */
const statusLabels: Record<string, string> = {
  // Orders, payments, refunds
  DRAFT: 'Draft', OPEN: 'Open Bill', PENDING_PAYMENT: 'Menunggu bayar', PENDING: 'Menunggu', PAID: 'Lunas', COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan', REFUNDED: 'Dikembalikan', PARTIALLY_REFUNDED: 'Refund sebagian', FAILED: 'Gagal', VOIDED: 'Dibatalkan',
  FORFEITED: 'Hangus', FULL: 'Penuh', PARTIAL: 'Sebagian', DEPOSIT: 'DP',
  // Payment methods
  CASH: 'Cash', QRIS: 'QRIS', TRANSFER: 'Transfer', GRAB: 'Grab', GOBIZ: 'GoBiz', DEBIT_CARD: 'Kartu debit', CREDIT_CARD: 'Kartu kredit', EXCHANGE: 'Kredit tukar', KASBON: 'Kasbon', OTHER: 'Lainnya',
  // Stock requests, transfers, opnames, purchases
  SUBMITTED: 'Diajukan', UNDER_REVIEW: 'Ditinjau', APPROVED: 'Disetujui', PARTIAL_APPROVED: 'Disetujui sebagian', REJECTED: 'Ditolak',
  PROCESSING: 'Diproses', PREPARING: 'Disiapkan', READY: 'Siap dikirim', IN_TRANSIT: 'Dalam pengiriman', RECEIVED: 'Diterima',
  PARTIALLY_RECEIVED: 'Diterima sebagian', FULFILLED: 'Terpenuhi',
  // Cash
  MATCH: 'Sesuai', SHORTAGE: 'Kurang', OVERAGE: 'Lebih', CASH_IN: 'Kas masuk', CASH_OUT: 'Kas keluar',
  // Reasons
  MISSING: 'Hilang', DAMAGED: 'Rusak', WRONG_ITEM: 'Salah barang', QUANTITY_ERROR: 'Jumlah salah', WASTE: 'Terbuang', LOST: 'Hilang',
  INTERNAL_USE: 'Pemakaian internal', CORRECTION: 'Koreksi',
  // Service and display
  DINE_IN: 'Dine in', TAKEAWAY: 'Takeaway', DISPLAY_IN: 'Masuk display', DISPLAY_RETURN: 'Kembali ke gudang', DISPLAY_SALE: 'Terjual dari display', DISPLAY_ADJUSTMENT: 'Penyesuaian display',
};

export function formatStatus(status: string | null | undefined) {
  if (!status) return '-';
  return statusLabels[status] ?? movementLabels[status] ?? status.replaceAll('_', ' ');
}

/**
 * Label for a refund's type where refunds are listed: DEPOSIT is a DP handed back for a cancelled bill (never a sale refund)
 * and reads "Refund DP"; FULL/PARTIAL keep the plain refund presentation, so they get no extra label.
 */
export function formatRefundType(type: string | null | undefined) {
  return type === 'DEPOSIT' ? 'Refund DP' : '';
}

/** Customer name with the phone number next to it, e.g. "Budi · 08123456789". */
export function customerLabel(name?: string | null, phone?: string | null) {
  return [name, phone].filter(Boolean).join(' · ');
}

/** How the order is served; null on older orders and sales where it was not recorded. */
export type ServiceType = 'DINE_IN' | 'TAKEAWAY';

/** "Dine in" / "Takeaway"; empty when the order has no service type. */
export function formatServiceType(type: ServiceType | string | null | undefined) {
  return type === 'DINE_IN' ? 'Dine in' : type === 'TAKEAWAY' ? 'Takeaway' : '';
}

/** A product an open bill needs more of than the warehouse has (stockWarnings / stock-check shortages). */
export type StockShortage = { productId: string; product: string; required: string; available: string };

/** "Stok kurang: cake (butuh 2, tersedia 1), kopi (butuh 3, tersedia 0)"; empty when nothing is short. */
export function stockWarningText(shortages: StockShortage[] | null | undefined) {
  if (!shortages?.length) return '';
  const quantity = (value: string) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 3 });
  return `Stok kurang: ${shortages.map((entry) => `${entry.product} (butuh ${quantity(entry.required)}, tersedia ${quantity(entry.available)})`).join(', ')}`;
}

/**
 * What happens to goods an open bill already took out of stock when they come off it (void or cancel):
 * RETURN puts unopened goods back, WASTE records opened goods as wasted.
 */
export type OpenBillStockAction = 'RETURN' | 'WASTE';
export const openBillStockActions: { value: OpenBillStockAction; label: string; hint: string }[] = [
  { value: 'RETURN', label: 'Kembalikan ke stok', hint: 'Barang belum dibuka, stok bertambah lagi.' },
  { value: 'WASTE', label: 'Terbuang', hint: 'Barang sudah dibuka, dicatat sebagai barang terbuang.' },
];

/** Short elapsed time: 45 -> "45 mnt", 130 -> "2 jam 10 mnt", 3000 -> "2 hari". */
export function formatDuration(minutes: number) {
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return `${value} mnt`;
  if (value < 1440) return `${Math.floor(value / 60)} jam${value % 60 ? ` ${value % 60} mnt` : ''}`;
  return `${Math.floor(value / 1440)} hari`;
}

/** How long ago `value` happened, e.g. the age of an open bill. */
export function formatAge(value: string | number | Date) {
  return formatDuration((Date.now() - new Date(value).getTime()) / 60_000);
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

export function formatDate(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateFormatter.format(date);
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Jakarta',
});

/** Date with the Jakarta time, e.g. "18/10/2026, 14:05". */
export function formatDateTime(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormatter.format(date);
}

/** Receipt timestamp in WIB: dd/mm/yyyy HH:mm. */
export function formatReceiptDateTime(value: string | number | Date) {
  return formatDateTime(value).replace(',', '');
}

/** A unit a product can be counted in, with how many base units it holds (e.g. BOX = 12 BTL). */
export type CountUnit = { code: string; conversionFactor: string | number };

/**
 * Splits a base quantity over the product's larger units, biggest first: 29 BTL with BOX = 12 reads "2 BOX 5 BTL".
 * Products without larger units, or a quantity smaller than the smallest of them, keep the plain base quantity.
 */
export function mixedQuantity(baseQuantity: number, baseCode: string, units: CountUnit[] = []) {
  const plain = `${baseQuantity.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${baseCode}`.trim();
  const larger = units
    .map((unit) => ({ code: unit.code, factor: Number(unit.conversionFactor) }))
    .filter((unit) => unit.factor > 1 && unit.code !== baseCode)
    .sort((a, b) => b.factor - a.factor);
  if (!larger.length || baseQuantity < larger[larger.length - 1].factor) return plain;
  let rest = baseQuantity;
  const parts: string[] = [];
  for (const unit of larger) {
    const count = Math.floor(rest / unit.factor + 0.000001);
    if (count <= 0) continue;
    parts.push(`${count.toLocaleString('id-ID')} ${unit.code}`);
    rest = Math.round((rest - count * unit.factor) * 1000) / 1000;
  }
  if (rest > 0) parts.push(`${rest.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${baseCode}`);
  return parts.join(' ');
}
