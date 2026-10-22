import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Paperclip } from 'lucide-react-native';
import { useAuth } from '../../auth/auth-provider';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/display';
import { PreviewImage } from '../../components/image-viewer';

type Branch = { id: string; name: string; code: string };
type Attachment = { id: string; url: string; fileName: string; mimeType: string };
type CashDetail = { id: string; type: 'CASH_IN' | 'CASH_OUT'; amount: string; category: string; reason: string; createdAt: string; branch?: Branch; attachments?: Attachment[] };
const money = (value?: string | number | null) => `Rp ${Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

export default function CashInOutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { authorizedRequest } = useAuth();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<CashDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void authorizedRequest<CashDetail>(`cash-transactions/${encodeURIComponent(id)}`)
      .then((result) => { if (active) setDetail(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Detail transaksi belum dapat dimuat.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authorizedRequest, id]);

  const noteMarker = '\nCatatan: ';
  const noteIndex = detail?.reason.indexOf(noteMarker) ?? -1;
  const reasonText = noteIndex >= 0 ? detail?.reason.slice(0, noteIndex) : detail?.reason;
  const noteText = noteIndex >= 0 ? detail?.reason.slice(noteIndex + noteMarker.length) : '';

  return <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Kembali ke daftar kas" onPress={() => router.back()} style={styles.backButton}><ArrowLeft size={21} color="#26372e" /></Pressable><Text style={styles.title}>Detail transaksi</Text></View>
    {loading ? <ActivityIndicator style={styles.loader} color="#07885b" size="large" /> : error ? <Text style={styles.error}>{error}</Text> : detail ? <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.banner}>
        <View style={[styles.bannerIcon, detail.type === 'CASH_IN' ? styles.inIcon : styles.outIcon]}>{detail.type === 'CASH_IN' ? <ArrowDownLeft size={20} color="#07885b" /> : <ArrowUpRight size={20} color="#c23a36" />}</View>
        <View style={styles.bannerText}><Text style={styles.bannerTitle}>{detail.type === 'CASH_IN' ? 'Kas masuk' : 'Kas keluar'}</Text><Text style={styles.date}>{formatDateTime(detail.createdAt)}</Text></View>
        <Text style={[styles.amount, detail.type === 'CASH_IN' ? styles.inAmount : styles.outAmount]}>{detail.type === 'CASH_IN' ? '+' : '-'}{money(detail.amount)}</Text>
      </View>
      <View style={styles.card}>
        <DetailRow label="Kategori" value={detail.category || '-'} />
        <DetailRow label="Alasan" value={reasonText || '-'} />
        <DetailRow label="Cabang" value={detail.branch ? `${detail.branch.name} (${detail.branch.code})` : '-'} />
        {noteText ? <View style={styles.noteSection}><Text style={styles.sectionTitle}>Catatan</Text><Text style={styles.note}>{noteText}</Text></View> : null}
        <View style={styles.attachmentsHeader}><View><Text style={styles.sectionTitle}>Foto bukti</Text><Text style={styles.date}>{detail.attachments?.length ? `${detail.attachments.length} file` : 'Tidak ada lampiran'}</Text></View><Paperclip size={18} color="#71839a" /></View>
        {detail.attachments?.length ? <View style={styles.attachments}>{detail.attachments.map((attachment) => attachment.mimeType.startsWith('image/') ? <PreviewImage key={attachment.id} uri={attachment.url} images={detail.attachments!.filter((entry) => entry.mimeType.startsWith('image/')).map((entry) => entry.url)} index={detail.attachments!.filter((entry) => entry.mimeType.startsWith('image/')).indexOf(attachment)} accessibilityLabel={attachment.fileName} style={styles.attachmentImage} /> : <View key={attachment.id} style={styles.fileAttachment}><Paperclip size={16} color="#71839a" /><Text numberOfLines={2} style={styles.fileName}>{attachment.fileName}</Text></View>)}</View> : null}
      </View>
    </ScrollView> : null}
  </View>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' },
  header: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, backgroundColor: '#fff' },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#172338', fontSize: 15, fontWeight: '900' },
  content: { padding: 15, paddingBottom: 24 },
  banner: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, padding: 13, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' },
  bannerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  inIcon: { backgroundColor: '#e4f7ee' }, outIcon: { backgroundColor: '#fff0ed' },
  bannerText: { flex: 1, minWidth: 0 },
  bannerTitle: { color: '#25364a', fontSize: 12, fontWeight: '900' },
  date: { marginTop: 4, color: '#8191a3', fontSize: 9 },
  amount: { fontSize: 12, fontWeight: '900' },
  inAmount: { color: '#07885b' }, outAmount: { color: '#c23a36' },
  card: { paddingHorizontal: 13, borderWidth: 1, borderColor: '#e6ece8', borderRadius: 12, backgroundColor: '#fff' },
  detailRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: '#edf1f4' },
  label: { color: '#71839a', fontSize: 10 },
  value: { maxWidth: '68%', color: '#25364a', fontSize: 10, fontWeight: '800', textAlign: 'right' },
  noteSection: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#edf1f4' },
  sectionTitle: { color: '#25364a', fontSize: 11, fontWeight: '900' },
  note: { marginTop: 6, color: '#60758a', fontSize: 10, lineHeight: 15 },
  attachmentsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 13, paddingBottom: 10 },
  attachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 13 },
  attachmentImage: { width: 82, height: 82, borderRadius: 8, backgroundColor: '#edf2f4' },
  fileAttachment: { width: 132, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderWidth: 1, borderColor: '#e1e8ec', borderRadius: 8, backgroundColor: '#f8fafb' },
  fileName: { flex: 1, color: '#53677e', fontSize: 9 },
  loader: { padding: 28 },
  error: { margin: 15, padding: 12, borderRadius: 10, color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10 },
});
