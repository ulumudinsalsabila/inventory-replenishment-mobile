import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Printer, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PairedPrinter } from '../lib/receipt-printer';

type Props = {
  visible: boolean;
  title: string;
  /** Plain receipt text, exactly as it will be sent to the printer. */
  text: string;
  /** Leading lines of  the printer prints bold (the store name on order receipts). */
  boldLines?: number;
  printer: PairedPrinter | null;
  printing: boolean;
  error: string;
  onPrint: () => void;
  onChangePrinter: () => void;
  onClose: () => void;
};

/** Shows a 58 mm receipt the way the thermal printer will lay it out, before anything is sent. */
export function ThermalPreview({ visible, title, text, boldLines = 0, printer, printing, error, onPrint, onChangePrinter, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!printing) onClose(); }}>
    <View style={styles.backdrop}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
        <View style={styles.header}>
          <View style={styles.headerText}><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>Pratinjau kertas 58 mm</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Tutup pratinjau" disabled={printing} onPress={onClose} style={styles.close}><X size={19} color="#52657d" /></Pressable>
        </View>
        <ScrollView style={styles.paperScroll} contentContainerStyle={styles.paperWrap}>
          <View style={styles.paper}>
            <Text selectable style={styles.receiptText}>{boldLines > 0 ? <><Text style={styles.bold}>{text.split('\n').slice(0, boldLines).join('\n')}</Text>{'\n'}{text.split('\n').slice(boldLines).join('\n')}</> : text}</Text>
            <View style={styles.tear} />
          </View>
        </ScrollView>
        <View style={styles.printerRow}>
          <Printer size={17} color="#087f5b" />
          <View style={styles.headerText}><Text style={styles.printerLabel}>Printer</Text><Text numberOfLines={1} style={styles.printerName}>{printer?.name ?? 'Belum dipilih'}</Text></View>
          <Pressable accessibilityRole="button" disabled={printing} onPress={onChangePrinter} style={styles.changeButton}><Text style={styles.changeText}>{printer ? 'Ganti' : 'Pilih'}</Text></Pressable>
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={printing} onPress={onClose} style={styles.secondary}><Text style={styles.secondaryText}>Batal</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={printing || !printer} onPress={onPrint} style={[styles.primary, (printing || !printer) && styles.disabled]}>{printing ? <ActivityIndicator color="#fff" /> : <><Printer size={17} color="#fff" /><Text style={styles.primaryText}>Cetak sekarang</Text></>}</Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172980' },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '92%', alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#f4f6f8' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: '#172338', fontSize: 14, fontWeight: '900' },
  subtitle: { marginTop: 2, color: '#708096', fontSize: 11 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#e8edf1' },
  paperScroll: { flexGrow: 0 },
  paperWrap: { alignItems: 'center', paddingVertical: 6 },
  // 32 monospace characters at 12 px is about the width of a 58 mm roll.
  paper: { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 10, borderRadius: 4, backgroundColor: '#fff', shadowColor: '#0a1729', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  receiptText: { color: '#111', fontSize: 12, lineHeight: 17, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  bold: { fontWeight: '900' },
  tear: { height: 1, marginTop: 14, borderTopWidth: 1, borderColor: '#cfd6dd', borderStyle: 'dashed' },
  printerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 11, borderRadius: 12, backgroundColor: '#fff' },
  printerLabel: { color: '#708096', fontSize: 10 },
  printerName: { marginTop: 2, color: '#26384a', fontSize: 12, fontWeight: '800' },
  changeButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: '#e7f6ef' },
  changeText: { color: '#087f5b', fontSize: 12, fontWeight: '900' },
  error: { marginTop: 10, padding: 10, borderRadius: 9, overflow: 'hidden', color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  secondary: { minWidth: 96, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dfe6ec', borderRadius: 12, backgroundColor: '#fff' },
  secondaryText: { color: '#53677e', fontSize: 12, fontWeight: '800' },
  primary: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: '#07885b' },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.5 },
});
