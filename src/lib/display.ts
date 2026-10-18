/** Methods a cashier can pick for refunds and exchange settlements (EXCHANGE credit is applied automatically). */
export const refundPaymentMethods = ['CASH', 'QRIS', 'TRANSFER', 'GRAB', 'GOBIZ', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'];
const platformMethods = ['GRAB', 'GOBIZ'];

/** Money can go back through any store method; platform methods only when the order was paid there (the server enforces this too). */
export function refundMethodsFor(payments: { method: string; status: string }[] | undefined) {
  const paid = new Set((payments ?? []).filter((payment) => payment.status === 'COMPLETED').map((payment) => payment.method));
  return refundPaymentMethods.filter((method) => !platformMethods.includes(method) || paid.has(method));
}

export function formatStatus(status: string) {
  if (status === 'OPEN') return 'Open Bill';
  if (status === 'GOBIZ') return 'GoBiz';
  if (status === 'EXCHANGE') return 'Kredit tukar';
  if (status === 'DEBIT_CARD') return 'Kartu debit';
  if (status === 'CREDIT_CARD') return 'Kartu kredit';
  if (status === 'OTHER') return 'Lainnya';
  return status.replaceAll('_', ' ');
}

/** Customer name with the phone number next to it, e.g. "Budi · 08123456789". */
export function customerLabel(name?: string | null, phone?: string | null) {
  return [name, phone].filter(Boolean).join(' · ');
}

/** A product an open bill needs more of than the warehouse has (stockWarnings / stock-check shortages). */
export type StockShortage = { productId: string; product: string; required: string; available: string };

/** "Stok kurang: cake (butuh 2, tersedia 1), kopi (butuh 3, tersedia 0)"; empty when nothing is short. */
export function stockWarningText(shortages: StockShortage[] | null | undefined) {
  if (!shortages?.length) return '';
  const quantity = (value: string) => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 3 });
  return `Stok kurang: ${shortages.map((entry) => `${entry.product} (butuh ${quantity(entry.required)}, tersedia ${quantity(entry.available)})`).join(', ')}`;
}

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
