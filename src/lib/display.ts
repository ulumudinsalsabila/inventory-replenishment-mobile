/** Methods a cashier can pick for refunds and exchange settlements (EXCHANGE credit is applied automatically). */
export const refundPaymentMethods = ['CASH', 'QRIS', 'TRANSFER', 'GRAB', 'GOBIZ', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'];
const platformMethods = ['GRAB', 'GOBIZ'];

/** Money can go back through any store method; platform methods only when the order was paid there (the server enforces this too). */
export function refundMethodsFor(payments: { method: string; status: string }[] | undefined) {
  const paid = new Set((payments ?? []).filter((payment) => payment.status === 'COMPLETED').map((payment) => payment.method));
  return refundPaymentMethods.filter((method) => !platformMethods.includes(method) || paid.has(method));
}

export function formatStatus(status: string) {
  if (status === 'GOBIZ') return 'GoBiz';
  if (status === 'EXCHANGE') return 'Kredit tukar';
  if (status === 'DEBIT_CARD') return 'Kartu debit';
  if (status === 'CREDIT_CARD') return 'Kartu kredit';
  if (status === 'OTHER') return 'Lainnya';
  return status.replaceAll('_', ' ');
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
