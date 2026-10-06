import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/auth-provider';

export default function AccountScreen() {
  const { user, signOut } = useAuth();
  return (
    <View style={styles.page}>
      <Text style={styles.eyebrow}>AKUN</Text>
      <Text style={styles.title}>Profil</Text>
      <View style={styles.card}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{user?.name.slice(0, 1).toUpperCase() ?? 'U'}</Text></View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.divider} />
        <Text style={styles.label}>Peran</Text>
        <Text style={styles.value}>{user?.roles.join(', ') || '—'}</Text>
        <Text style={styles.label}>Akses</Text>
        <Text style={styles.value}>{user?.permissions.length ?? 0} permission aktif</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => void signOut()} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
        <Text style={styles.signOutText}>Keluar dari akun</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 20, paddingTop: 24 },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 7, color: '#172820', fontSize: 26, fontWeight: '800' },
  card: { alignItems: 'center', marginTop: 22, padding: 22, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 18, backgroundColor: '#fff' },
  avatar: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#dff3e9' },
  avatarText: { color: '#087f5b', fontSize: 24, fontWeight: '800' },
  name: { marginTop: 12, color: '#172820', fontSize: 17, fontWeight: '800' },
  email: { marginTop: 4, color: '#819087', fontSize: 12 },
  divider: { height: 1, alignSelf: 'stretch', marginVertical: 18, backgroundColor: '#edf1ee' },
  label: { alignSelf: 'stretch', marginTop: 10, color: '#8a968f', fontSize: 11, fontWeight: '700' },
  value: { alignSelf: 'stretch', marginTop: 4, color: '#34453b', fontSize: 13, fontWeight: '700' },
  signOut: { height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 16, borderWidth: 1, borderColor: '#f0d6d3', borderRadius: 15, backgroundColor: '#fff' },
  pressed: { opacity: 0.7 },
  signOutText: { color: '#b42318', fontSize: 14, fontWeight: '800' },
});
