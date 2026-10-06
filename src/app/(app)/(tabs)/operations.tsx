import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Banknote, ClipboardList, PackagePlus, PackageSearch, ReceiptText, ShoppingCart, SlidersHorizontal, Truck } from 'lucide-react-native';
import { useAuth } from '../../../auth/auth-provider';

type FeatureIconName = 'ShoppingCart' | 'ReceiptText' | 'PackageSearch' | 'PackagePlus' | 'Truck' | 'ClipboardList' | 'SlidersHorizontal' | 'Banknote';
function FeatureIcon({ name }: { name: FeatureIconName }) {
  const icons = { ShoppingCart, ReceiptText, PackageSearch, PackagePlus, Truck, ClipboardList, SlidersHorizontal, Banknote };
  const Icon = icons[name];
  return <Icon size={23} color="#c70d17" />;
}

const features = [
  { title: 'POS', description: 'Transaksi penjualan di kasir', permission: 'order.create', icon: 'ShoppingCart' },
  { title: 'Pesanan', description: 'Riwayat transaksi dan pembayaran', permission: 'order.read', icon: 'ReceiptText' },
  { title: 'Cek stok', description: 'Cari ketersediaan produk di gudang', permission: 'inventory.read', icon: 'PackageSearch' },
  { title: 'Permintaan stok', description: 'Ajukan dan pantau permintaan barang', permission: 'stock_request.create', icon: 'PackagePlus' },
  { title: 'Transfer gudang', description: 'Pantau dan terima kiriman barang', permission: 'inventory.read', icon: 'Truck' },
  { title: 'Stock opname', description: 'Hitung fisik persediaan', permission: 'inventory.read', icon: 'ClipboardList' },
  { title: 'Adjustment stok', description: 'Catat koreksi atau pengurangan stok', permission: 'inventory.adjust', icon: 'SlidersHorizontal' },
  { title: 'Kas masuk / keluar', description: 'Catat transaksi dan lakukan penutupan kas', permission: 'cash_closing.read', icon: 'Banknote' },
];

export default function OperationsScreen() {
  const { user } = useAuth();
  const visibleFeatures = features.filter(({ permission, title }) =>
    user?.permissions.includes(permission) || (title === 'Permintaan stok' && user?.permissions.includes('stock_request.review')) || (title === 'Kas masuk / keluar' && (user?.permissions.includes('cash_transaction.create') || user?.permissions.includes('cash_closing.create'))),
  );
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>OPERASIONAL HARIAN</Text>
      <Text style={styles.title}>Operasional</Text>
      <Text style={styles.subtitle}>Buka alur kerja yang tersedia sesuai akses akun Anda.</Text>
      <View style={styles.list}>{visibleFeatures.map((feature) => {
        const available = true;
        const destination = feature.title === 'Cek stok' ? '/(app)/inventory' : feature.title === 'Permintaan stok' ? '/(app)/stock-requests' : feature.title === 'Transfer gudang' ? '/(app)/transfers' : feature.title === 'Stock opname' ? '/(app)/opnames' : feature.title === 'Adjustment stok' ? '/(app)/adjustments' : feature.title === 'Pesanan' ? '/(app)/orders' : feature.title === 'Kas masuk / keluar' ? '/(app)/cash' : '/(app)/pos';
        return <Pressable accessibilityRole="button" onPress={() => router.push(destination)} key={`${feature.title}-${feature.permission}`} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
        <View style={styles.icon}><FeatureIcon name={feature.icon as FeatureIconName} /></View>
        <View style={styles.content}><Text style={styles.cardTitle}>{feature.title}</Text><Text style={styles.cardDescription}>{feature.description}</Text></View>
        <Text style={[styles.status, available && styles.availableStatus]}>{available ? 'Buka' : 'Segera'}</Text>
      </Pressable>; })}</View>
      {!visibleFeatures.length ? <View style={styles.empty}><Text style={styles.cardTitle}>Belum ada menu tersedia</Text><Text style={styles.cardDescription}>Minta admin memeriksa akses akun Anda.</Text></View> : null}
      <Text style={styles.note}>Menu yang tampil mengikuti izin pada akun Anda.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 24, paddingBottom: 28 },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 7, color: '#172820', fontSize: 26, fontWeight: '800' },
  subtitle: { marginTop: 6, color: '#718078', fontSize: 13 },
  list: { marginTop: 22, gap: 10 },
  card: { minHeight: 72, flexDirection: 'row', alignItems: 'center', padding: 13, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 16, backgroundColor: '#fff' },
  cardPressed: { borderColor: '#a8d7c2', backgroundColor: '#f6fcf8' },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#e7f5ee' },
  iconText: { color: '#087f5b', fontSize: 17, fontWeight: '800' },
  content: { flex: 1, marginLeft: 12 },
  cardTitle: { color: '#28372f', fontSize: 14, fontWeight: '800' },
  cardDescription: { marginTop: 4, color: '#8a968f', fontSize: 11 },
  status: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, backgroundColor: '#f1f4f2', color: '#84918b', fontSize: 9, fontWeight: '800' },
  availableStatus: { backgroundColor: '#e7f5ee', color: '#087f5b' },
  empty: { marginTop: 22, padding: 18, borderRadius: 16, backgroundColor: '#fff' },
  note: { marginTop: 18, color: '#95a099', fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
