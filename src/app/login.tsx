import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ArrowRight, BarChart3, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/auth-provider';
import { ApiError } from '../lib/api';

const EMAIL_DOMAIN = '@dagora.app';

function WarehouseArtwork() {
  return (
    <View pointerEvents="none" style={styles.artwork}>
      <View style={styles.chartCard}>
        <BarChart3 color="#27d7ad" size={38} strokeWidth={2.5} />
      </View>
      <View style={[styles.shelf, styles.shelfTop]} />
      <View style={[styles.shelf, styles.shelfBottom]} />
      <View style={[styles.box, styles.boxOne]}><View style={styles.boxTape} /></View>
      <View style={[styles.box, styles.boxTwo]}><View style={styles.boxTape} /></View>
      <View style={[styles.box, styles.boxThree]}><View style={styles.boxTape} /></View>
      <View style={[styles.box, styles.boxFour]}><View style={styles.boxTape} /></View>
      <View style={styles.checkCard}><Text style={styles.checkMark}>✓</Text></View>
    </View>
  );
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { accessToken, loading, signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cleanUsername = username.trim().toLowerCase();

  if (loading) return <View style={styles.loading}><StatusBar style="dark" /><ActivityIndicator color="#00a977" size="large" /></View>;
  if (accessToken) return <Redirect href="/(app)/(tabs)" />;

  async function handleLogin() {
    if (!cleanUsername || password.length < 6 || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await signIn(`${cleanUsername}${EMAIL_DOMAIN}`, password);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Tidak dapat masuk. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !cleanUsername || password.length < 6;

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="light" />
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={[styles.hero, { paddingTop: Math.max(insets.top + 18, 38) }]}>
          <View style={styles.heroGlow} />
          <WarehouseArtwork />
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Image accessibilityLabel="Logo Inventory Replenishment" source={require('../../assets/brand-splash.png')} style={styles.brandImage} resizeMode="contain" />
            </View>
            <View>
              <Text style={styles.brandName}>Inventory</Text>
              <Text style={styles.brandName}>Replenishment</Text>
              <Text style={styles.brandTagline}>Store & warehouse operations</Text>
            </View>
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>ONE OPERATIONAL TRUTH</Text>
            <Text style={styles.heroTitle}>Stok bergerak jelas.{`\n`}Kas tutup tanpa{`\n`}tebak-tebakan.</Text>
          </View>
        </View>

        <View style={[styles.formCard, { paddingBottom: Math.max(insets.bottom + 24, 34) }]}>
          <Text style={styles.welcome}>Selamat datang kembali</Text>
          <Text style={styles.title}>Masuk ke operasional</Text>
          <Text style={styles.subtitle}>Gunakan akun yang diberikan administrator bisnis Anda.</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Nama akun <Text style={styles.required}>*</Text></Text>
            <View style={styles.inputShell}>
              <UserRound color="#69798a" size={19} strokeWidth={2} />
              <TextInput
                autoCapitalize="none"
                autoComplete="username"
                autoCorrect={false}
                placeholder="nama"
                placeholderTextColor="#9ba7b5"
                style={styles.usernameInput}
                value={username}
                onChangeText={(value) => setUsername(value.replace(/\s/g, '').split('@')[0])}
                returnKeyType="next"
              />
              <View style={styles.domainBox}><Text style={styles.domainText}>{EMAIL_DOMAIN}</Text></View>
            </View>

            <Text style={[styles.label, styles.passwordLabel]}>Kata sandi <Text style={styles.required}>*</Text></Text>
            <View style={styles.inputShell}>
              <LockKeyhole color="#69798a" size={19} strokeWidth={2} />
              <TextInput
                autoCapitalize="none"
                autoComplete="password"
                placeholder="Masukkan kata sandi"
                placeholderTextColor="#9ba7b5"
                secureTextEntry={!passwordVisible}
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => void handleLogin()}
                returnKeyType="go"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                hitSlop={12}
                onPress={() => setPasswordVisible((current) => !current)}
                style={styles.eyeButton}
              >
                {passwordVisible ? <EyeOff color="#69798a" size={20} /> : <Eye color="#69798a" size={20} />}
              </Pressable>
            </View>

            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => void handleLogin()}
              style={({ pressed }) => [styles.button, pressed && !disabled && styles.buttonPressed, disabled && styles.buttonDisabled]}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <View style={styles.buttonContent}><Text style={styles.buttonText}>Masuk</Text><ArrowRight color="#fff" size={19} strokeWidth={2.5} /></View>}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#ffffff' },
  content: { flexGrow: 1, backgroundColor: '#071727' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  hero: { minHeight: 352, overflow: 'hidden', paddingHorizontal: 28, paddingBottom: 56, backgroundColor: '#061625' },
  heroGlow: { position: 'absolute', top: -115, left: -35, width: 285, height: 285, borderRadius: 150, backgroundColor: '#003b3d', opacity: 0.62 },
  brandRow: { zIndex: 2, flexDirection: 'row', alignItems: 'center', gap: 13 },
  brandMark: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#ffffff', padding: 7, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 6 },
  brandImage: { width: '100%', height: '100%' },
  brandName: { color: '#ffffff', fontSize: 14, fontWeight: '900', lineHeight: 22, letterSpacing: -0.45 },
  brandTagline: { marginTop: 3, color: '#a9b8c8', fontSize: 10.5, fontWeight: '500' },
  heroCopy: { zIndex: 2, marginTop: 25, maxWidth: 260 },
  eyebrow: { color: '#00d29a', fontSize: 10, fontWeight: '900', letterSpacing: 1.65 },
  heroTitle: { marginTop: 10, color: '#ffffff', fontSize: 25, fontWeight: '900', lineHeight: 27, letterSpacing: -0.7 },
  artwork: { position: 'absolute', zIndex: 1, right: -18, bottom: 17, width: 190, height: 265, opacity: 0.82 },
  shelf: { position: 'absolute', right: 3, width: 145, height: 9, borderRadius: 4, backgroundColor: '#143752', transform: [{ skewY: '-14deg' }] },
  shelfTop: { top: 100 },
  shelfBottom: { top: 194 },
  box: { position: 'absolute', borderRadius: 4, backgroundColor: '#087d82', borderWidth: 1, borderColor: '#0b9796', transform: [{ skewY: '-10deg' }] },
  boxTape: { position: 'absolute', top: 0, right: '38%', width: 10, height: '100%', backgroundColor: '#14b8a6', opacity: 0.65 },
  boxOne: { right: 18, top: 38, width: 69, height: 58 },
  boxTwo: { right: 94, top: 61, width: 55, height: 39, backgroundColor: '#0b5264' },
  boxThree: { right: 11, top: 128, width: 63, height: 61, backgroundColor: '#086d78' },
  boxFour: { right: 83, top: 143, width: 68, height: 48, backgroundColor: '#0b4c61' },
  chartCard: { position: 'absolute', top: 5, left: 14, width: 74, height: 65, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#1c5874', backgroundColor: '#0a2940', transform: [{ rotate: '-6deg' }] },
  checkCard: { position: 'absolute', right: 29, bottom: 4, width: 51, height: 67, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: '#087b82', transform: [{ rotate: '5deg' }] },
  checkMark: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2ad5ae', color: '#07545a', textAlign: 'center', fontSize: 22, fontWeight: '900', lineHeight: 30 },
  formCard: { flexGrow: 1, marginTop: -30, paddingHorizontal: 30, paddingTop: 32, borderTopLeftRadius: 38, borderTopRightRadius: 38, backgroundColor: '#ffffff' },
  welcome: { color: '#00a878', fontSize: 12, fontWeight: '800' },
  title: { marginTop: 7, color: '#0b1729', fontSize: 25, fontWeight: '900', letterSpacing: -0.7 },
  subtitle: { marginTop: 6, color: '#7b8796', fontSize: 12.5, lineHeight: 19 },
  form: { marginTop: 26 },
  label: { marginBottom: 8, color: '#263448', fontSize: 12.5, fontWeight: '700' },
  required: { color: '#df2e38' },
  passwordLabel: { marginTop: 18 },
  inputShell: { height: 54, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, borderWidth: 1, borderColor: '#dce3eb', borderRadius: 13, backgroundColor: '#ffffff', overflow: 'hidden' },
  usernameInput: { flex: 1, height: '100%', paddingHorizontal: 12, color: '#142033', fontSize: 14 },
  domainBox: { height: '100%', justifyContent: 'center', paddingHorizontal: 13, borderLeftWidth: 1, borderLeftColor: '#e4e9ef', backgroundColor: '#f4f6f9' },
  domainText: { color: '#7a8798', fontSize: 12.5, fontWeight: '600' },
  passwordInput: { flex: 1, height: '100%', paddingHorizontal: 12, color: '#142033', fontSize: 14 },
  eyeButton: { width: 50, height: '100%', alignItems: 'center', justifyContent: 'center' },
  error: { marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: '#fff0f1', color: '#b4232d', fontSize: 12, lineHeight: 18 },
  button: { height: 55, alignItems: 'center', justifyContent: 'center', marginTop: 24, borderRadius: 13, backgroundColor: '#00a878', shadowColor: '#00845f', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 5 },
  buttonPressed: { backgroundColor: '#008f67', transform: [{ scale: 0.995 }] },
  buttonDisabled: { opacity: 0.48 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
});
