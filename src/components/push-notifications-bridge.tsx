import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../auth/auth-provider';

const PUSH_TOKEN_KEY = 'inventory.expo-push-token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

export function PushNotificationsBridge() {
  const { user, accessToken, authorizedRequest } = useAuth();

  useEffect(() => {
    if (!user || !accessToken || Platform.OS === 'web') return;
    let active = true;
    void (async () => {
      try {
        if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('operations', {
          name: 'Operasional', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: '#087f5b',
        });
        const current = await Notifications.getPermissionsAsync();
        const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
        if (!permission.granted || !active) return;
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) return;
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (!active) return;
        await authorizedRequest('notifications/devices', { method: 'POST', body: JSON.stringify({ token, platform: Platform.OS }) });
        await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
      } catch {
        // Push setup is optional; keep sign-in and the operational app usable if registration fails.
      }
    })();
    return () => { active = false; };
  }, [accessToken, authorizedRequest, user]);

  useEffect(() => {
    const openNotification = (data: Notifications.Notification['request']['content']['data']) => {
      if (data && typeof data.url === 'string') router.push(data.url as Href);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) openNotification(last.notification.request.content.data);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => openNotification(response.notification.request.content.data));
    return () => subscription.remove();
  }, []);

  return null;
}

export { PUSH_TOKEN_KEY };
