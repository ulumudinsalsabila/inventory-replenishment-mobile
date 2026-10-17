import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  loadingMore: boolean;
  hasMore: boolean;
  /** Rows currently shown; the footer stays hidden for empty lists, which render their own state. */
  count: number;
  /** Shown when loading the next page failed; tapping retries. */
  error?: string;
  onRetry?: () => void;
};

/** Footer for lazily loaded lists: a spinner while the next page loads, a retry on failure, and an end marker. */
export function LoadMoreFooter({ loadingMore, hasMore, count, error, onRetry }: Props) {
  if (!count) return null;
  if (loadingMore) return <ActivityIndicator style={styles.loader} color="#087f5b" />;
  if (error && hasMore) return <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Gagal memuat data berikutnya. Ketuk untuk coba lagi.</Text></Pressable>;
  if (!hasMore) return <View style={styles.end}><Text style={styles.endText}>Semua data sudah ditampilkan</Text></View>;
  return null;
}

const styles = StyleSheet.create({
  loader: { paddingVertical: 18 },
  retry: { alignItems: 'center', marginTop: 8, padding: 12, borderRadius: 11, backgroundColor: '#fff1f0' },
  retryText: { color: '#a3332a', fontSize: 11, fontWeight: '700' },
  end: { alignItems: 'center', paddingVertical: 14 },
  endText: { color: '#93a098', fontSize: 10 },
});
