import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../auth/auth-provider';
import { ApiError } from '../lib/api';

export default function LoginScreen() {
  const { accessToken, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <View style={styles.loading}><ActivityIndicator color="#087f5b" size="large" /></View>;
  if (accessToken) return <Redirect href="/(app)/(tabs)" />;

  async function handleLogin() {
    setError('');
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Tidak dapat masuk. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.brandMark}><Image accessibilityLabel="Logo Inventory Replenishment" source={require('../../assets/brand-splash.png')} style={styles.brandImage} resizeMode="contain" /></View>
      <Text style={styles.eyebrow}>INVENTORY REPLENISHMENT</Text>
      <Text style={styles.title}>Masuk ke akun</Text>
      <Text style={styles.subtitle}>Kelola operasional toko dari perangkat Anda.</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Email</Text>
        <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="nama@perusahaan.com" placeholderTextColor="#8b9691" style={styles.input} value={email} onChangeText={setEmail} />
        <Text style={styles.label}>Password</Text>
        <TextInput autoCapitalize="none" autoComplete="password" placeholder="Masukkan password" placeholderTextColor="#8b9691" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} onSubmitEditing={handleLogin} returnKeyType="go" />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={submitting || !email.trim() || password.length < 6} onPress={handleLogin} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, (submitting || !email.trim() || password.length < 6) && styles.buttonDisabled]}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Masuk</Text>}
        </Pressable>
      </View>
      <Text style={styles.footer}>Inventory Replenishment · Mobile</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f7f6' },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 28 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brandMark: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#ecfdf5', marginBottom: 28, padding: 7 },
  brandImage: { width: '100%', height: '100%' },
  eyebrow: { color: '#087f5b', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { marginTop: 8, color: '#13241d', fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { marginTop: 8, color: '#66736d', fontSize: 15, lineHeight: 22 },
  form: { marginTop: 34 },
  label: { marginBottom: 8, color: '#24362e', fontSize: 13, fontWeight: '700' },
  input: { height: 52, marginBottom: 18, paddingHorizontal: 15, borderWidth: 1, borderColor: '#dce4df', borderRadius: 14, backgroundColor: '#fff', color: '#13241d', fontSize: 15 },
  error: { marginBottom: 14, color: '#b42318', fontSize: 13, lineHeight: 19 },
  button: { height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#087f5b' },
  buttonPressed: { backgroundColor: '#066c4d' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  footer: { marginTop: 34, color: '#84918b', fontSize: 12, textAlign: 'center' },
});
