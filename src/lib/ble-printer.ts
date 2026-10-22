import { PermissionsAndroid, Platform } from 'react-native';
import BleManager, { type Characteristic, type Peripheral } from 'react-native-ble-manager';
import { cancelPrinterRelease, schedulePrinterRelease } from './printer-release';

/** A BLE printer found by scanning; `id` is what BleManager connects to (the MAC address on Android). */
export type BlePrinter = { id: string; name: string; rssi: number };

/**
 * Write characteristics used by common 58 mm ESC/POS printers (PRJ-58D and similar), most specific first.
 * Printers that use something else still work: any writable characteristic outside the standard GATT services is tried next.
 */
const KNOWN_WRITE_CHARACTERISTICS = [
  { service: '000018f0-0000-1000-8000-00805f9b34fb', characteristic: '00002af1-0000-1000-8000-00805f9b34fb' },
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', characteristic: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
  { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', characteristic: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
  { service: '0000ff00-0000-1000-8000-00805f9b34fb', characteristic: '0000ff02-0000-1000-8000-00805f9b34fb' },
];
/** Generic Access / Generic Attribute / Device Information never carry print data. */
const STANDARD_SERVICES = new Set(['1800', '1801', '180a']);
const PRINTER_NAME = /printer|thermal|pos|receipt|prj|rpp|mtp|xp[- ]|pt[- ]|58|80/i;
/** Below the 20-byte default payload most cheap printers accept even when the MTU request is ignored. */
const SAFE_CHUNK = 20;

const shortUuid = (uuid: string) => {
  const lower = uuid.toLowerCase();
  return /^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/.test(lower) ? lower.slice(4, 8) : lower;
};
const sameUuid = (a: string, b: string) => shortUuid(a) === shortUuid(b);

let started: Promise<void> | null = null;
/** Resolved write targets per printer, so the services are only walked on the first print. */
const writeTargets = new Map<string, { service: string; characteristic: string; withoutResponse: boolean; chunk: number }>();

async function ensureBleAccess() {
  if (Platform.OS !== 'android') throw new Error('Cetak Bluetooth tersedia di Android.');
  const permissions = Number(Platform.Version) >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    // Before Android 12, finding BLE devices requires location permission.
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const results = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some((permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error(Number(Platform.Version) >= 31 ? 'Izin Bluetooth belum diberikan.' : 'Izin lokasi diperlukan Android untuk mencari printer BLE.');
  }
  started ??= BleManager.start({ showAlert: false }).catch(() => { started = null; throw new Error('Bluetooth tidak dapat dimulai. Tutup lalu buka lagi aplikasinya.'); });
  await started;
  if ((await BleManager.checkState()) !== 'on') {
    try { await BleManager.enableBluetooth(); } catch { throw new Error('Aktifkan Bluetooth untuk mencetak nota.'); }
  }
}

/**
 * Scans for BLE devices for a few seconds. `onFound` receives the growing list (printers first), so the picker fills in live;
 * the promise resolves with the final list when the scan stops.
 */
export async function scanBlePrinters(onFound: (printers: BlePrinter[]) => void, seconds = 6): Promise<BlePrinter[]> {
  await ensureBleAccess();
  const found = new Map<string, BlePrinter>();
  const sorted = () => [...found.values()].sort((a, b) => Number(PRINTER_NAME.test(b.name)) - Number(PRINTER_NAME.test(a.name)) || b.rssi - a.rssi);
  return new Promise<BlePrinter[]>((resolve, reject) => {
    const discover = BleManager.onDiscoverPeripheral((peripheral: Peripheral) => {
      const name = peripheral.name || peripheral.advertising.localName;
      // Unnamed advertisers are almost never printers and would bury the real ones.
      if (!name) return;
      found.set(peripheral.id, { id: peripheral.id, name, rssi: peripheral.rssi });
      onFound(sorted());
    });
    const stop = BleManager.onStopScan(() => {
      discover.remove();
      stop.remove();
      resolve(sorted());
    });
    BleManager.scan({ seconds }).catch(() => {
      discover.remove();
      stop.remove();
      reject(new Error('Gagal mencari printer BLE. Pastikan Bluetooth dan lokasi menyala lalu coba lagi.'));
    });
  });
}

export function stopBleScan() {
  void BleManager.stopScan().catch(() => undefined);
}

function pickWriteTarget(characteristics: Characteristic[]) {
  const writable = characteristics.filter((entry) => entry.properties.WriteWithoutResponse || entry.properties.Write);
  const known = KNOWN_WRITE_CHARACTERISTICS
    .map((target) => writable.find((entry) => sameUuid(entry.service, target.service) && sameUuid(entry.characteristic, target.characteristic)))
    .find(Boolean);
  return known ?? writable.find((entry) => !STANDARD_SERVICES.has(shortUuid(entry.service)));
}

async function connectedTarget(printerId: string, printerName: string) {
  if (!(await BleManager.isPeripheralConnected(printerId))) {
    try { await BleManager.connect(printerId); } catch { throw new Error(`Gagal tersambung ke ${printerName}. Pastikan printer menyala dan dekat.`); }
    // A fresh connection may come with a different MTU, so the write target is resolved again.
    writeTargets.delete(printerId);
  }
  const cached = writeTargets.get(printerId);
  if (cached) return cached;
  let chunk = SAFE_CHUNK;
  try {
    // 3 bytes of every packet are ATT overhead; stay a little under what the printer granted.
    const mtu = await BleManager.requestMTU(printerId, 185);
    chunk = Math.max(SAFE_CHUNK, Math.min(mtu - 3, 180));
  } catch { /* Keep 20-byte packets when the printer refuses a larger MTU. */ }
  const info = await BleManager.retrieveServices(printerId);
  const target = pickWriteTarget(info.characteristics ?? []);
  if (!target) throw new Error(`${printerName} tidak punya jalur cetak BLE. Coba pilih printer ini di tab Bluetooth Classic.`);
  const resolved = { service: target.service, characteristic: target.characteristic, withoutResponse: Boolean(target.properties.WriteWithoutResponse), chunk };
  writeTargets.set(printerId, resolved);
  return resolved;
}

/** Sends raw ESC/POS bytes to a BLE printer in MTU-sized packets. */
export async function writeBlePrinter(printerId: string, printerName: string, bytes: number[]) {
  await ensureBleAccess();
  cancelPrinterRelease(printerId);
  try {
    try { await writeBle(printerId, printerName, bytes); }
    catch {
      // A power-cycled printer can leave a stale connection behind: drop it and try once on a fresh one.
      await disconnectBle(printerId);
      await writeBle(printerId, printerName, bytes);
    }
  } catch (error) {
    await disconnectBle(printerId);
    throw error;
  }
  // Release the printer after each job so other cashier phones can connect to it, once it has received the whole receipt.
  schedulePrinterRelease(printerId, bytes.length, disconnectBle);
}

async function writeBle(printerId: string, printerName: string, bytes: number[]) {
  const target = await connectedTarget(printerId, printerName);
  try {
    // Without-response writes are fast but can overrun a small printer buffer; the short pause between packets prevents that.
    if (target.withoutResponse) await BleManager.writeWithoutResponse(printerId, target.service, target.characteristic, bytes, target.chunk, 20);
    else await BleManager.write(printerId, target.service, target.characteristic, bytes, target.chunk);
  } catch {
    writeTargets.delete(printerId);
    throw new Error('Printer tidak menerima nota lewat BLE. Periksa koneksi lalu coba lagi.');
  }
}

async function disconnectBle(printerId: string) {
  writeTargets.delete(printerId);
  try { if (await BleManager.isPeripheralConnected(printerId)) await BleManager.disconnect(printerId); } catch { /* Already gone. */ }
}
