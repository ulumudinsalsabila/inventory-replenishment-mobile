import { Tabs } from 'expo-router';
import { Banknote, ClipboardList, FileText, House, MoreHorizontal, ReceiptText, ShoppingCart } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/auth-provider';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const isEmployee = user?.roles.some((role) => role.toUpperCase() === 'PEGAWAI') ?? false;
  const canCreateOrder = permissions.includes('order.create');
  const canReadOrders = permissions.includes('order.read');
  const canReadPurchases = permissions.includes('purchase.read');
  const canReadCash = permissions.includes('cash_closing.read') || permissions.includes('cash_closing.create');
  const canSeeRequests = permissions.includes('inventory.read') || permissions.includes('stock_request.create') || permissions.includes('stock_request.review');
  return (
    <Tabs screenOptions={{
      headerShown: true,
      headerStyle: { backgroundColor: '#fff' },
      headerTintColor: '#172338',
      headerTitleStyle: { fontSize: 15, fontWeight: '800' },
      headerBackButtonDisplayMode: 'minimal',
      headerShadowVisible: false,
      tabBarActiveTintColor: '#07956f',
      tabBarInactiveTintColor: '#718078',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      tabBarStyle: { height: 62 + insets.bottom, paddingTop: 7, paddingBottom: Math.max(insets.bottom, 8), borderTopColor: '#e4eae6', backgroundColor: '#fff' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarAccessibilityLabel: 'Dashboard', tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="orders" options={{ href: isEmployee || !canReadOrders ? null : undefined, title: 'Pesanan', tabBarAccessibilityLabel: 'Pesanan', tabBarIcon: ({ color, size }) => <ReceiptText color={color} size={size} /> }} />
      <Tabs.Screen name="kasir" options={{ href: !isEmployee || !canCreateOrder ? null : undefined, title: 'POS', tabBarAccessibilityLabel: 'POS', tabBarIcon: ({ color, size }) => <ShoppingCart color={color} size={size} /> }} />
      <Tabs.Screen name="requests" options={{ href: canSeeRequests ? undefined : null, title: 'Permintaan Stok', tabBarAccessibilityLabel: 'Permintaan stok', tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} /> }} />
      <Tabs.Screen name="purchases" options={{ href: !isEmployee && canReadPurchases ? undefined : null, title: 'Pembelian', tabBarAccessibilityLabel: 'Pembelian distributor', tabBarIcon: ({ color, size }) => <FileText color={color} size={size} /> }} />
      <Tabs.Screen name="cash" options={{ href: isEmployee && canReadCash ? undefined : null, title: 'Cash Closing', tabBarAccessibilityLabel: 'Cash closing', tabBarIcon: ({ color, size }) => <Banknote color={color} size={size} /> }} />
      <Tabs.Screen name="operations" options={{ title: 'Lainnya', tabBarAccessibilityLabel: 'Menu lainnya', tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }} />
      <Tabs.Screen name="inventory" options={{ href: null }} />
      <Tabs.Screen name="warehouse-transfers" options={{ href: null }} />
      <Tabs.Screen name="account" options={{ href: null, title: 'Akun / Profil' }} />
    </Tabs>
  );
}
