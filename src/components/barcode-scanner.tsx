import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

export function BarcodeScanner({ visible, onClose, onScanned }: { visible: boolean; onClose: () => void; onScanned: (value: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.screen}>
      <View style={styles.header}><Text style={styles.title}>Scan barcode</Text><Pressable onPress={onClose}><Text style={styles.close}>Tutup</Text></Pressable></View>
      {!permission ? <ActivityIndicator color="#087f5b" /> : !permission.granted ? <View style={styles.permission}><Text style={styles.hint}>Akses kamera dibutuhkan untuk memindai barcode.</Text><Pressable onPress={() => void requestPermission()} style={styles.button}><Text style={styles.buttonText}>Izinkan kamera</Text></Pressable></View> : <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr'] }} onBarcodeScanned={locked ? undefined : ({ data }) => { setLocked(true); onScanned(data); }} />}
      <Text style={styles.hint}>Arahkan barcode produk ke dalam bingkai kamera.</Text>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#102019', paddingTop: 54, paddingHorizontal: 18 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }, title: { color: '#fff', fontSize: 20, fontWeight: '900' }, close: { color: '#b7ebd0', fontWeight: '800' }, camera: { flex: 1, borderRadius: 20, overflow: 'hidden' }, hint: { color: '#d2ded7', textAlign: 'center', marginVertical: 18, fontSize: 13 }, permission: { flex: 1, alignItems: 'center', justifyContent: 'center' }, button: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: '#087f5b' }, buttonText: { color: '#fff', fontWeight: '800' } });
