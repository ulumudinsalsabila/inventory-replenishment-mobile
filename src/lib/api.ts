import { fetch as expoFetch } from 'expo/fetch';

export type ApiUser = {
  id: string;
  businessId: string;
  branchId: string | null;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
};

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: ApiUser;
};

export class ApiError extends Error {
  /**
   * `code` is the API's machine-readable error code (for example OPEN_BILL_VERSION_CONFLICT), when the server sent one;
   * `details` is its optional context (for example the existing customer behind CUSTOMER_PHONE_DUPLICATE).
   */
  constructor(message: string, readonly status?: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiFile = { bytes: ArrayBuffer; fileName: string; contentType: string };

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

function getApiBaseUrl() {
  if (!apiBaseUrl) {
    throw new ApiError('EXPO_PUBLIC_API_URL belum diatur. Salin .env.example ke .env lalu sesuaikan URL API.');
  }
  return apiBaseUrl;
}

/** Indonesian text for API error codes users commonly hit; screens with their own mapping check `code` first. */
const errorMessages: Record<string, string> = {
  INSUFFICIENT_PERMISSION: 'Akun ini tidak punya izin untuk tindakan ini.',
  FORBIDDEN: 'Akun ini tidak punya izin untuk tindakan ini.',
  BRANCH_SCOPE_VIOLATION: 'Anda tidak punya akses ke data cabang lain.',
  BRANCH_NOT_ASSIGNED: 'Akun ini belum punya cabang. Minta admin mengatur cabang akun ini.',
  BRANCH_REQUIRED: 'Pilih cabang terlebih dahulu.',
  BRANCH_NOT_FOUND: 'Cabang tidak ditemukan.',
  WAREHOUSE_NOT_FOUND: 'Gudang tidak ditemukan dalam akses Anda.',
  PRODUCT_NOT_FOUND: 'Ada produk yang sudah tidak tersedia. Muat ulang lalu coba lagi.',
  VARIANT_NOT_FOUND: 'Varian produk sudah tidak tersedia. Muat ulang lalu coba lagi.',
  ADDON_NOT_ALLOWED: 'Add-on sudah tidak tersedia untuk produk ini. Muat ulang lalu coba lagi.',
  INSUFFICIENT_STOCK: 'Stok tidak cukup untuk menyelesaikan transaksi ini.',
  INVALID_ORDER_STATE: 'Status pesanan sudah berubah. Muat ulang lalu coba lagi.',
  INVALID_ORDER_TOTAL: 'Diskon, pajak, atau biaya layanan tidak valid.',
  INVALID_PAYMENT_TOTAL: 'Nominal pembayaran melebihi sisa tagihan. Muat ulang lalu coba lagi.',
  CASH_RECEIVED_REQUIRED: 'Isi jumlah uang yang diterima untuk pembayaran cash.',
  INSUFFICIENT_CASH_RECEIVED: 'Uang diterima kurang dari sisa tagihan.',
  INVALID_PAYMENT_INPUT: 'Data pembayaran tidak valid.',
  INVALID_CURRENT_PASSWORD: 'Password saat ini salah.',
  PASSWORD_UNCHANGED: 'Password baru harus berbeda dari password saat ini.',
  INVALID_IMAGE_TYPE: 'Hanya foto JPEG, PNG, atau WebP yang diperbolehkan.',
  IMAGES_REQUIRED: 'Pilih minimal satu foto.',
  RESERVED_STOCK_PROTECTED: 'Stok tidak boleh lebih rendah dari jumlah yang sedang dipesan.',
  PURCHASE_DUPLICATE: 'Nomor faktur distributor ini sudah tercatat.',
  INVALID_PURCHASE_STATE: 'Hanya pembelian berstatus draft yang bisa diubah.',
  VALIDATION_ERROR: 'Data yang dikirim tidak valid. Periksa isian lalu coba lagi.',
};

function errorMessage(status: number, code: string | undefined, serverMessage: string) {
  if (code && errorMessages[code]) return errorMessages[code];
  if (status === 401) return 'Sesi login sudah berakhir. Silakan masuk kembali.';
  if (status === 403) return errorMessages.FORBIDDEN;
  if (status === 404) return 'Data tidak ditemukan atau sudah dihapus.';
  if (status >= 500) return 'Server sedang bermasalah. Coba lagi beberapa saat.';
  // Other domain errors carry a specific server message, which beats a vague generic one.
  return serverMessage;
}

/** Long enough for a cold serverless start, short enough that a dead connection does not spin forever. */
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

/** fetch that gives up after `timeoutMs`, still honouring a caller's own abort signal. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const callerSignal = init.signal;
  const forwardAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', forwardAbort);
  try {
    return await expoFetch(url, { ...init, signal: controller.signal } as Parameters<typeof expoFetch>[1]);
  } catch (error) {
    if (callerSignal?.aborted) throw error;
    if (controller.signal.aborted) throw new ApiError('Server tidak merespons. Periksa koneksi internet lalu coba lagi.');
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.');
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
}

async function request<T>(path: string, accessToken?: string, init?: RequestInit): Promise<T> {
  const upload = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/${path.replace(/^\//, '')}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body && !upload ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  }, upload ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : payload?.message ?? `Permintaan gagal (${response.status}).`;
    const code = typeof payload?.code === 'string' ? payload.code : undefined;
    throw new ApiError(errorMessage(response.status, code, String(message)), response.status, code, payload?.details);
  }
  // The API wraps successful responses as { success: true, data: ... }.
  // Paginated endpoints keep their own { data, meta } object inside that envelope.
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'meta')) return payload as T;
  return (payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload) as T;
}

export async function loginRequest(email: string, password: string) {
  try {
    return await request<LoginResponse>('auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password }),
    });
  } catch (error) {
    // On login a 401 means wrong credentials (or a deactivated user), not an expired session.
    if (error instanceof ApiError && error.status === 401) throw new ApiError('Nama akun atau password salah, atau akun sudah nonaktif.', 401, error.code);
    throw error;
  }
}

export function currentUserRequest(accessToken: string) {
  return request<ApiUser>('auth/me', accessToken);
}

/** The server rotates both tokens on refresh; the new refresh token must replace the old one or the session dies at its expiry. */
export function refreshSession(refreshToken: string) {
  return request<{ accessToken: string; refreshToken?: string }>('auth/refresh', undefined, {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export function apiRequest<T>(path: string, accessToken: string, init?: RequestInit) {
  return request<T>(path, accessToken, init);
}

export async function apiFileRequest(path: string, accessToken: string): Promise<ApiFile> {
  const response = await fetchWithTimeout(`${getApiBaseUrl()}/${path.replace(/^\//, '')}`, {
    headers: { Accept: 'application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Authorization: `Bearer ${accessToken}` },
  }, UPLOAD_TIMEOUT_MS);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message ?? `Permintaan gagal (${response.status}).`;
    const code = typeof payload?.code === 'string' ? payload.code : undefined;
    throw new ApiError(errorMessage(response.status, code, String(message)), response.status, code);
  }
  const disposition = response.headers.get('Content-Disposition');
  const fileName = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'download.pdf';
  return { bytes: await response.arrayBuffer(), fileName, contentType: response.headers.get('Content-Type') ?? 'application/octet-stream' };
}
