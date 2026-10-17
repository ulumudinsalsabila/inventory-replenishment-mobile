import { AppState } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-provider';
import { getRange } from '../lib/date-range';

export type NotificationSummary = {
  unreadCount: number;
  pendingOrderCount: number;
  pendingRequestCount: number;
  todayOrderCount: number;
};

type NotificationsState = NotificationSummary & { refresh: () => Promise<void> };

const emptySummary: NotificationSummary = { unreadCount: 0, pendingOrderCount: 0, pendingRequestCount: 0, todayOrderCount: 0 };
const NotificationsContext = createContext<NotificationsState | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, accessToken, authorizedRequest } = useAuth();
  const [summary, setSummary] = useState<NotificationSummary>(emptySummary);

  const refresh = useCallback(async () => {
    if (!user || !accessToken) {
      setSummary(emptySummary);
      return;
    }
    const { from, to } = getRange('today');
    const [nextSummary, todayOrderCount] = await Promise.all([
      authorizedRequest<Omit<NotificationSummary, 'todayOrderCount'>>('notifications/summary').catch(() => null),
      user.permissions.includes('order.read')
        ? authorizedRequest<{ meta: { total: number } }>(`orders?page=1&perPage=1&from=${from}&to=${to}`).then((result) => result.meta.total).catch(() => null)
        : Promise.resolve(0),
    ]);
    // Badges are supplementary: keep the last known values when a request fails.
    setSummary((current) => ({ ...current, ...nextSummary, todayOrderCount: todayOrderCount ?? current.todayOrderCount }));
  }, [accessToken, authorizedRequest, user]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), 30_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { clearTimeout(initial); clearInterval(interval); subscription.remove(); };
  }, [refresh]);

  const value = useMemo(() => ({ ...summary, refresh }), [refresh, summary]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used inside NotificationsProvider.');
  return context;
}
