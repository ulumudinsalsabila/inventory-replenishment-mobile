import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Bell, ChevronDown, CircleUserRound, Store } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBranchFilter } from '../auth/branch-filter';
import { OptionSheet } from './option-sheet';

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

type HeaderProps = {
  /** Tablet mode: the sidebar shows the store, so the header shows `title` or `leading` instead. */
  compact?: boolean;
  title?: string;
  /** Replaces the title area in compact mode (for example a search field). */
  leading?: ReactNode;
  /** Extra actions after notifications and profile (for example a scan button). */
  trailing?: ReactNode;
};

export function AppShellHeader({ compact = false, title, leading, trailing }: HeaderProps = {}) {
  const insets = useSafeAreaInsets();
  const { branches, selectedBranchId, setSelectedBranchId, locked } = useBranchFilter();
  const [pickerVisible, setPickerVisible] = useState(false);
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);
  const branchName = selectedBranch?.name ?? (locked ? 'Toko Cabang' : 'Semua Cabang');

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <View style={[styles.header, compact && styles.headerCompact]}>
        {compact ? <View style={styles.compactLeading}>{leading ?? <Text numberOfLines={1} style={styles.title}>{title}</Text>}</View> : <Pressable
          accessibilityRole={locked ? undefined : 'button'}
          accessibilityLabel={locked ? undefined : `Filter cabang: ${branchName}`}
          disabled={locked}
          onPress={() => setPickerVisible(true)}
          style={({ pressed }) => [styles.branchButton, pressed && styles.pressed]}
        >
          <View style={styles.storeIcon}><Store size={21} color="#07956f" /></View>
          <View style={styles.identity}>
            <View style={styles.branchLine}>
              <Text numberOfLines={1} style={styles.branchName}>{branchName}</Text>
              {!locked ? <ChevronDown size={14} color="#61738a" /> : null}
            </View>
            <Text style={styles.date}>{dateFormatter.format(new Date())}</Text>
          </View>
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Notifikasi" onPress={() => router.push('/(app)/(tabs)/operations')} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Bell size={20} color="#52657d" />
          <View style={styles.notificationDot} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Buka profil" onPress={() => router.push('/(app)/(tabs)/account')} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <CircleUserRound size={22} color="#52657d" />
        </Pressable>
        {trailing}
      </View>
      {!locked && !compact ? <OptionSheet
        visible={pickerVisible}
        title="Pilih cabang"
        selectedId={selectedBranchId}
        onSelect={setSelectedBranchId}
        onClose={() => setPickerVisible(false)}
        options={[{ id: '', label: 'Semua Cabang' }, ...branches.map((branch) => ({ id: branch.id, label: branch.name, hint: branch.code }))]}
      /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e8eeeb' },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  storeIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#ddf7ed' },
  headerCompact: { minHeight: 68, paddingHorizontal: 18, gap: 4 },
  compactLeading: { flex: 1, minWidth: 0, marginRight: 8 },
  title: { color: '#172338', fontSize: 14, fontWeight: '900' },
  branchButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', borderRadius: 13 },
  identity: { flex: 1, minWidth: 0, marginHorizontal: 10 },
  branchLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  branchName: { maxWidth: '88%', color: '#172338', fontSize: 14, fontWeight: '900' },
  date: { marginTop: 3, color: '#708096', fontSize: 10 },
  action: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: 5, borderRadius: 12, backgroundColor: '#f1f4f6' },
  notificationDot: { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderWidth: 1, borderColor: '#fff', borderRadius: 3, backgroundColor: '#e64040' },
  pressed: { opacity: 0.68 },
});
