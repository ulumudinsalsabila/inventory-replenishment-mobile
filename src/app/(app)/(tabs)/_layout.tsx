import { Tabs } from 'expo-router';
import { LayoutDashboard, ShoppingCart, ClipboardList, ArrowLeftRight, MoreHorizontal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#c70d17',
      tabBarInactiveTintColor: '#718078',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      tabBarStyle: { height: 62 + insets.bottom, paddingTop: 7, paddingBottom: Math.max(insets.bottom, 8), borderTopColor: '#e4eae6', backgroundColor: '#fff' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarAccessibilityLabel: 'Dashboard', tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }} />
      <Tabs.Screen name="kasir" options={{ title: 'POS', tabBarAccessibilityLabel: 'Kasir POS', tabBarIcon: ({ color, size }) => <ShoppingCart color={color} size={size} /> }} />
      <Tabs.Screen name="requests" options={{ title: 'Permintaan', tabBarAccessibilityLabel: 'Permintaan stok', tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} /> }} />
      <Tabs.Screen name="warehouse-transfers" options={{ title: 'Transfer', tabBarAccessibilityLabel: 'Transfer gudang', tabBarIcon: ({ color, size }) => <ArrowLeftRight color={color} size={size} /> }} />
      <Tabs.Screen name="operations" options={{ title: 'Lainnya', tabBarAccessibilityLabel: 'Menu lainnya', tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ href: null }} />
    </Tabs>
  );
}
