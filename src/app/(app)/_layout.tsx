import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../../auth/auth-provider';
import { BranchFilterProvider } from '../../auth/branch-filter';
import { CONTENT_MAX_WIDTH, useResponsive } from '../../lib/responsive';

export default function AppLayout() {
  const { loading, accessToken } = useAuth();
  const { isTablet } = useResponsive();
  if (loading) return <View style={styles.loading}><ActivityIndicator color="#087f5b" size="large" /></View>;
  if (!accessToken) return <Redirect href="/login" />;
  return <BranchFilterProvider><Stack screenOptions={{
    // Pushed list/form screens stay readable on tablets; tabs and POS opt out below to use the full width.
    contentStyle: isTablet ? styles.tabletContent : undefined,
    headerShown: true,
    headerStyle: { backgroundColor: '#fff' },
    headerTintColor: '#172338',
    headerTitleStyle: { fontSize: 15, fontWeight: '800' },
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
  }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: undefined }} />
    <Stack.Screen name="pos" options={{ headerShown: false, contentStyle: undefined }} />
    <Stack.Screen name="inventory" options={{ title: 'Stok' }} />
    <Stack.Screen name="movements" options={{ title: 'Pergerakan Stok' }} />
    <Stack.Screen name="orders" options={{ title: 'Pesanan' }} />
    <Stack.Screen name="purchases" options={{ title: 'Pembelian Distributor' }} />
    <Stack.Screen name="cash" options={{ title: 'Kas Masuk / Keluar' }} />
    <Stack.Screen name="cash-in-out" options={{ title: 'Kas Masuk / Keluar' }} />
    <Stack.Screen name="cash-in-out-form" options={{ headerShown: false }} />
    <Stack.Screen name="cash-in-out-detail" options={{ headerShown: false }} />
    <Stack.Screen name="stock-requests" options={{ title: 'Permintaan Stok' }} />
    <Stack.Screen name="transfers" options={{ title: 'Transfer Gudang' }} />
    <Stack.Screen name="adjustments" options={{ title: 'Adjustment Stok' }} />
    <Stack.Screen name="opnames" options={{ title: 'Stock Opname' }} />
    <Stack.Screen name="branch-profit" options={{ title: 'Keuntungan per cabang' }} />
    <Stack.Screen name="unsold-stock" options={{ title: 'Stok belum terjual' }} />
    <Stack.Screen name="stock-detail" options={{ title: 'Detail stok produk' }} />
  </Stack></BranchFilterProvider>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabletContent: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', backgroundColor: '#f5f8f7' },
});
