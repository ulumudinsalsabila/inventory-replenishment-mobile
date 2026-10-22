/**
 * A finished write only means the bytes reached the phone's Bluetooth stack, not the printer. Cheap thermal printers take
 * data about as fast as they print, so disconnecting right away drops the rest of the receipt (it stops printing halfway).
 * The connection is therefore released only after the printer has had time to drain the job.
 */

/** Rough worst-case intake of a 58 mm printer printing text: ~400 bytes per second, plus time to start and feed. */
const BASE_DRAIN_MS = 1500;
const DRAIN_MS_PER_BYTE = 3;
const MAX_DRAIN_MS = 20_000;

const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Keeps the connection for a new job: a release still pending from the previous job would cut this one off. */
export function cancelPrinterRelease(printerId: string) {
  const timer = releaseTimers.get(printerId);
  if (timer) clearTimeout(timer);
  releaseTimers.delete(printerId);
}

/** Disconnects once the printer has had time to receive `byteCount` bytes, without making the caller wait. */
export function schedulePrinterRelease(printerId: string, byteCount: number, disconnect: (printerId: string) => Promise<void>) {
  cancelPrinterRelease(printerId);
  const delay = Math.min(MAX_DRAIN_MS, BASE_DRAIN_MS + byteCount * DRAIN_MS_PER_BYTE);
  releaseTimers.set(printerId, setTimeout(() => {
    releaseTimers.delete(printerId);
    void disconnect(printerId);
  }, delay));
}
