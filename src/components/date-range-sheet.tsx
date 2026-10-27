import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CalendarDays, X } from 'lucide-react-native';
import { customRangeLabel, fromDateKey, jakartaDate, toDateKey, type CustomRange } from '../lib/date-range';

const dateLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

type Props = {
  /** The range to start from (the current custom range, or e.g. today). */
  initial: CustomRange;
  bottomInset: number;
  onApply: (range: CustomRange) => void;
  onClose: () => void;
};

/** Picks a custom from/to date range (e.g. two days) for report and order filters; mount it only while it is shown. */
export function DateRangeSheet({ initial, bottomInset, onApply, onClose }: Props) {
  const today = jakartaDate();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [editing, setEditing] = useState<'from' | 'to' | null>(null);
  const [error, setError] = useState('');

  // Picking an end before the start (or a start after the end) moves the other end along, so the range stays valid.
  const pick = (field: 'from' | 'to', date: Date) => {
    const key = toDateKey(date);
    if (field === 'from') { setFrom(key); if (key > to) setTo(key); }
    else { setTo(key); if (key < from) setFrom(key); }
    setError('');
  };
  const apply = () => {
    if (from > to) { setError('Tanggal mulai tidak boleh setelah tanggal akhir.'); return; }
    onApply({ from, to });
  };

  const field = (key: 'from' | 'to', label: string, value: string) => <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${dateLabel.format(fromDateKey(value))}`} onPress={() => setEditing(editing === key ? null : key)} style={[styles.field, editing === key && styles.fieldActive]}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={styles.fieldValueRow}><CalendarDays size={16} color="#07845f" /><Text style={styles.fieldValue}>{dateLabel.format(fromDateKey(value))}</Text></View>
  </Pressable>;

  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <View style={[styles.sheet, { paddingBottom: Math.max(bottomInset + 8, 20) }]}>
        <View style={styles.header}>
          <View style={styles.flex}><Text style={styles.title}>Pilih tanggal</Text><Text style={styles.muted}>{customRangeLabel({ from, to })}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={onClose} style={styles.close}><X size={18} color="#53677e" /></Pressable>
        </View>
        <View style={styles.fields}>{field('from', 'Dari', from)}{field('to', 'Sampai', to)}</View>
        {editing && Platform.OS === 'android' ? <DateTimePicker value={fromDateKey(editing === 'from' ? from : to)} mode="date" display="default" maximumDate={fromDateKey(today)} onChange={(event, date) => { const target = editing; setEditing(null); if (event.type === 'set' && date) pick(target, date); }} /> : null}
        {editing && Platform.OS !== 'android' ? <DateTimePicker value={fromDateKey(editing === 'from' ? from : to)} mode="date" display="spinner" maximumDate={fromDateKey(today)} onChange={(_, date) => { if (date) pick(editing, date); }} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={apply} style={styles.submit}><Text style={styles.submitText}>Terapkan</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#13221c80' },
  sheet: { paddingHorizontal: 16, paddingTop: 15, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  flex: { flex: 1, minWidth: 0 },
  title: { color: '#172338', fontSize: 15, fontWeight: '900' },
  muted: { marginTop: 3, color: '#718096', fontSize: 11 },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' },
  fields: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, padding: 11, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 12 },
  fieldActive: { borderColor: '#07956f', backgroundColor: '#ecfaf4' },
  fieldLabel: { color: '#71839a', fontSize: 10, fontWeight: '800' },
  fieldValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  fieldValue: { flex: 1, color: '#172338', fontSize: 12, fontWeight: '800' },
  error: { marginTop: 10, color: '#a3332a', fontSize: 11 },
  submit: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 14, borderRadius: 12, backgroundColor: '#07885b' },
  submitText: { color: '#fff', fontSize: 13, fontWeight: '900' },
});
