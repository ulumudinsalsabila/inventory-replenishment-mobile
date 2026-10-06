import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, currentUserRequest, loginRequest, refreshAccessToken, type ApiUser } from '../lib/api';

const ACCESS_TOKEN_KEY = 'inventory.access-token';
const REFRESH_TOKEN_KEY = 'inventory.refresh-token';
const PUSH_TOKEN_KEY = 'inventory.expo-push-token';

type AuthState = {
  user: ApiUser | null;
  accessToken: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  authorizedRequest: <T>(path: string, init?: RequestInit) => Promise<T>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const accessTokenRef = useRef<string | null>(null);
  const refreshPromise = useRef<Promise<string> | null>(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const [savedAccessToken, savedRefreshToken] = await Promise.all([
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
        ]);
        if (!savedAccessToken) return;

        let nextAccessToken = savedAccessToken;
        let currentUser: ApiUser;
        try {
          currentUser = await currentUserRequest(nextAccessToken);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401 || !savedRefreshToken) throw error;
          nextAccessToken = await refreshAccessToken(savedRefreshToken);
          await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, nextAccessToken);
          currentUser = await currentUserRequest(nextAccessToken);
        }
        if (active) {
          accessTokenRef.current = nextAccessToken;
          setAccessToken(nextAccessToken);
          setUser(currentUser);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await Promise.all([
            SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
            SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
          ]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void restoreSession();
    return () => { active = false; };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password);
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, result.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, result.refreshToken),
    ]);
    accessTokenRef.current = result.accessToken;
    setAccessToken(result.accessToken);
    setUser(result.user);
  }, []);

  const signOut = useCallback(async () => {
    const pushToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    const currentAccessToken = accessTokenRef.current;
    if (pushToken && currentAccessToken) {
      try { await apiRequest('notifications/devices', currentAccessToken, { method: 'DELETE', body: JSON.stringify({ token: pushToken }) }); } catch { /* Keep logout available if the API cannot be reached. */ }
    }
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync(PUSH_TOKEN_KEY),
    ]);
    accessTokenRef.current = null;
    setAccessToken(null);
    setUser(null);
  }, []);

  const authorizedRequest = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const requestToken = accessTokenRef.current;
    if (!requestToken) throw new ApiError('Sesi login sudah berakhir. Silakan masuk kembali.', 401);

    try {
      return await apiRequest<T>(path, requestToken, init);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;

      // Another request may already have refreshed the token while this request was in flight.
      const latestToken = accessTokenRef.current;
      if (latestToken && latestToken !== requestToken) return apiRequest<T>(path, latestToken, init);

      try {
        if (!refreshPromise.current) {
          refreshPromise.current = (async () => {
            const savedRefreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
            if (!savedRefreshToken) throw new ApiError('Sesi login sudah berakhir. Silakan masuk kembali.', 401);
            const nextAccessToken = await refreshAccessToken(savedRefreshToken);
            await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, nextAccessToken);
            accessTokenRef.current = nextAccessToken;
            setAccessToken(nextAccessToken);
            return nextAccessToken;
          })();
        }
        const nextAccessToken = await refreshPromise.current;
        return await apiRequest<T>(path, nextAccessToken, init);
      } catch (refreshError) {
        if (refreshError instanceof ApiError && refreshError.status === 401) {
          await Promise.all([
            SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
            SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
          ]);
          accessTokenRef.current = null;
          setAccessToken(null);
          setUser(null);
        }
        throw refreshError;
      } finally {
        refreshPromise.current = null;
      }
    }
  }, []);

  const value = useMemo(() => ({ user, accessToken, loading, signIn, signOut, authorizedRequest }), [user, accessToken, loading, signIn, signOut, authorizedRequest]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
