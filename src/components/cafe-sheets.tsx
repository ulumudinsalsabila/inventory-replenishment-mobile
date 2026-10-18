import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Minus, Plus, Printer, Split, X } from 'lucide-react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { isPlausiblePhone } from '../lib/customers';
import { stationLabel, type PairedPrinter, type Station } from '../lib/receipt-printer';

const money = (value: number) => `Rp ${Math.max(0, value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const quantityText = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 3 });

/** A line of the saved bill (GET /orders/:id items) that can be moved, whole or in part, to the new bill. */
export type SplitSourceLine = {
  id: string;
  name: string;
  variant: string | null;
  /** In the line's selling unit (inputQuantity ?? quantity). */
  quantity: number;
  unit: string | null;
  total: number;
  sent: boolean;
  addons: string[];
};

/** One part of POST /orders/:id/split; without customer fields the new bill keeps the original bill's customer. */
export type SplitPart = { items: { orderItemId: string; quantity: string }[]; customerName?: string; customerPhone?: string };

type SplitBillSheetProps = {
  orderNumber: string;
  /** Customer of the original bill, the default for the new one. */
  customer: string;
  lines: SplitSourceLine[];
  saving: boolean;
  error: string;
  bottomInset: number;
  onSubmit: (part: SplitPart) => void;
  onClose: () => void;
};

/**
 * "Split Bill": picks how much of each line moves to one new open bill, with a live preview of both totals. Lines keep
 * their stored price and sent status on the server, so the preview is the stored line total shared by quantity.
 */
export function SplitBillSheet(props: SplitBillSheetProps) {
  const [moved, setMoved] = useState<Record<string, number>>({});
  const [ownCustomer, setOwnCustomer] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [localError, setLocalError] = useState('');
  const share = (line: SplitSourceLine, quantity: number) => line.quantity > 0 ? Math.round((line.total * quantity / line.quantity) * 100) / 100 : 0;
  const billTotal = props.lines.reduce((sum, line) => sum + line.total, 0);
  const newTotal = props.lines.reduce((sum, line) => sum + share(line, moved[line.id] ?? 0), 0);
  const movedCount = props.lines.filter((line) => (moved[line.id] ?? 0) > 0).length;
  const everything = props.lines.every((line) => (moved[line.id] ?? 0) >= line.quantity);
  // Steps of one in the selling unit; a fractional remainder (e.g. 1.5 kg) is reached on the last step.
  const step = (line: SplitSourceLine, delta: number) => setMoved((current) => {
    const value = current[line.id] ?? 0;
    const next = delta > 0 ? Math.min(line.quantity, value + 1) : Math.max(0, value - 1);
    // Kept to the 4 decimals the server accepts, so 2.3 - 1 - 1 is sent as 0.3 rather than 0.29999…
    return { ...current, [line.id]: Math.round(next * 10000) / 10000 };
  });
  const submit = () => {
    if (!movedCount) { setLocalError('Pilih minimal satu item untuk dipindah ke bill baru.'); return; }
    if (everything) { setLocalError('Sisakan minimal satu item di bill ini.'); return; }
    if (ownCustomer && !name.trim()) { setLocalError('Nama pelanggan bill baru wajib diisi.'); return; }
    if (ownCustomer && !isPlausiblePhone(phone)) { setLocalError('No. HP pelanggan bill baru wajib diisi dengan angka yang valid.'); return; }
    setLocalError('');
    props.onSubmit({
      items: props.lines.filter((line) => (moved[line.id] ?? 0) > 0).map((line) => ({ orderItemId: line.id, quantity: String(moved[line.id]) })),
      ...(ownCustomer ? { customerName: name.trim(), customerPhone: phone.trim() } : {}),
    });
  };
  const error = localError || props.error;
  return <Modal visible transparent animationType="slide" onRequestClose={() => { if (!props.saving) props.onClose(); }}>
    <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
      <View style={[styles.sheet, styles.tallSheet, { paddingBottom: Math.max(props.bottomInset + 8, 20) }]}>
        <View style={styles.header}><View style={styles.flex}><Text style={styles.title}>Split Bill {props.orderNumber}</Text><Text style={styles.subtitle}>Pilih jumlah item yang dipindah ke bill baru. Item yang tidak dipilih tetap di bill ini.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup" disabled={props.saving} onPress={props.onClose} style={styles.close}><X size={19} color="#435a72" /></Pressable></View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {props.lines.map((line) => {
            const value = moved[line.id] ?? 0;
            return <View key={line.id} style={[styles.line, value > 0 && styles.lineActive]}>
              <View style={styles.flex}>
                <Text numberOfLines={2} style={styles.lineName}>{line.name}{line.variant ? ` (${line.variant})` : ''}</Text>
                <Text numberOfLines={2} style={styles.lineMeta}>Di bill: {quantityText(line.quantity)}{line.unit ? ` ${line.unit}` : ''} · {money(line.total)}{line.sent ? ' · Terkirim' : ''}{line.addons.length ? ` · + ${line.addons.join(', ')}` : ''}</Text>
                {value > 0 ? <Text style={styles.lineMoved}>Pindah {quantityText(value)} · {money(share(line, value))}</Text> : null}
              </View>
              <View style={styles.stepper}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Kurangi ${line.name} di bill baru`} disabled={!value || props.saving} onPress={() => step(line, -1)} style={[styles.stepButton, (!value || props.saving) && styles.disabled]}><Minus size={15} color="#07885b" /></Pressable>
                <Text style={styles.stepValue}>{quantityText(value)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Tambah ${line.name} ke bill baru`} disabled={value >= line.quantity || props.saving} onPress={() => step(line, 1)} style={[styles.stepButtonActive, (value >= line.quantity || props.saving) && styles.disabled]}><Plus size={15} color="#fff" /></Pressable>
              </View>
            </View>;
          })}
          <Text style={styles.section}>PELANGGAN BILL BARU</Text>
          <View style={styles.choices}>
            {[{ label: 'Sama dengan bill ini', value: false }, { label: 'Pelanggan lain', value: true }].map((option) => <Pressable key={option.label} accessibilityRole="button" accessibilityState={{ selected: ownCustomer === option.value }} onPress={() => setOwnCustomer(option.value)} style={[styles.choice, ownCustomer === option.value && styles.choiceActive]}><Text style={[styles.choiceText, ownCustomer === option.value && styles.choiceTextActive]}>{option.label}</Text></Pressable>)}
          </View>
          {ownCustomer ? <>
            <TextInput accessibilityLabel="Nama pelanggan bill baru" value={name} onChangeText={setName} maxLength={100} placeholder="Nama pelanggan" placeholderTextColor="#8a97a8" style={styles.input} />
            <TextInput accessibilityLabel="Nomor HP pelanggan bill baru" value={phone} onChangeText={setPhone} maxLength={20} keyboardType="phone-pad" placeholder="08xxxxxxxxxx" placeholderTextColor="#8a97a8" style={styles.input} />
          </> : <Text style={styles.hint}>{props.customer || 'Tanpa nama'}</Text>}
        </ScrollView>
        <View style={styles.preview}>
          <View style={styles.previewRow}><Text style={styles.previewLabel}>Bill baru ({movedCount} item)</Text><Text style={styles.previewValue}>{money(newTotal)}</Text></View>
          <View style={styles.previewRow}><Text style={styles.previewLabel}>Sisa di {props.orderNumber}</Text><Text style={styles.previewValue}>{money(billTotal - newTotal)}</Text></View>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={props.saving || !movedCount} onPress={submit} style={[styles.primary, (props.saving || !movedCount) && styles.disabled]}>{props.saving ? <ActivityIndicator color="#fff" /> : <><Split size={16} color="#fff" /><Text style={styles.primaryText}>Buat Bill Baru</Text></>}</Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

type PrintSettingsSheetProps = {
  receiptPrinter: PairedPrinter | null;
  stationPrinters: Record<Station, PairedPrinter | null>;
  /** Bluetooth printers can only be chosen on Android; elsewhere tickets go through the system print dialog. */
  showPrinters: boolean;
  quickSaleTickets: boolean;
  bottomInset: number;
  onPickReceiptPrinter: () => void;
  onPickStationPrinter: (station: Station) => void;
  /** Forgets the station printer so its tickets go to the receipt printer again. */
  onResetStationPrinter: (station: Station) => void;
  onQuickSaleTicketsChange: (value: boolean) => void;
  onClose: () => void;
};

/** Per-device print settings: receipt printer, "Printer Bar" / "Printer Dapur" and tickets after quick sales. */
export function PrintSettingsSheet(props: PrintSettingsSheetProps) {
  const row = (label: string, printer: PairedPrinter | null, fallback: string, onPick: () => void, onReset?: () => void) => <View style={styles.printerRow}>
    <Printer size={17} color="#087f5b" />
    <View style={styles.flex}><Text style={styles.lineName}>{label}</Text><Text numberOfLines={1} style={styles.lineMeta}>{printer?.name ?? fallback}</Text></View>
    {onReset && printer ? <Pressable accessibilityRole="button" accessibilityLabel={`${label} ikut printer nota`} onPress={onReset} style={styles.smallButton}><Text style={styles.smallButtonText}>Reset</Text></Pressable> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`Pilih ${label}`} onPress={onPick} style={styles.smallButton}><Text style={styles.smallButtonText}>{printer ? 'Ganti' : 'Pilih'}</Text></Pressable>
  </View>;
  const receiptName = props.receiptPrinter?.name ?? 'printer nota';
  return <Modal visible transparent animationType="slide" onRequestClose={props.onClose}>
    <View style={styles.backdrop}>
      <View style={[styles.sheet, { paddingBottom: Math.max(props.bottomInset + 8, 24) }]}>
        <View style={styles.header}><View style={styles.flex}><Text style={styles.title}>Pengaturan cetak</Text><Text style={styles.subtitle}>Berlaku untuk perangkat ini saja.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={props.onClose} style={styles.close}><X size={19} color="#435a72" /></Pressable></View>
        {props.showPrinters ? <>
          {row('Printer nota', props.receiptPrinter, 'Belum dipilih', props.onPickReceiptPrinter)}
          {(['BAR', 'KITCHEN'] as const).map((station) => <View key={station}>{row(`Printer ${stationLabel(station)}`, props.stationPrinters[station], `Sama dengan ${receiptName}`, () => props.onPickStationPrinter(station), () => props.onResetStationPrinter(station))}</View>)}
          <Text style={styles.hint}>Tiket bar berisi minuman, tiket dapur berisi makanan, sesuai stasiun kategori produk.</Text>
        </> : <Text style={styles.hint}>Tiket bar dan dapur dicetak lewat dialog cetak sistem, satu per stasiun.</Text>}
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: props.quickSaleTickets }} onPress={() => props.onQuickSaleTicketsChange(!props.quickSaleTickets)} style={styles.toggle}>
          <View style={[styles.checkbox, props.quickSaleTickets && styles.checkboxChecked]}>{props.quickSaleTickets ? <Check size={13} color="#fff" /> : null}</View>
          <View style={styles.flex}><Text style={styles.lineName}>Cetak tiket bar/dapur setelah bayar</Text><Text style={styles.lineMeta}>Untuk penjualan langsung (bukan open bill).</Text></View>
        </Pressable>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  sheet: { maxHeight: '90%', paddingHorizontal: 16, paddingTop: 16, borderTopLeftRadius: 19, borderTopRightRadius: 19, backgroundColor: '#fff' },
  tallSheet: { height: '90%' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { color: '#172338', fontSize: 15, fontWeight: '900' },
  subtitle: { marginTop: 4, color: '#71839a', fontSize: 10, lineHeight: 15 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f0f4f7' },
  body: { gap: 8, paddingBottom: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderColor: '#e6ecef', borderRadius: 11 },
  lineActive: { borderColor: '#9bd9bf', backgroundColor: '#f2fbf7' },
  lineName: { color: '#172338', fontSize: 11, fontWeight: '900' },
  lineMeta: { marginTop: 3, color: '#74869d', fontSize: 9, lineHeight: 13 },
  lineMoved: { marginTop: 4, color: '#07885b', fontSize: 10, fontWeight: '900' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e3f6ee' },
  stepButtonActive: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#07956f' },
  stepValue: { minWidth: 22, color: '#293a4d', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  section: { marginTop: 8, color: '#687b91', fontSize: 9, fontWeight: '900' },
  choices: { flexDirection: 'row', gap: 7 },
  choice: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#edf2f5' },
  choiceActive: { backgroundColor: '#07956f' },
  choiceText: { color: '#597086', fontSize: 10, fontWeight: '800' },
  choiceTextActive: { color: '#fff' },
  input: { height: 44, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e3eaf0', borderRadius: 10, color: '#172338', fontSize: 12, fontWeight: '700' },
  hint: { marginTop: 4, color: '#71839a', fontSize: 10, lineHeight: 15 },
  preview: { gap: 4, marginTop: 6, padding: 10, borderRadius: 11, backgroundColor: '#f6f9f8' },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  previewLabel: { color: '#53677e', fontSize: 10, fontWeight: '700' },
  previewValue: { color: '#172338', fontSize: 12, fontWeight: '900' },
  error: { marginTop: 8, padding: 10, borderRadius: 9, overflow: 'hidden', color: '#a3332a', backgroundColor: '#fff1ef', fontSize: 10, lineHeight: 15 },
  primary: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, borderRadius: 11, backgroundColor: '#07956f' },
  primaryText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  printerRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: '#edf1f4' },
  smallButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 9, backgroundColor: '#edf7f2' },
  smallButtonText: { color: '#087f5b', fontSize: 10, fontWeight: '900' },
  toggle: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#b8c8bf', borderRadius: 6, backgroundColor: '#fff' },
  checkboxChecked: { borderColor: '#07885b', backgroundColor: '#07885b' },
});
