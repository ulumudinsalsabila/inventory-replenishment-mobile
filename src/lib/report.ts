const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export const money = (value: string | number | null | undefined) => `Rp ${Math.round(Number(value ?? 0)).toLocaleString('id-ID')}`;
export const quantity = (value: string | number | null | undefined) => Number(value ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
export const percent = (value: number) => `${value.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

/** Compact axis label: 1.500.000 -> "1,5 jt", 250.000 -> "250 rb". */
export function compactMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (abs >= 1_000) return `${(value / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return value.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

/** Today in Asia/Jakarta as YYYY-MM-DD. */
export function jakartaToday() {
  return new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date());
}

export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000);
}

export function dateLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${shortMonthNames[month - 1]} ${year}`;
}

export function shortDateLabel(date: string) {
  const [, month, day] = date.split('-').map(Number);
  return `${day} ${shortMonthNames[month - 1]}`;
}

export function monthLabel(month: string) {
  const [year, value] = month.split('-').map(Number);
  return `${monthNames[value - 1]} ${year}`;
}

/** First and last day of a YYYY-MM month. */
export function monthRange(month: string) {
  const [year, value] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function recentMonths(count: number) {
  const [year, month] = jakartaToday().split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(Date.UTC(year, month - 1 - index, 1));
    return value.toISOString().slice(0, 7);
  });
}

export function percentChange(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}
