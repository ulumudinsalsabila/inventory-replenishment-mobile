import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronRight, Eye, EyeOff, KeyRound, X } from 'lucide-react-native';
import { useAuth } from '../../../auth/auth-provider';
import { ApiError } from '../../../lib/api';

const MIN_PASSWORD_LENGTH = 6;

const serverMessages: Record<string, string> = {
  'Current password is incorrect.': 'Kata sandi saat ini salah.',
  'New password must be different from the current password.': 'Kata sandi baru harus berbeda dari kata sandi saat ini.',
};

export default function AccountScreen() {
  const { user, signOut, authorizedRequest } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const openPasswordForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setVisible(false);
    setError('');
    setSuccess('');
    setPasswordOpen(true);
  };

  const closePasswordForm = () => {
    if (!saving) setPasswordOpen(false);
  };

  const submitPassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) return setError('Lengkapi semua kolom kata sandi.');
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError(`Kata sandi baru minimal ${MIN_PASSWORD_LENGTH} karakter.`);
    if (newPassword !== confirmPassword) return setError('Konfirmasi kata sandi baru tidak sama.');
    if (newPassword === currentPassword) return setError(serverMessages['New password must be different from the current password.']);

    setSaving(true);
    setError('');
    try {
      await authorizedRequest('auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setPasswordOpen(false);
      setSuccess('Kata sandi berhasil diubah.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Gagal mengubah kata sandi.';
      setError(serverMessages[message] ?? message);
    } finally {
      setSaving(false);
    }
  };

  const disabled = saving || !currentPassword || !newPassword || !confirmPassword;

  return (
    <View style={styles.page}>
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
      <Pressable accessibilityRole="button" onPress={openPasswordForm} style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
        <View style={styles.menuIcon}><KeyRound color="#087f5b" size={19} /></View>
        <Text style={styles.menuText}>Ganti kata sandi</Text>
        <ChevronRight color="#8a968f" size={19} />
      </Pressable>
      {success ? <Text accessibilityRole="alert" style={styles.success}>{success}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void signOut()} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
        <Text style={styles.signOutText}>Keluar dari akun</Text>
      </Pressable>

      <Modal animationType="slide" transparent visible={passwordOpen} onRequestClose={closePasswordForm}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closePasswordForm} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Ganti kata sandi</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={closePasswordForm} style={styles.closeButton}><X color="#53677e" size={18} /></Pressable>
            </View>
            <PasswordField label="Kata sandi saat ini" value={currentPassword} onChangeText={setCurrentPassword} visible={visible} autoComplete="current-password" />
            <PasswordField label="Kata sandi baru" value={newPassword} onChangeText={setNewPassword} visible={visible} autoComplete="new-password" hint={`Minimal ${MIN_PASSWORD_LENGTH} karakter.`} />
            <PasswordField label="Konfirmasi kata sandi baru" value={confirmPassword} onChangeText={setConfirmPassword} visible={visible} autoComplete="new-password" onSubmitEditing={() => void submitPassword()} />
            <Pressable accessibilityRole="button" onPress={() => setVisible((current) => !current)} style={styles.toggleVisible}>
              {visible ? <EyeOff color="#53677e" size={17} /> : <Eye color="#53677e" size={17} />}
              <Text style={styles.toggleVisibleText}>{visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}</Text>
            </Pressable>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void submitPassword()} style={({ pressed }) => [styles.primary, disabled && styles.dim, pressed && !disabled && styles.pressed]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Simpan kata sandi</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function PasswordField({ label, value, onChangeText, visible, autoComplete, hint, onSubmitEditing }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete={autoComplete}
        autoCorrect={false}
        placeholder={label}
        placeholderTextColor="#9ba7b5"
        secureTextEntry={!visible}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={onSubmitEditing ? 'done' : 'next'}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 20, paddingTop: 24 },
  eyebrow: { color: '#087f5b', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 7, color: '#172820', fontSize: 25, fontWeight: '800' },
  card: { alignItems: 'center', marginTop: 22, padding: 22, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 18, backgroundColor: '#fff' },
  avatar: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#dff3e9' },
  avatarText: { color: '#087f5b', fontSize: 24, fontWeight: '800' },
  name: { marginTop: 12, color: '#172820', fontSize: 14, fontWeight: '800' },
  email: { marginTop: 4, color: '#819087', fontSize: 12 },
  divider: { height: 1, alignSelf: 'stretch', marginVertical: 18, backgroundColor: '#edf1ee' },
  label: { alignSelf: 'stretch', marginTop: 10, color: '#8a968f', fontSize: 11, fontWeight: '700' },
  value: { alignSelf: 'stretch', marginTop: 4, color: '#34453b', fontSize: 12, fontWeight: '700' },
  menuItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 16, paddingHorizontal: 14, borderWidth: 1, borderColor: '#e8eeea', borderRadius: 15, backgroundColor: '#fff' },
  menuIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#e7f5ee' },
  menuText: { flex: 1, color: '#26372e', fontSize: 14, fontWeight: '800' },
  success: { marginTop: 10, padding: 11, borderRadius: 11, backgroundColor: '#e7f5ee', color: '#087f5b', fontSize: 12, fontWeight: '700' },
  signOut: { height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 16, borderWidth: 1, borderColor: '#f0d6d3', borderRadius: 15, backgroundColor: '#fff' },
  pressed: { opacity: 0.7 },
  signOutText: { color: '#b42318', fontSize: 14, fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  sheet: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sheetTitle: { color: '#172820', fontSize: 15, fontWeight: '900' },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eaf0f3' },
  field: { marginTop: 10 },
  fieldLabel: { marginBottom: 6, color: '#718078', fontSize: 11, fontWeight: '700' },
  input: { minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, backgroundColor: '#fff', color: '#26372e', fontSize: 12 },
  fieldHint: { marginTop: 5, color: '#8a968f', fontSize: 11 },
  toggleVisible: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 12, paddingVertical: 4 },
  toggleVisibleText: { color: '#53677e', fontSize: 12, fontWeight: '700' },
  error: { marginTop: 10, padding: 11, borderRadius: 11, backgroundColor: '#fff1ef', color: '#a3332a', fontSize: 12, lineHeight: 17 },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 14, borderRadius: 12, backgroundColor: '#087f5b' },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  dim: { opacity: 0.55 },
});
