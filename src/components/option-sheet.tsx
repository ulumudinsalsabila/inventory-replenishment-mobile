import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SheetOption = { id: string; label: string; hint?: string };

export function OptionSheet({ visible, title, options, selectedId, onSelect, onClose }: {
  visible: boolean;
  title: string;
  options: SheetOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 14, 26) }]} onPress={(event) => event.stopPropagation()}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={onClose} style={styles.close}><X size={19} color="#52657d" /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {options.map((option) => {
            const active = option.id === selectedId;
            return <Pressable key={option.id || 'all'} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { onSelect(option.id); onClose(); }} style={[styles.option, active && styles.optionActive]}>
              <View style={styles.optionText}>
                <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
                {option.hint ? <Text style={styles.hint}>{option.hint}</Text> : null}
              </View>
              {active ? <Check size={17} color="#07956f" /> : null}
            </Pressable>;
          })}
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#13221c80' },
  sheet: { maxHeight: '72%', paddingHorizontal: 17, paddingTop: 17, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: '#172338', fontSize: 14, fontWeight: '800' },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#f1f4f6' },
  list: { gap: 6, paddingBottom: 4 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, borderWidth: 1, borderColor: '#e7edef', borderRadius: 12 },
  optionActive: { borderColor: '#9fdcc5', backgroundColor: '#effbf5' },
  optionText: { flex: 1, paddingVertical: 9 },
  label: { color: '#26372e', fontSize: 14, fontWeight: '700' },
  labelActive: { color: '#07795a' },
  hint: { marginTop: 2, color: '#7a899b', fontSize: 11 },
});
