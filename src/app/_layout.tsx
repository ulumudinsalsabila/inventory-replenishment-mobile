import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider } from '../auth/auth-provider';
import { PushNotificationsBridge } from '../components/push-notifications-bridge';

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <AuthProvider>
        <PushNotificationsBridge />
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f5f7f6' } }} />
      </AuthProvider>
    </KeyboardProvider>
  );
}
