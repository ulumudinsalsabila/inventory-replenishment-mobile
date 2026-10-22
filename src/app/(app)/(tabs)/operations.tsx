import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { ArrowLeftRight, Banknote, ChevronRight, ClipboardList, FileText, MonitorSmartphone, PackageSearch, ReceiptText, UserRound, Users } from 'lucide-react-native';
import { useAuth } from '../../../auth/auth-provider';
import { useNotifications } from '../../../notifications/notifications-provider';

type FeatureIconName = 'ReceiptText' | 'PackageSearch' | 'ClipboardList' | 'Banknote' | 'FileText' | 'UserRound' | 'MonitorSmartphone' | 'ArrowLeftRight' | 'Users';
function FeatureIcon({ name }: { name: FeatureIconName }) {
  const icons = { ReceiptText, PackageSearch, ClipboardList, Banknote, FileText, UserRound, MonitorSmartphone, ArrowLeftRight, Users };
  const Icon = icons[name];
  return <Icon size={23} color="#c70d17" />;
}

type Feature = { section: string; title: string; description: string; destination: Href; permission?: string; icon: FeatureIconName };
const adminFeatures: Feature[] = [
  { section: 'Stok & Gudang', title: 'Stok', description: 'Ketersediaan produk per gudang', destination: '/(app)/inventory', permission: 'inventory.read', icon: 'PackageSearch' },
  { section: 'Stok & Gudang', title: 'Pergerakan stok', description: 'Riwayat barang masuk dan keluar', destination: '/(app)/movements', permission: 'inventory.read', icon: 'ClipboardList' },
  { section: 'Stok & Gudang', title: 'Transfer gudang', description: 'Kirim dan terima barang antar gudang', destination: '/(app)/transfers', permission: 'inventory.read', icon: 'ArrowLeftRight' },
  { section: 'Stok & Gudang', title: 'Stock opname', description: 'Hitung fisik stok lalu sesuaikan selisihnya', destination: '/(app)/opnames', permission: 'inventory.opname', icon: 'ClipboardList' },
  { section: 'Stok & Gudang', title: 'Penyesuaian stok', description: 'Koreksi stok rusak, hilang, atau salah catat', destination: '/(app)/adjustments', permission: 'inventory.adjust', icon: 'FileText' },
  { section: 'Penjualan', title: 'Display toko', description: 'Kelola stok yang tampil di area penjualan', destination: '/(app)/(tabs)/display', permission: 'display.read', icon: 'MonitorSmartphone' },
  { section: 'Penjualan', title: 'Customer', description: 'Data customer dan riwayat belanja per cabang', destination: '/(app)/customers', permission: 'customer.read', icon: 'Users' },
  { section: 'Kas', title: 'Cash Closing', description: 'Tutup kas dan rekonsiliasi operasional', destination: '/(app)/(tabs)/cash', permission: 'cash_closing.read', icon: 'Banknote' },
  { section: 'Kas', title: 'Cash in/out', description: 'Catat kas masuk atau keluar', destination: '/(app)/(tabs)/cash-in-out', permission: 'cash_transaction.create', icon: 'Banknote' },
  { section: 'Laporan', title: 'Laporan Open Bill', description: 'Bill yang masih open, selesai, dan batal', destination: '/(app)/open-bills', permission: 'report.read', icon: 'ReceiptText' },
  { section: 'Akun', title: 'Akun / profil', description: 'Peran, akses, dan pengaturan akun', destination: '/(app)/(tabs)/account', icon: 'UserRound' },
];
const employeeFeatures: Feature[] = [
  { section: 'Stok & Gudang', title: 'Stok', description: 'Ketersediaan produk di gudang', destination: '/(app)/inventory', permission: 'inventory.read', icon: 'PackageSearch' },
  { section: 'Stok & Gudang', title: 'Pergerakan stok', description: 'Riwayat barang masuk dan keluar', destination: '/(app)/movements', permission: 'inventory.read', icon: 'ClipboardList' },
  { section: 'Stok & Gudang', title: 'Transfer gudang', description: 'Kirim dan terima barang antar gudang', destination: '/(app)/transfers', permission: 'inventory.read', icon: 'ArrowLeftRight' },
  { section: 'Stok & Gudang', title: 'Stock opname', description: 'Hitung fisik stok lalu sesuaikan selisihnya', destination: '/(app)/opnames', permission: 'inventory.opname', icon: 'ClipboardList' },
  { section: 'Stok & Gudang', title: 'Penyesuaian stok', description: 'Koreksi stok rusak, hilang, atau salah catat', destination: '/(app)/adjustments', permission: 'inventory.adjust', icon: 'FileText' },
  { section: 'Operasional', title: 'Display toko', description: 'Kelola stok yang tampil di area penjualan', destination: '/(app)/(tabs)/display', permission: 'display.read', icon: 'MonitorSmartphone' },
  { section: 'Operasional', title: 'Customer', description: 'Cari, tambah, dan lihat riwayat belanja customer', destination: '/(app)/customers', permission: 'customer.read', icon: 'Users' },
  { section: 'Kas', title: 'Cash in/out', description: 'Catat kas masuk atau keluar', destination: '/(app)/(tabs)/cash-in-out', permission: 'cash_transaction.create', icon: 'ArrowLeftRight' },
  { section: 'Kas', title: 'Cash Closing', description: 'Tutup kas dan rekonsiliasi harian', destination: '/(app)/(tabs)/cash', permission: 'cash_closing.read', icon: 'Banknote' },
  { section: 'Akun', title: 'Akun / profil', description: 'Peran, akses, dan pengaturan akun', destination: '/(app)/(tabs)/account', icon: 'UserRound' },
];

export default function OperationsScreen() {
  const { user } = useAuth();
  const { pendingOrderCount, pendingRequestCount, openBillCount } = useNotifications();
  const isEmployee = user?.roles.some((role) => role.toUpperCase() === 'PEGAWAI') ?? false;
  const features = isEmployee ? employeeFeatures : adminFeatures;
  const visibleFeatures = features.filter(({ permission, title }) =>
    !permission || user?.permissions.includes(permission) ||
    (title === 'Permintaan stok' && (user?.permissions.includes('stock_request.create') || user?.permissions.includes('stock_request.review'))),
  );
  const sections = [...new Set(visibleFeatures.map((feature) => feature.section))];
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.subtitle}>Menu sesuai peran dan izin akun Anda.</Text>
      {sections.map((section) => {
        const sectionFeatures = visibleFeatures.filter((feature) => feature.section === section);
        if (!sectionFeatures.length) return null;
        return <View key={section} style={styles.section}>
          <Text style={styles.sectionTitle}>{section}</Text>
          <View style={styles.list}>{sectionFeatures.map((feature) => { const badge = feature.title === 'Pesanan' ? pendingOrderCount : feature.title === 'Permintaan stok' ? pendingRequestCount : feature.title === 'Laporan Open Bill' ? openBillCount : 0; return <Pressable accessibilityRole="button" onPress={() => router.push(feature.destination)} key={feature.title} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
            <View style={styles.icon}><FeatureIcon name={feature.icon as FeatureIconName} /></View>
            <View style={styles.content}><Text style={styles.cardTitle}>{feature.title}</Text><Text style={styles.cardDescription}>{feature.description}</Text></View>
            {badge ? <View style={styles.countBadge}><Text style={styles.countBadgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
            <ChevronRight size={19} color="#9aa59f" />
          </Pressable>; })}</View>
        </View>;
      })}
      {!visibleFeatures.length ? <View style={styles.empty}><Text style={styles.cardTitle}>Belum ada menu tersedia</Text><Text style={styles.cardDescription}>Minta admin memeriksa akses akun Anda.</Text></View> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 24, paddingBottom: 28 },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 7, color: '#172820', fontSize: 25, fontWeight: '800' },
  subtitle: { marginTop: 6, color: '#718078', fontSize: 12 },
  section: { marginTop: 26 },
  sectionTitle: { marginBottom: 10, color: '#53635a', fontSize: 12, fontWeight: '800' },
  list: { gap: 8 },
  card: { minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 14, backgroundColor: '#fff' },
  cardPressed: { borderColor: '#e5a5a8', backgroundColor: '#fff8f8' },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#fff0f0' },
  content: { flex: 1, minWidth: 0, marginHorizontal: 12 },
  countBadge: { minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 11, backgroundColor: '#d92d2d' },
  countBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  cardTitle: { color: '#28372f', fontSize: 14, fontWeight: '800' },
  cardDescription: { marginTop: 4, color: '#8a968f', fontSize: 11, lineHeight: 15 },
  empty: { marginTop: 22, padding: 18, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 14, backgroundColor: '#fff' },
});
