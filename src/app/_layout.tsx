import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider } from '../auth/auth-provider';
import { PushNotificationsBridge } from '../components/push-notifications-bridge';
import { NotificationsProvider } from '../notifications/notifications-provider';

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <AuthProvider>
        <NotificationsProvider>
          <PushNotificationsBridge />
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f5f7f6' } }} />
        </NotificationsProvider>
      </AuthProvider>
    </KeyboardProvider>
  );
}
