import { Tabs } from 'expo-router';
import { House, MoreHorizontal, Package, ReceiptText } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppShellHeader } from '../../../components/app-shell-header';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs screenOptions={{
      headerShown: true,
      header: () => <AppShellHeader />,
      tabBarActiveTintColor: '#07956f',
      tabBarInactiveTintColor: '#7a899c',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      tabBarStyle: { height: 66 + insets.bottom, paddingTop: 7, paddingBottom: insets.bottom + 7, borderTopWidth: 1, borderTopColor: '#e4eae6', backgroundColor: '#fff' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Beranda', tabBarAccessibilityLabel: 'Beranda', tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="orders" options={{ title: 'Transaksi', tabBarAccessibilityLabel: 'Transaksi', tabBarIcon: ({ color, size }) => <ReceiptText color={color} size={size} /> }} />
      <Tabs.Screen name="inventory" options={{ title: 'Produk', tabBarAccessibilityLabel: 'Produk dan stok', tabBarIcon: ({ color, size }) => <Package color={color} size={size} /> }} />
      <Tabs.Screen name="operations" options={{ title: 'Lainnya', tabBarAccessibilityLabel: 'Menu lainnya', tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }} />
      <Tabs.Screen name="kasir" options={{ href: null }} />
      <Tabs.Screen name="display" options={{ href: null }} />
      <Tabs.Screen name="requests" options={{ href: null }} />
      <Tabs.Screen name="purchases" options={{ href: null }} />
      <Tabs.Screen name="cash" options={{ href: null }} />
      <Tabs.Screen name="warehouse-transfers" options={{ href: null }} />
      <Tabs.Screen name="account" options={{ href: null, title: 'Akun / Profil' }} />
    </Tabs>
  );
}
