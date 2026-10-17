import { useEffect } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Bell, CheckCheck, ChevronRight } from 'lucide-react-native';
import { LoadMoreFooter } from '../../components/load-more-footer';
import { useAuth } from '../../auth/auth-provider';
import { useNotifications } from '../../notifications/notifications-provider';
import { formatDate } from '../../lib/display';
import { useInfiniteList, useLoadMoreOnScroll } from '../../lib/infinite-list';

type NotificationItem = { id: string; title: string; body: string; url: string | null; readAt: string | null; createdAt: string };

export default function NotificationsScreen() {
  const { authorizedRequest } = useAuth();
  const { unreadCount, refresh: refreshSummary } = useNotifications();
  const list = useInfiniteList<NotificationItem>(authorizedRequest, 'notifications');
  const scrollProps = useLoadMoreOnScroll(list.loadMore);
  const { items, setItems } = list;

  useEffect(() => {
    const initial = setTimeout(() => void refreshSummary(), 0);
    return () => clearTimeout(initial);
  }, [refreshSummary]);

  async function refresh() {
    await list.refresh();
    await refreshSummary();
  }

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) {
      await authorizedRequest(`notifications/${item.id}/read`, { method: 'PATCH' }).catch(() => undefined);
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
      await refreshSummary();
    }
    if (item.url) router.push(item.url as Href);
  }

  async function markAllRead() {
    await authorizedRequest('notifications/read-all', { method: 'PATCH' });
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
    await refreshSummary();
  }

  return <ScrollView
    {...scrollProps}
    style={styles.screen}
    contentContainerStyle={styles.page}
    refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void refresh()} tintColor="#07956f" />}
  >
    <View style={styles.heading}>
      <View><Text style={styles.title}>Pusat notifikasi</Text><Text style={styles.subtitle}>{unreadCount ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}</Text></View>
      {unreadCount ? <Pressable accessibilityRole="button" onPress={() => void markAllRead()} style={styles.readAll}><CheckCheck size={16} color="#07885b" /><Text style={styles.readAllText}>Baca semua</Text></Pressable> : null}
    </View>
    {list.loading && !items.length ? <ActivityIndicator style={styles.loader} color="#07956f" /> : null}
    {list.error && !items.length ? <Pressable accessibilityRole="button" onPress={() => void list.reload()} style={styles.error}><Text style={styles.errorText}>{list.error}</Text><Text style={styles.retry}>Coba lagi</Text></Pressable> : null}
    {!list.loading && !list.error && !items.length ? <View style={styles.empty}><Bell size={30} color="#91a098" /><Text style={styles.emptyTitle}>Belum ada notifikasi</Text><Text style={styles.emptyText}>Perubahan permintaan stok dan aktivitas penting akan tampil di sini.</Text></View> : null}
    <View style={styles.list}>{items.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void openNotification(item)} style={({ pressed }) => [styles.card, !item.readAt && styles.cardUnread, pressed && styles.pressed]}>
      <View style={[styles.icon, !item.readAt && styles.iconUnread]}><Bell size={18} color={!item.readAt ? '#07885b' : '#7b8995'} /></View>
      <View style={styles.content}><View style={styles.titleRow}><Text numberOfLines={1} style={[styles.itemTitle, !item.readAt && styles.itemTitleUnread]}>{item.title}</Text>{!item.readAt ? <View style={styles.unreadDot} /> : null}</View><Text style={styles.body}>{item.body}</Text><Text style={styles.time}>{formatDate(item.createdAt)}</Text></View>
      {item.url ? <ChevronRight size={17} color="#86958d" /> : null}
    </Pressable>)}</View>
    <LoadMoreFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={items.length} error={list.error} onRetry={list.loadMore} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f8f7' }, page: { padding: 14, paddingBottom: 30 },
  heading: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  title: { color: '#172338', fontSize: 20, fontWeight: '900' }, subtitle: { marginTop: 3, color: '#718078', fontSize: 11 },
  readAll: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#e3f6ee' }, readAllText: { color: '#07885b', fontSize: 10, fontWeight: '900' },
  loader: { padding: 28 }, list: { gap: 8 }, card: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderColor: '#e4ebe7', borderRadius: 14, backgroundColor: '#fff' },
  cardUnread: { borderColor: '#a9ddc8', backgroundColor: '#f4fcf8' }, icon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#eef2f4' }, iconUnread: { backgroundColor: '#dcf5e9' },
  content: { flex: 1, minWidth: 0 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, itemTitle: { flex: 1, color: '#45566a', fontSize: 12, fontWeight: '700' }, itemTitleUnread: { color: '#172338', fontWeight: '900' }, unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#e64040' },
  body: { marginTop: 4, color: '#66788c', fontSize: 10, lineHeight: 15 }, time: { marginTop: 5, color: '#93a098', fontSize: 9 }, pressed: { opacity: 0.7 },
  empty: { alignItems: 'center', marginTop: 28, padding: 24, borderWidth: 1, borderColor: '#e4ebe7', borderRadius: 16, backgroundColor: '#fff' }, emptyTitle: { marginTop: 10, color: '#26384a', fontSize: 13, fontWeight: '900' }, emptyText: { marginTop: 5, color: '#7a8993', fontSize: 10, lineHeight: 15, textAlign: 'center' },
  error: { padding: 14, borderRadius: 12, backgroundColor: '#fff0ef' }, errorText: { color: '#a3332a', fontSize: 11 }, retry: { marginTop: 5, color: '#087f5b', fontSize: 10, fontWeight: '900' },
});
