import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, X } from 'lucide-react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ApiError } from '../lib/api';
import { MoneyInput } from './money-input';
import { shrinkPhotos } from '../lib/photo';

export type ResolutionType = 'CASHIER_REPLACED' | 'COUNT_ERROR' | 'WRITE_OFF';
export type ResolutionDestination = 'DRAWER' | 'HANDED_OVER';
/** POST /cash-closings/:id/resolutions record, as listed on the closing detail. */
export type CashClosingResolution = {
  id: string;
  type: ResolutionType;
  destination: ResolutionDestination | null;
  amount: string;
  reason: string;
  createdAt: string;
  createdBy?: { name: string } | null;
  attachments?: { id: string; url: string; fileName: string }[];
};

export const resolutionTypeLabel: Record<ResolutionType, string> = { CASHIER_REPLACED: 'Diganti kasir', COUNT_ERROR: 'Salah hitung', WRITE_OFF: 'Dihapusbukukan' };
export const resolutionDestinationLabel: Record<ResolutionDestination, string> = { DRAWER: 'masuk laci (kas masuk)', HANDED_OVER: 'diserahkan ke admin' };

const money = (value: string | number) => `Rp ${Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

type Props = {
  closing: { id: string; closingNumber: string; status: string; remainingDifference: string };
  bottomInset: number;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onResolved: (closing: unknown) => void;
  onClose: () => void;
};

/**
 * Admin-only: settles (part of) a cash closing difference. The closing keeps its numbers; this adds a settlement record
 * (cashier paid back, miscount or write-off). Mount it only while it is shown.
 */
export function CashResolutionSheet({ closing, bottomInset, request, onResolved, onClose }: Props) {
  const shortage = closing.status === 'SHORTAGE';
  const types: ResolutionType[] = shortage ? ['CASHIER_REPLACED', 'COUNT_ERROR', 'WRITE_OFF'] : ['COUNT_ERROR', 'WRITE_OFF'];
  const [type, setType] = useState<ResolutionType | null>(null);
  const [destination, setDestination] = useState<ResolutionDestination | null>(null);
  const [amount, setAmount] = useState(String(Math.trunc(Number(closing.remainingDifference))));
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const remaining = Number(closing.remainingDifference);

  async function addPhotos(useCamera: boolean) {
    if (photos.length >= 5) { setError('Maksimal 5 foto bukti.'); return; }
    const permission = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(useCamera ? 'Izin kamera diperlukan untuk mengambil foto.' : 'Izin galeri diperlukan untuk memilih foto.'); return; }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75, cameraType: ImagePicker.CameraType.back })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5 - photos.length, quality: 0.75 });
    if (result.canceled || !result.assets.length) return;
    const assets = await shrinkPhotos(result.assets);
    if (assets.some((asset) => Number(asset.fileSize ?? 0) > 5 * 1024 * 1024)) { setError('Ukuran tiap foto maksimal 5 MB.'); return; }
    setPhotos((current) => [...current, ...assets].slice(0, 5));
    setError('');
  }

  async function submit() {
    const value = Number(amount);
    if (!type) { setError('Pilih jenis penyelesaian.'); return; }
    if (type === 'CASHIER_REPLACED' && !destination) { setError('Pilih uang pengganti masuk laci atau diserahkan ke admin.'); return; }
    if (!(value > 0) || value > remaining) { setError(`Nominal harus lebih dari 0 dan maksimal ${money(remaining)}.`); return; }
    if (!reason.trim()) { setError('Alasan wajib diisi.'); return; }
    setSaving(true); setError('');
    try {
      const form = new FormData();
      form.append('type', type);
      if (type === 'CASHIER_REPLACED' && destination) form.append('destination', destination);
      form.append('amount', String(value));
      form.append('reason', reason.trim());
      photos.forEach((asset, index) => {
        const fileName = asset.fileName ?? asset.uri.split('/').pop() ?? `selisih-${index + 1}.jpg`;
        if (Platform.OS === 'web') {
          if (!asset.file) throw new Error('File foto dari browser tidak tersedia.');
          form.append('attachments', asset.file, fileName);
        } else form.append('attachments', new File(asset.uri), fileName);
      });
      onResolved(await request(`cash-closings/${closing.id}/resolutions`, { method: 'POST', body: form }));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'RESOLUTION_AMOUNT_EXCEEDED') setError('Nominal melebihi sisa selisih. Muat ulang detail closing lalu coba lagi.');
      else setError(cause instanceof Error ? cause.message : 'Penyelesaian selisih gagal disimpan.');
    } finally { setSaving(false); }
  }

  const close = () => { if (!saving) onClose(); };
  return <Modal visible transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
      <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset + 8, 20) }]}>
        <View style={styles.header}>
          <View style={styles.flex}><Text style={styles.title}>Selesaikan selisih</Text><Text style={styles.muted}>{closing.closingNumber} · sisa {shortage ? 'kurang' : 'lebih'} {money(remaining)}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Tutup" disabled={saving} onPress={close} style={styles.close}><X size={18} color="#53677e" /></Pressable>
        </View>
        <KeyboardAwareScrollView bottomOffset={24} style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>Angka closing tidak diubah. Penyelesaian dicatat terpisah dan tercatat di audit.</Text>
          <Text style={styles.label}>Jenis penyelesaian *</Text>
          {types.map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: type === option }} disabled={saving} onPress={() => { setType(option); setError(''); }} style={[styles.choice, type === option && styles.choiceSelected]}>
            <Text style={[styles.choiceTitle, type === option && styles.choiceTitleSelected]}>{resolutionTypeLabel[option]}</Text>
            <Text style={styles.choiceHint}>{option === 'CASHIER_REPLACED' ? 'Kasir menyerahkan kekurangan uangnya.' : option === 'COUNT_ERROR' ? 'Uang fisik sebenarnya sesuai, hanya salah input saat closing.' : shortage ? 'Kekurangan diterima sebagai kerugian toko.' : 'Kelebihan diterima sebagai pendapatan toko.'}</Text>
          </Pressable>)}
          {type === 'CASHIER_REPLACED' ? <>
            <Text style={styles.label}>Uang pengganti *</Text>
            <View style={styles.row}>{(['DRAWER', 'HANDED_OVER'] as const).map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: destination === option }} disabled={saving} onPress={() => { setDestination(option); setError(''); }} style={[styles.choice, styles.flex, destination === option && styles.choiceSelected]}>
              <Text style={[styles.choiceTitle, destination === option && styles.choiceTitleSelected]}>{option === 'DRAWER' ? 'Masuk laci' : 'Ke admin'}</Text>
              <Text style={styles.choiceHint}>{option === 'DRAWER' ? 'Dicatat sebagai kas masuk kasir untuk closing berikutnya.' : 'Diserahkan langsung, laci tidak berubah.'}</Text>
            </Pressable>)}</View>
          </> : null}
          <Text style={styles.label}>Nominal *</Text>
          <MoneyInput accessibilityLabel="Nominal penyelesaian" editable={!saving} value={amount} onChangeText={setAmount} style={styles.input} />
          <Text style={styles.hint}>Bisa sebagian kalau kasir mencicil. Maksimal {money(remaining)}.</Text>
          <Text style={styles.label}>Alasan *</Text>
          <TextInput accessibilityLabel="Alasan penyelesaian selisih" editable={!saving} value={reason} onChangeText={setReason} maxLength={500} multiline placeholder="Contoh: kasir mengganti kekurangan shift pagi" placeholderTextColor="#87948c" style={[styles.input, styles.multiline]} />
          <Text style={styles.label}>Foto bukti (opsional)</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => void addPhotos(true)} style={styles.photoButton}><Camera size={16} color="#087f5b" /><Text style={styles.photoText}>Kamera</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => void addPhotos(false)} style={styles.photoButton}><ImagePlus size={16} color="#087f5b" /><Text style={styles.photoText}>Galeri</Text></Pressable>
          </View>
          {photos.length ? <View style={styles.photos}>{photos.map((photo, index) => <View key={`${photo.uri}-${index}`}><Image source={{ uri: photo.uri }} style={styles.photo} /><Pressable accessibilityRole="button" accessibilityLabel="Hapus foto" onPress={() => setPhotos((current) => current.filter((_, at) => at !== index))} style={styles.photoRemove}><X size={12} color="#fff" /></Pressable></View>)}</View> : null}
        </KeyboardAwareScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => void submit()} style={[styles.submit, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Simpan penyelesaian</Text>}</Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  sheet: { maxHeight: '92%', paddingHorizontal: 16, paddingTop: 15, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  flex: { flex: 1, minWidth: 0 },
  title: { color: '#172338', fontSize: 15, fontWeight: '900' },
  muted: { marginTop: 3, color: '#718096', fontSize: 11 },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' },
  body: { flexGrow: 0 },
  content: { paddingBottom: 12 },
  hint: { marginTop: 5, color: '#71839a', fontSize: 10, lineHeight: 14 },
  label: { marginTop: 14, marginBottom: 6, color: '#53635a', fontSize: 11, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8 },
  choice: { marginBottom: 7, padding: 11, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 11 },
  choiceSelected: { borderColor: '#07956f', backgroundColor: '#ecfaf4' },
  choiceTitle: { color: '#26374e', fontSize: 12, fontWeight: '800' },
  choiceTitleSelected: { color: '#07845f' },
  choiceHint: { marginTop: 3, color: '#71839a', fontSize: 10, lineHeight: 14 },
  input: { minHeight: 44, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 10, color: '#172338', fontSize: 13, fontWeight: '700' },
  multiline: { minHeight: 70, paddingTop: 10, textAlignVertical: 'top' },
  photoButton: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, backgroundColor: '#e7f5ee' },
  photoText: { color: '#087f5b', fontSize: 11, fontWeight: '800' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  photo: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#eef2f4' },
  photoRemove: { position: 'absolute', top: -5, right: -5, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#b42318' },
  error: { marginTop: 6, color: '#a3332a', fontSize: 11 },
  submit: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 12, backgroundColor: '#07885b' },
  submitText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.55 },
});
