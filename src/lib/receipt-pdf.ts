import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { customerLabel, formatReceiptDateTime, formatServiceType, formatStatus } from './display';
import type { ReceiptOrder } from './receipt-printer';

const money = (value: string | number) => `Rp ${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** Customer-facing receipt as HTML, used both for the system print dialog and the shared PDF. */
/** `cashierName` defaults to the cashier stored on the order. */
export function receiptHtml(order: ReceiptOrder, cashierName = order.cashierName ?? undefined) {
  const itemRows = (order.items ?? []).map((item) => `<div class="item"><div class="row"><span>${escapeHtml(item.productNameSnapshot)}${item.variantNameSnapshot ? ` (${escapeHtml(item.variantNameSnapshot)})` : ''}${item.isBonus ? ' (BONUS)' : ''}</span><strong>${money(item.totalPrice)}</strong></div><div class="muted">${Number(item.inputQuantity ?? item.quantity)} ${escapeHtml(item.unit?.code ?? '')} × ${money(item.unitPrice)}</div>${(item.addons ?? []).map((addon) => `<div class="muted">+ ${escapeHtml(addon.addonNameSnapshot)} × ${addon.quantity} · ${money(addon.totalPrice)}</div>`).join('')}</div>`).join('');
  const paymentRows = (order.payments ?? []).map((payment) => `<div class="row"><span>${escapeHtml(formatStatus(payment.method))}</span><span>${money(payment.amount)}</span></div>${payment.receivedAmount ? `<div class="row muted"><span>Diterima</span><span>${money(payment.receivedAmount)}</span></div>` : ''}${Number(payment.changeAmount ?? 0) > 0 ? `<div class="row muted"><span>Kembalian</span><span>${money(payment.changeAmount!)}</span></div>` : ''}`).join('');
  const date = order.completedAt ?? order.createdAt;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page{margin:8mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#18212b;max-width:360px;margin:0 auto}.center{text-align:center}.store{font-size:18px;font-weight:bold}.muted{color:#687483;font-size:10px;margin-top:4px}.rule{border-top:1px dashed #9aa4af;margin:10px 0}.row{display:flex;justify-content:space-between;gap:12px;margin:6px 0}.item{margin:10px 0}.total{font-size:16px;font-weight:bold;color:#087f5b}</style></head><body><div class="center"><div class="store">${escapeHtml(order.branch?.name ?? 'Toko')}</div>${order.branch?.phone ? `<div class="muted">${escapeHtml(order.branch.phone)}</div>` : ''}<div>${escapeHtml(order.orderNumber)}</div><div class="muted">${date ? formatReceiptDateTime(date) : ''}</div>${order.serviceType ? `<div class="muted">${escapeHtml(formatServiceType(order.serviceType))}</div>` : ''}${order.customerName || order.customerPhone ? `<div class="muted">Pelanggan: ${escapeHtml(customerLabel(order.customerName, order.customerPhone))}</div>` : ''}${cashierName ? `<div class="muted">Kasir: ${escapeHtml(cashierName)}</div>` : ''}</div><div class="rule"></div>${itemRows}<div class="rule"></div><div class="row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div><div class="row"><span>Diskon</span><span>-${money(order.discountAmount)}</span></div>${Number(order.taxAmount ?? 0) ? `<div class="row"><span>Pajak</span><span>${money(order.taxAmount!)}</span></div>` : ''}${Number(order.serviceCharge ?? 0) ? `<div class="row"><span>Layanan</span><span>${money(order.serviceCharge!)}</span></div>` : ''}<div class="rule"></div><div class="row total"><span>TOTAL</span><span>${money(order.grandTotal)}</span></div>${paymentRows}<div class="rule"></div><div class="center">Terima kasih</div></body></html>`;
}

/** Renders the receipt to a PDF named after the order number and opens the system share sheet with it. */
export async function shareReceiptPdf(order: ReceiptOrder, cashierName?: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Fitur bagikan tidak tersedia di perangkat ini.');
  const { uri } = await Print.printToFileAsync({ html: receiptHtml(order, cashierName) });
  // printToFileAsync names the file randomly; give it a readable name for the chat/email it lands in.
  const pdf = new File(uri);
  const target = new File(Paths.cache, `Nota-${order.orderNumber.replace(/[^\w-]+/g, '_')}.pdf`);
  if (target.exists) target.delete();
  pdf.move(target);
  await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', dialogTitle: `Bagikan nota ${order.orderNumber}`, UTI: 'com.adobe.pdf' });
}
