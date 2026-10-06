import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../../auth/auth-provider';

export default function AppLayout() {
  const { loading, accessToken } = useAuth();
  if (loading) return <View style={styles.loading}><ActivityIndicator color="#087f5b" size="large" /></View>;
  if (!accessToken) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
