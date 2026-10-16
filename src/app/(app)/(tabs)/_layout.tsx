import { Tabs } from 'expo-router';
import { ArrowLeftRight, LayoutDashboard, LockKeyhole, MonitorSmartphone, MoreHorizontal, ReceiptText, ShoppingCart, Truck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/auth-provider';
import { AppShellHeader } from '../../../components/app-shell-header';
import { SideNav, type SideNavProps } from '../../../components/side-nav';
import { useResponsive } from '../../../lib/responsive';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();
  const { user } = useAuth();
  const isEmployee = user?.roles.some((role) => role.toUpperCase() === 'PEGAWAI') ?? false;
  const isAdmin = !isEmployee;
  const can = (permission: string) => user?.permissions.includes(permission) ?? false;
  const showPurchases = isAdmin && can('purchase.read');
  const showCashClosing = isAdmin && can('cash_closing.read');
  const showDisplay = isEmployee && can('display.read');
  const showCashInOut = isEmployee && (can('cash_transaction.create') || can('cash_closing.read'));
  return (
    <Tabs tabBar={isTablet ? (props) => <SideNav {...(props as unknown as SideNavProps)} /> : undefined} screenOptions={{
      headerShown: true,
      // On tablets the sidebar carries the store identity, so the header only shows the screen title and actions.
      header: isTablet ? ({ options }) => <AppShellHeader compact title={typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title} /> : () => <AppShellHeader />,
      tabBarPosition: isTablet ? 'left' : 'bottom',
      sceneStyle: { backgroundColor: '#f5f8f7' },
      tabBarActiveTintColor: '#07956f',
      tabBarInactiveTintColor: '#7a899c',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      tabBarStyle: { height: 66 + insets.bottom, paddingTop: 7, paddingBottom: insets.bottom + 7, borderTopWidth: 1, borderTopColor: '#e4eae6', backgroundColor: '#fff' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarAccessibilityLabel: 'Dashboard', tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }} />
      <Tabs.Screen name="orders" options={isAdmin ? { title: 'Transaksi', tabBarAccessibilityLabel: 'Transaksi', tabBarIcon: ({ color, size }) => <ReceiptText color={color} size={size} /> } : { href: null }} />
      <Tabs.Screen name="kasir" options={isEmployee
        ? { title: 'POS', headerShown: false, tabBarAccessibilityLabel: 'Kasir POS', tabBarIcon: ({ color, size }) => <ShoppingCart color={color} size={size} /> }
        : { href: null }} />
      <Tabs.Screen name="display" options={showDisplay
        ? { title: 'Display Toko', tabBarAccessibilityLabel: 'Display toko', tabBarIcon: ({ color, size }) => <MonitorSmartphone color={color} size={size} /> }
        : { href: null }} />
      <Tabs.Screen name="cash-in-out" options={showCashInOut
        ? { title: 'Cash in/out', tabBarAccessibilityLabel: 'Kas masuk dan keluar', tabBarIcon: ({ color, size }) => <ArrowLeftRight color={color} size={size} /> }
        : { href: null }} />
      <Tabs.Screen name="purchases" options={showPurchases
        ? { tabBarLabel: 'Pembelian', tabBarAccessibilityLabel: 'Pembelian distributor', tabBarIcon: ({ color, size }) => <Truck color={color} size={size} /> }
        : { href: null }} />
      <Tabs.Screen name="cash" options={showCashClosing
        ? { tabBarLabel: 'Cash Closing', tabBarAccessibilityLabel: 'Cash closing', tabBarIcon: ({ color, size }) => <LockKeyhole color={color} size={size} /> }
        : { href: null }} />
      <Tabs.Screen name="operations" options={{ title: 'Lainnya', tabBarAccessibilityLabel: 'Menu lainnya', tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }} />
      <Tabs.Screen name="inventory" options={{ href: null }} />
      <Tabs.Screen name="requests" options={{ href: null }} />
      <Tabs.Screen name="warehouse-transfers" options={{ href: null }} />
      <Tabs.Screen name="account" options={{ href: null, title: 'Akun / Profil' }} />
    </Tabs>
  );
}
