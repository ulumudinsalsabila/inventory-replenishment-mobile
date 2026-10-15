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
  constructor(message: string, readonly status?: number) {
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

async function request<T>(path: string, accessToken?: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await expoFetch(`${getApiBaseUrl()}/${path.replace(/^\//, '')}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body && !(typeof FormData !== 'undefined' && init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa URL API dan koneksi jaringan.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : payload?.message ?? `Permintaan gagal (${response.status}).`;
    throw new ApiError(String(message), response.status);
  }
  // The API wraps successful responses as { success: true, data: ... }.
  // Paginated endpoints keep their own { data, meta } object inside that envelope.
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'meta')) return payload as T;
  return (payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload) as T;
}

export function loginRequest(email: string, password: string) {
  return request<LoginResponse>('auth/login', undefined, {
    method: 'POST',
    body: JSON.stringify({ email: email.trim(), password }),
  });
}

export function currentUserRequest(accessToken: string) {
  return request<ApiUser>('auth/me', accessToken);
}

export async function refreshAccessToken(refreshToken: string) {
  const result = await request<{ accessToken: string }>('auth/refresh', undefined, {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
  return result.accessToken;
}

export function apiRequest<T>(path: string, accessToken: string, init?: RequestInit) {
  return request<T>(path, accessToken, init);
}

export async function apiFileRequest(path: string, accessToken: string): Promise<ApiFile> {
  let response: Response;
  try {
    response = await expoFetch(`${getApiBaseUrl()}/${path.replace(/^\//, '')}`, {
      headers: { Accept: 'application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa URL API dan koneksi jaringan.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message ?? `Permintaan gagal (${response.status}).`;
    throw new ApiError(String(message), response.status);
  }
  const disposition = response.headers.get('Content-Disposition');
  const fileName = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? 'download.pdf';
  return { bytes: await response.arrayBuffer(), fileName, contentType: response.headers.get('Content-Type') ?? 'application/octet-stream' };
}
