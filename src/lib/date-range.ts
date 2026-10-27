export type RangePreset = 'today' | '7days' | 'month';

export const rangeOptions: { id: RangePreset; label: string; days?: number }[] = [
  { id: 'today', label: 'Hari ini', days: 1 }, { id: '7days', label: '7 hari', days: 7 }, { id: 'month', label: 'Bulan ini' },
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

/** A from/to pair picked with the Custom filter (inclusive YYYY-MM-DD, Asia/Jakarta). */
export type CustomRange = { from: string; to: string };

/** YYYY-MM-DD of a picked calendar date (the date pickers return local midnight). */
export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a YYYY-MM-DD key, for the date pickers. */
export const fromDateKey = (value: string) => new Date(`${value}T00:00:00`);

/** "1 Okt - 2 Okt 2026", or a single day when from equals to. */
export function customRangeLabel(range: CustomRange) {
  const day = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
  const full = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return range.from === range.to ? full.format(fromDateKey(range.from)) : `${day.format(fromDateKey(range.from))} - ${full.format(fromDateKey(range.to))}`;
}
