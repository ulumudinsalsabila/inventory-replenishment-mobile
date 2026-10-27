import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ApiError } from '../lib/api';
import { formatStatus, openBillStockActions, type OpenBillStockAction } from '../lib/display';

export type DepositSettlement = 'REFUNDED' | 'FORFEITED';
/** A payment from GET /orders/:id; `cashClosingId` is set once a cash closing counted it. */
export type DepositPayment = { method: string; amount: string; status?: string; cashClosingId?: string | null };
/** POST /orders/:id/cancel-with-deposit adds these to the full order. */
export type DepositSettlementResult = { orderNumber: string; paidTotal: string | number; depositSettlement: DepositSettlement | null; depositRefunds: { refundNumber: string; method: string; amount: string | number }[] };

/** Only users with this permission may settle a deposit (refund or forfeit); the server checks order.cancel as well. */
export const DEPOSIT_SETTLE_PERMISSION = 'order.deposit_settle';
export const DEPOSIT_APPROVAL_MESSAGE = 'Butuh persetujuan admin untuk membatalkan bill dengan DP yang sudah masuk tutup kas.';

const money = (amount: number) => `Rp ${Math.max(0, amount).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const completed = (payments: DepositPayment[] | undefined) => (payments ?? []).filter((payment) => (payment.status ?? 'COMPLETED') === 'COMPLETED');
const sum = (payments: DepositPayment[]) => payments.reduce((total, payment) => total + Number(payment.amount), 0);

/** Deposit already counted by a cash closing: such an order can no longer be cancelled normally, only settled. */
export const closedDepositOf = (payments: DepositPayment[] | undefined) => sum(completed(payments).filter((payment) => payment.cashClosingId));

/** Amounts per payment method, in the order the methods first appear. */
function byMethod(payments: DepositPayment[]) {
  const totals = new Map<string, number>();
  for (const payment of payments) totals.set(payment.method, (totals.get(payment.method) ?? 0) + Number(payment.amount));
  return [...totals];
}

export function depositSettlementErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return DEPOSIT_APPROVAL_MESSAGE;
    if (error.code === 'DEPOSIT_REASON_REQUIRED') return 'Alasan wajib diisi untuk mengembalikan atau menghanguskan DP.';
    if (error.code === 'ORDER_HAS_NO_DEPOSIT') return 'Bill ini tidak memiliki DP. Batalkan bill dengan cara biasa.';
    if (error.code === 'INVALID_ORDER_STATE') return 'Bill ini sudah selesai atau dibatalkan sehingga tidak bisa dibatalkan lagi.';
    if (error.code === 'DEPOSIT_REFUND_LOCKED') return 'Refund DP tidak bisa dibatalkan.';
  }
  return error instanceof Error ? error.message : 'Bill gagal dibatalkan.';
}

/** "DP Rp X dikembalikan — keluarkan uang dari laci" / "DP Rp X hangus" after a successful settlement. */
export function depositSettlementNotice(result: DepositSettlementResult) {
  const amount = money(Number(result.paidTotal));
  return result.depositSettlement === 'FORFEITED'
    ? `Bill ${result.orderNumber} dibatalkan. DP ${amount} hangus.`
    : `Bill ${result.orderNumber} dibatalkan. DP ${amount} dikembalikan — keluarkan uang dari laci.`;
}

type DepositSettlementSheetProps = {
  orderNumber: string;
  payments: DepositPayment[] | undefined;
  /** False for users without order.deposit_settle: they see why and cannot submit. */
  canSettle: boolean;
  saving: boolean;
  error: string;
  bottomInset: number;
  onSubmit: (settlement: DepositSettlement, reason: string, stockAction: OpenBillStockAction) => void;
  onClose: () => void;
};

/**
 * "Batalkan Bill dengan DP": cancels a bill whose deposit already went into a cash closing, either handing the DP back
 * (closed payments leave through today's drawer, the rest is voided) or keeping it as income. Mount it only while it is shown.
 */
export function DepositSettlementSheet(props: DepositSettlementSheetProps) {
  const [settlement, setSettlement] = useState<DepositSettlement | null>(null);
  const [reason, setReason] = useState('');
  // The bill's goods already left stock: one choice for all of them, back to stock (unopened) or wasted (opened).
  const [stockAction, setStockAction] = useState<OpenBillStockAction | null>(null);
  const [localError, setLocalError] = useState('');
  const paid = completed(props.payments);
  const closed = paid.filter((payment) => payment.cashClosingId);
  const open = paid.filter((payment) => !payment.cashClosingId);
  const blocked = props.saving || !props.canSettle || !settlement || !stockAction || !reason.trim();
  const submit = () => {
    if (!settlement) { setLocalError('Pilih Kembalikan DP atau DP Hangus.'); return; }
    if (!stockAction) { setLocalError('Pilih barang dikembalikan ke stok atau terbuang.'); return; }
    if (!reason.trim()) { setLocalError('Alasan wajib diisi.'); return; }
    setLocalError('');
    props.onSubmit(settlement, reason.trim(), stockAction);
  };
  const error = localError || props.error;
  const close = () => { if (!props.saving) props.onClose(); };
  return <Modal visible transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
      <View style={[styles.sheet, { paddingBottom: Math.max(props.bottomInset + 8, 20) }]}>
        <View style={styles.header}><View style={styles.flex}><Text style={styles.title}>Batalkan Bill dengan DP</Text><Text style={styles.muted}>{props.orderNumber}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Tutup" disabled={props.saving} onPress={props.onClose} style={styles.close}><X size={18} color="#53677e" /></Pressable></View>
        <KeyboardAwareScrollView bottomOffset={24} style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.warning}>DP {money(sum(closed))} sudah masuk tutup kas.{open.length ? ` DP ${money(sum(open))} lainnya belum masuk tutup kas.` : ''} Pilih apa yang terjadi dengan DP sebelum bill dibatalkan.</Text>
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: settlement === 'REFUNDED' }} disabled={props.saving} onPress={() => { setSettlement('REFUNDED'); setLocalError(''); }} style={[styles.choice, settlement === 'REFUNDED' && styles.choiceSelected]}>
            <Text style={[styles.choiceTitle, settlement === 'REFUNDED' && styles.choiceTitleSelected]}>Kembalikan DP</Text>
            <Text style={styles.choiceHint}>Uang {money(sum(paid))} dikembalikan ke pelanggan.</Text>
            {byMethod(closed).map(([method, amount]) => <View key={`closed-${method}`} style={styles.row}><Text style={styles.rowLabel}>{formatStatus(method)} · dibayarkan hari ini</Text><Text style={styles.rowValue}>{money(amount)}</Text></View>)}
            {byMethod(open).map(([method, amount]) => <View key={`open-${method}`} style={styles.row}><Text style={styles.rowLabel}>{formatStatus(method)} · pembayaran dibatalkan</Text><Text style={styles.rowValue}>{money(amount)}</Text></View>)}
          </Pressable>
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: settlement === 'FORFEITED' }} disabled={props.saving} onPress={() => { setSettlement('FORFEITED'); setLocalError(''); }} style={[styles.choice, settlement === 'FORFEITED' && styles.choiceSelected]}>
            <Text style={[styles.choiceTitle, settlement === 'FORFEITED' && styles.choiceTitleSelected]}>DP Hangus</Text>
            <Text style={styles.choiceHint}>DP {money(sum(paid))} tidak dikembalikan dan dicatat sebagai pendapatan toko.</Text>
          </Pressable>
          <Text style={styles.label}>Barang di bill *</Text>
          {openBillStockActions.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: stockAction === option.value }} disabled={props.saving} onPress={() => { setStockAction(option.value); setLocalError(''); }} style={[styles.choice, stockAction === option.value && styles.choiceSelected]}>
            <Text style={[styles.choiceTitle, stockAction === option.value && styles.choiceTitleSelected]}>{option.label}</Text>
            <Text style={styles.choiceHint}>{option.hint}</Text>
          </Pressable>)}
          <Text style={styles.label}>Alasan *</Text>
          <TextInput accessibilityLabel="Alasan pembatalan bill dengan DP" editable={!props.saving} value={reason} onChangeText={setReason} maxLength={300} multiline placeholder="Wajib diisi, contoh: pelanggan membatalkan acara" placeholderTextColor="#87948c" style={styles.input} />
          {!props.canSettle ? <Text style={styles.approval}>{DEPOSIT_APPROVAL_MESSAGE}</Text> : null}
        </KeyboardAwareScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={blocked} onPress={submit} style={[styles.submit, blocked && styles.disabled]}>{props.saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{settlement === 'FORFEITED' ? 'Batalkan bill, DP hangus' : settlement === 'REFUNDED' ? 'Batalkan bill, kembalikan DP' : 'Batalkan bill'}</Text>}</Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0a172966' },
  sheet: { maxHeight: '90%', paddingTop: 14, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#edf1ee' },
  flex: { flex: 1 },
  title: { color: '#172820', fontSize: 15, fontWeight: '900' },
  muted: { marginTop: 4, color: '#84918b', fontSize: 10 },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eff3f5' },
  body: { flexGrow: 0 },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  warning: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#fff7e6', color: '#8a5a00', fontSize: 11, lineHeight: 16 },
  choice: { marginTop: 10, padding: 12, borderWidth: 1, borderColor: '#dce4df', borderRadius: 12, backgroundColor: '#fff' },
  choiceSelected: { borderColor: '#087f5b', backgroundColor: '#f2faf6' },
  choiceTitle: { color: '#34453b', fontSize: 12, fontWeight: '900' },
  choiceTitleSelected: { color: '#087f5b' },
  choiceHint: { marginTop: 4, color: '#718078', fontSize: 10, lineHeight: 15 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 },
  rowLabel: { flex: 1, color: '#5d6d64', fontSize: 10 },
  rowValue: { color: '#34453b', fontSize: 11, fontWeight: '800' },
  label: { marginTop: 13, marginBottom: 6, color: '#34453b', fontSize: 11, fontWeight: '800' },
  input: { minHeight: 76, paddingHorizontal: 12, paddingTop: 11, borderWidth: 1, borderColor: '#dce4df', borderRadius: 11, color: '#172820', backgroundColor: '#fff', textAlignVertical: 'top' },
  approval: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#fff1f0', color: '#a3332a', fontSize: 11, lineHeight: 16 },
  error: { marginHorizontal: 16, marginTop: 8, color: '#a3332a', fontSize: 11 },
  submit: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 13, marginHorizontal: 16, borderRadius: 12, backgroundColor: '#b42318' },
  submitText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.4 },
});
