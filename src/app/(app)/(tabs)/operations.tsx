import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Banknote, ChevronRight, ClipboardList, FileText, House, PackageSearch, ReceiptText, ShoppingCart, UserRound } from 'lucide-react-native';
import { useAuth } from '../../../auth/auth-provider';

type FeatureIconName = 'House' | 'ShoppingCart' | 'ReceiptText' | 'PackageSearch' | 'ClipboardList' | 'Banknote' | 'FileText' | 'UserRound';
function FeatureIcon({ name }: { name: FeatureIconName }) {
  const icons = { House, ShoppingCart, ReceiptText, PackageSearch, ClipboardList, Banknote, FileText, UserRound };
  const Icon = icons[name];
  return <Icon size={23} color="#c70d17" />;
}

type Feature = { section: string; title: string; description: string; destination: Href; permission?: string; icon: FeatureIconName };
const adminFeatures: Feature[] = [
  { section: 'Menu utama', title: 'Dashboard', description: 'Ringkasan aktivitas dan penjualan', destination: '/(app)/(tabs)', permission: 'report.read', icon: 'House' },
  { section: 'Menu utama', title: 'Pesanan', description: 'Riwayat transaksi dan pembayaran', destination: '/(app)/(tabs)/orders', permission: 'order.read', icon: 'ReceiptText' },
  { section: 'Menu utama', title: 'Permintaan stok', description: 'Ajukan atau tinjau permintaan', destination: '/(app)/(tabs)/requests', permission: 'inventory.read', icon: 'ClipboardList' },
  { section: 'Menu utama', title: 'Pembelian distributor', description: 'Daftar pembelian dan penerimaan', destination: '/(app)/(tabs)/purchases', permission: 'purchase.read', icon: 'FileText' },
  { section: 'Stok & Gudang', title: 'Stok', description: 'Ketersediaan produk per gudang', destination: '/(app)/inventory', permission: 'inventory.read', icon: 'PackageSearch' },
  { section: 'Stok & Gudang', title: 'Pergerakan stok', description: 'Riwayat barang masuk dan keluar', destination: '/(app)/movements', permission: 'inventory.read', icon: 'ClipboardList' },
  { section: 'Kas', title: 'Cash closing', description: 'Rekonsiliasi dan penutupan kas', destination: '/(app)/cash', permission: 'cash_closing.read', icon: 'Banknote' },
  { section: 'Akun', title: 'Akun / profil', description: 'Peran, akses, dan pengaturan akun', destination: '/(app)/(tabs)/account', icon: 'UserRound' },
];
const employeeFeatures: Feature[] = [
  { section: 'Menu utama', title: 'Dashboard', description: 'Ringkasan aktivitas dan penjualan', destination: '/(app)/(tabs)', permission: 'report.read', icon: 'House' },
  { section: 'Menu utama', title: 'POS', description: 'Buat transaksi penjualan', destination: '/(app)/(tabs)/kasir', permission: 'order.create', icon: 'ShoppingCart' },
  { section: 'Menu utama', title: 'Permintaan stok', description: 'Ajukan dan pantau permintaan', destination: '/(app)/(tabs)/requests', permission: 'stock_request.create', icon: 'ClipboardList' },
  { section: 'Menu utama', title: 'Cash closing', description: 'Tinjau dan tutup kas', destination: '/(app)/(tabs)/cash', permission: 'cash_closing.read', icon: 'Banknote' },
  { section: 'Stok & Gudang', title: 'Stok', description: 'Ketersediaan produk di gudang', destination: '/(app)/inventory', permission: 'inventory.read', icon: 'PackageSearch' },
  { section: 'Stok & Gudang', title: 'Pergerakan stok', description: 'Riwayat barang masuk dan keluar', destination: '/(app)/movements', permission: 'inventory.read', icon: 'ClipboardList' },
  { section: 'Kas', title: 'Cash in/out', description: 'Catat kas masuk atau keluar', destination: '/(app)/cash', permission: 'cash_transaction.create', icon: 'Banknote' },
  { section: 'Akun', title: 'Akun / profil', description: 'Peran, akses, dan pengaturan akun', destination: '/(app)/(tabs)/account', icon: 'UserRound' },
];

export default function OperationsScreen() {
  const { user } = useAuth();
  const isEmployee = user?.roles.some((role) => role.toUpperCase() === 'PEGAWAI') ?? false;
  const features = isEmployee ? employeeFeatures : adminFeatures;
  const visibleFeatures = features.filter(({ permission, title }) =>
    !permission || user?.permissions.includes(permission) ||
    (title === 'Permintaan stok' && (user?.permissions.includes('stock_request.create') || user?.permissions.includes('stock_request.review'))) ||
    (title === 'Cash closing' && user?.permissions.includes('cash_closing.create')),
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
          <View style={styles.list}>{sectionFeatures.map((feature) => <Pressable accessibilityRole="button" onPress={() => router.push(feature.destination)} key={feature.title} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
            <View style={styles.icon}><FeatureIcon name={feature.icon as FeatureIconName} /></View>
            <View style={styles.content}><Text style={styles.cardTitle}>{feature.title}</Text><Text style={styles.cardDescription}>{feature.description}</Text></View>
            <ChevronRight size={19} color="#9aa59f" />
          </Pressable>)}</View>
        </View>;
      })}
      {!visibleFeatures.length ? <View style={styles.empty}><Text style={styles.cardTitle}>Belum ada menu tersedia</Text><Text style={styles.cardDescription}>Minta admin memeriksa akses akun Anda.</Text></View> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 24, paddingBottom: 28 },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 7, color: '#172820', fontSize: 26, fontWeight: '800' },
  subtitle: { marginTop: 6, color: '#718078', fontSize: 13 },
  section: { marginTop: 26 },
  sectionTitle: { marginBottom: 10, color: '#53635a', fontSize: 12, fontWeight: '800' },
  list: { gap: 8 },
  card: { minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 14, backgroundColor: '#fff' },
  cardPressed: { borderColor: '#e5a5a8', backgroundColor: '#fff8f8' },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#fff0f0' },
  content: { flex: 1, minWidth: 0, marginHorizontal: 12 },
  cardTitle: { color: '#28372f', fontSize: 14, fontWeight: '800' },
  cardDescription: { marginTop: 4, color: '#8a968f', fontSize: 11, lineHeight: 15 },
  empty: { marginTop: 22, padding: 18, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 14, backgroundColor: '#fff' },
});
