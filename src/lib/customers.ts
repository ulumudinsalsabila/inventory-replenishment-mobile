import { ApiError } from './api';

/** A registered customer from GET /customers or GET /customers/:id, with purchase stats from settled sales. */
export type Customer = {
  id: string;
  branchId: string;
  name: string;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  branch: { id: string; name: string; code: string } | null;
  transactionCount: number;
  totalSpent: string;
  lastPurchaseAt: string | null;
};

/** Row of GET /customers/search: active customers of one branch, for the POS picker. */
export type CustomerSearchRow = { id: string; name: string; phone: string | null; normalizedPhone: string | null; branchId: string; transactionCount: number };

/** The customer attached to the sale in the POS cart. `transactionCount` is unknown when restored from an open bill. */
export type PosCustomer = { id: string; name: string; phone: string | null; transactionCount?: number };

export type CustomerMatch = { id: string; name: string; phone: string | null; active: boolean };
export type CustomerDuplicates = { phoneMatch: CustomerMatch | null; similarNames: CustomerMatch[] };

export type CustomerTransaction = {
  id: string;
  orderNumber: string;
  status: string;
  isOpenBill: boolean;
  customerName: string | null;
  grandTotal: string;
  refundTotal: string;
  netTotal: string;
  itemCount: number;
  createdAt: string;
  completedAt: string | null;
};

/** "08123456789 · 4 transaksi", or "Tanpa No. HP" when neither is known; used to tell same-name customers apart. */
export function customerHint(customer: { phone: string | null; transactionCount?: number }) {
  const parts = [customer.phone || 'Tanpa No. HP'];
  if (customer.transactionCount !== undefined) parts.push(`${customer.transactionCount} transaksi`);
  return parts.join(' · ');
}

/** Only catches obvious typos; the server normalises 08…/628…/+62 8… and validates the exact length. */
export function isPlausiblePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15 && !/[^\d\s+\-]/.test(value);
}

/** The existing customer behind a 409 CUSTOMER_PHONE_DUPLICATE, so the cashier can pick it instead. */
export function duplicatePhoneCustomer(error: unknown): CustomerMatch | null {
  if (!(error instanceof ApiError) || error.code !== 'CUSTOMER_PHONE_DUPLICATE') return null;
  const customer = (error.details as { customer?: CustomerMatch } | undefined)?.customer;
  return customer?.id ? customer : null;
}

/** Indonesian messages for the customer API's error codes; anything else keeps the server message. */
export function customerErrorMessage(error: unknown, fallback = 'Data customer gagal disimpan.') {
  if (error instanceof ApiError) {
    if (error.code === 'CUSTOMER_PHONE_DUPLICATE') return 'No. HP ini sudah terdaftar untuk customer lain di cabang ini.';
    if (error.code === 'INVALID_CUSTOMER_PHONE') return 'No. HP tidak valid. Gunakan format 08…, 628…, atau +62 8….';
    if (error.code === 'CUSTOMER_NOT_FOUND') return 'Customer tidak ditemukan atau sudah dihapus.';
    if (error.code === 'CUSTOMER_UNAVAILABLE') return 'Customer ini sudah nonaktif atau tidak tersedia di cabang ini. Pilih customer lain atau lanjut sebagai Guest.';
    if (error.code === 'PERMISSION_DENIED') return 'Akun ini belum memiliki izin memilih customer. Lanjutkan sebagai Guest.';
    if (error.code === 'BRANCH_REQUIRED') return 'Pilih cabang terlebih dahulu.';
    if (error.code === 'BRANCH_SCOPE_VIOLATION') return 'Anda tidak memiliki akses ke customer cabang lain.';
    if (error.status === 403) return 'Akun ini belum memiliki izin untuk tindakan ini.';
  }
  return error instanceof Error ? error.message : fallback;
}
