import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Bell, ChevronDown, CircleUserRound, Store } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/auth-provider';

type BranchPage = { data: Array<{ id: string; name: string }> };

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

export function AppShellHeader() {
  const insets = useSafeAreaInsets();
  const { user, authorizedRequest } = useAuth();
  const [branchName, setBranchName] = useState(user?.branchId ? 'Toko Cabang' : 'Semua Cabang');

  useEffect(() => {
    if (!user?.branchId) {
      setBranchName('Semua Cabang');
      return;
    }
    let active = true;
    void authorizedRequest<BranchPage>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc')
      .then((result) => {
        const branch = result.data.find((item) => item.id === user.branchId);
        if (active && branch) setBranchName(branch.name);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [authorizedRequest, user?.branchId]);

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.storeIcon}><Store size={21} color="#07956f" /></View>
        <View style={styles.identity}>
          <View style={styles.branchLine}>
            <Text numberOfLines={1} style={styles.branchName}>{branchName}</Text>
            {!user?.branchId ? <ChevronDown size={14} color="#61738a" /> : null}
          </View>
          <Text style={styles.date}>{dateFormatter.format(new Date())}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Notifikasi" onPress={() => router.push('/(app)/(tabs)/operations')} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Bell size={20} color="#52657d" />
          <View style={styles.notificationDot} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Buka profil" onPress={() => router.push('/(app)/(tabs)/account')} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <CircleUserRound size={22} color="#52657d" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e8eeeb' },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  storeIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#ddf7ed' },
  identity: { flex: 1, minWidth: 0, marginHorizontal: 10 },
  branchLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  branchName: { maxWidth: '88%', color: '#172338', fontSize: 14, fontWeight: '900' },
  date: { marginTop: 3, color: '#708096', fontSize: 10 },
  action: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: 5, borderRadius: 12, backgroundColor: '#f1f4f6' },
  notificationDot: { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderWidth: 1, borderColor: '#fff', borderRadius: 3, backgroundColor: '#e64040' },
  pressed: { opacity: 0.68 },
});
