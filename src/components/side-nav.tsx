import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ColorValue } from 'react-native';
import type { ReactNode } from 'react';
import { ChevronDown, CircleUserRound, Store } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../auth/auth-provider';
import { useBranchFilter } from '../auth/branch-filter';
import { OptionSheet } from './option-sheet';

type TabRoute = { key: string; name: string };
type TabOptions = {
  title?: string;
  tabBarLabel?: unknown;
  tabBarIcon?: (props: { focused: boolean; color: ColorValue; size: number }) => ReactNode;
  tabBarItemStyle?: unknown;
  tabBarAccessibilityLabel?: string;
};
export type SideNavProps = {
  state: { index: number; routes: TabRoute[] };
  descriptors: Record<string, { options: TabOptions }>;
  navigation: { emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean }; navigate: (name: string) => void };
};

const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
// expo-router hides `href: null` tabs by giving them `display: 'none'`.
const isHidden = (style: unknown) => Boolean(style && typeof style === 'object' && (style as { display?: string }).display === 'none');

/** Tablet navigation: the tab routes rendered as a left sidebar with the store identity and signed-in user. */
export function SideNav({ state, descriptors, navigation }: SideNavProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { branches, selectedBranchId, setSelectedBranchId, locked } = useBranchFilter();
  const [branchSheet, setBranchSheet] = useState(false);
  const branchName = branches.find((branch) => branch.id === selectedBranchId)?.name ?? (locked ? 'Toko Cabang' : 'Semua Cabang');

  return <View style={[styles.sidebar, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingLeft: insets.left + 12 }]}>
    <Pressable accessibilityRole={locked ? undefined : 'button'} accessibilityLabel={locked ? undefined : `Filter cabang: ${branchName}`} disabled={locked} onPress={() => setBranchSheet(true)} style={({ pressed }) => [styles.store, pressed && styles.pressed]}>
      <View style={styles.storeIcon}><Store size={20} color="#07956f" /></View>
      <View style={styles.storeText}>
        <View style={styles.storeNameLine}><Text numberOfLines={1} style={styles.storeName}>{branchName}</Text>{!locked ? <ChevronDown size={13} color="#61738a" /> : null}</View>
        <Text style={styles.storeDate}>{dateFormatter.format(new Date())}</Text>
      </View>
    </Pressable>

    <ScrollView style={styles.items} contentContainerStyle={styles.itemsContent}>
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options ?? {};
        if (isHidden(options.tabBarItemStyle)) return null;
        const focused = state.index === index;
        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
        const color = focused ? '#07885b' : '#52657d';
        return <Pressable
          key={route.key}
          accessibilityRole="button"
          accessibilityState={{ selected: focused }}
          accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
          onPress={() => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          }}
          style={({ pressed }) => [styles.item, focused && styles.itemActive, pressed && styles.pressed]}
        >
          {options.tabBarIcon?.({ focused, color, size: 19 })}
          <Text numberOfLines={1} style={[styles.itemLabel, focused && styles.itemLabelActive]}>{label}</Text>
        </Pressable>;
      })}
    </ScrollView>

    <Pressable accessibilityRole="button" accessibilityLabel="Buka profil" onPress={() => router.push('/(app)/(tabs)/account')} style={({ pressed }) => [styles.user, pressed && styles.pressed]}>
      <View style={styles.avatar}><CircleUserRound size={20} color="#52657d" /></View>
      <View style={styles.storeText}>
        <Text numberOfLines={1} style={styles.userName}>{user?.name ?? 'Pengguna'}</Text>
        <View style={styles.onlineLine}><View style={styles.onlineDot} /><Text style={styles.onlineText}>Online</Text></View>
      </View>
    </Pressable>

    {!locked ? <OptionSheet visible={branchSheet} title="Pilih cabang" selectedId={selectedBranchId} onSelect={setSelectedBranchId} onClose={() => setBranchSheet(false)}
      options={[{ id: '', label: 'Semua Cabang' }, ...branches.map((branch) => ({ id: branch.id, label: branch.name, hint: branch.code }))]} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  sidebar: { width: 220, paddingRight: 12, borderRightWidth: 1, borderRightColor: '#e8eeeb', backgroundColor: '#fff' },
  store: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, padding: 4, borderRadius: 12 },
  storeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#ddf7ed' },
  storeText: { flex: 1, minWidth: 0 },
  storeNameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  storeName: { flexShrink: 1, color: '#172338', fontSize: 13, fontWeight: '900' },
  storeDate: { marginTop: 3, color: '#708096', fontSize: 11 },
  items: { flex: 1 },
  itemsContent: { gap: 4 },
  item: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: 11 },
  itemActive: { backgroundColor: '#e3f6ee' },
  itemLabel: { flex: 1, color: '#41546b', fontSize: 13, fontWeight: '700' },
  itemLabelActive: { color: '#07885b', fontWeight: '900' },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 8, borderRadius: 12, backgroundColor: '#f4f7f6' },
  avatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#e7edf2' },
  userName: { color: '#26384a', fontSize: 12, fontWeight: '900' },
  onlineLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#18b77c' },
  onlineText: { color: '#708096', fontSize: 11 },
  pressed: { opacity: 0.7 },
});
