export type RangePreset = 'today' | '7days' | '30days' | 'month';

export const rangeOptions: { id: RangePreset; label: string; days?: number }[] = [
  { id: 'today', label: 'Hari ini', days: 1 }, { id: '7days', label: '7 hari', days: 7 },
  { id: '30days', label: '30 hari', days: 30 }, { id: 'month', label: 'Bulan ini' },
];

export function jakartaDate() {
  return new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date());
}

/** Inclusive YYYY-MM-DD range in Asia/Jakarta for a preset, ending today. */
export function getRange(preset: RangePreset) {
  const to = jakartaDate();
  const start = new Date(`${to}T00:00:00.000Z`);
  if (preset === 'month') start.setUTCDate(1);
  else start.setUTCDate(start.getUTCDate() - (rangeOptions.find((item) => item.id === preset)?.days ?? 1) + 1);
  return { from: start.toISOString().slice(0, 10), to };
}

export function rangeLabel(preset: RangePreset) {
  return rangeOptions.find((item) => item.id === preset)?.label ?? 'Hari ini';
}
