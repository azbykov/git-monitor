const HOUR = 3_600_000;

/** Рабочие часы между двумя моментами: суббота и воскресенье (UTC) не считаются. */
export function workingHoursBetween(fromIso: string, to: number = Date.now()): number {
  let t = new Date(fromIso).getTime();
  let hours = 0;
  while (t < to) {
    const next = Math.min(t + HOUR, to);
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) hours += (next - t) / HOUR;
    t = next;
  }
  return hours;
}

/** SLA на ревью в рабочих часах. По умолчанию — 2 рабочих дня. */
export function reviewSlaHours(): number {
  const v = Number(process.env.REVIEW_SLA_HOURS);
  return Number.isFinite(v) && v > 0 ? v : 48;
}

/** «5 ч», «2,5 дн» */
export function formatHours(h: number): string {
  if (h < 24) return `${Math.max(1, Math.round(h))} ч`;
  const days = h / 24 >= 10 ? Math.round(h / 24) : Math.round((h / 24) * 10) / 10; // 2,5 дн, но 194 дн
  return `${days.toLocaleString("ru")} дн`;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.toSorted((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
