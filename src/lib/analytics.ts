import type { HistoricalPr } from "./history";
import { median, workingHoursBetween } from "./time";

const DAY = 86_400_000;

function mondayOf(iso: string | number) {
  const d = new Date(iso);
  const shift = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - shift);
}

/** Периоды аналитики: ключ — для URL (?period=), days — сколько истории грузить. */
export const PERIODS = [
  { key: "30d", days: 30, label: "30 дней", short: "30 дн" },
  { key: "90d", days: 90, label: "90 дней", short: "90 дн" },
  { key: "6m", days: 182, label: "6 месяцев", short: "6 мес" },
  { key: "1y", days: 365, label: "Год", short: "год" },
] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = PERIODS[1];

export const periodFrom = (key: unknown): Period => PERIODS.find((p) => p.key === key) ?? DEFAULT_PERIOD;

export type TimePoint = { label: string; opened: number; merged: number };

function countInto(prs: HistoricalPr[], bucketOf: (iso: string) => { opened: number; merged: number } | undefined) {
  for (const pr of prs) {
    const o = bucketOf(pr.createdAt);
    if (o) o.opened++;
    if (pr.mergedAt) {
      const m = bucketOf(pr.mergedAt);
      if (m) m.merged++;
    }
  }
}

/** Сколько PR я открыл и сколько смержил по неделям. */
export function weekly(prs: HistoricalPr[], weeks = 13, now = Date.now()): TimePoint[] {
  const start = mondayOf(now) - (weeks - 1) * 7 * DAY;
  const points = Array.from({ length: weeks }, (_, i) => ({ ts: start + i * 7 * DAY, opened: 0, merged: 0 }));
  countInto(prs, (iso) => points[Math.round((mondayOf(iso) - start) / (7 * DAY))]);
  return points.map(({ ts, opened, merged }) => ({
    label: new Date(ts).toLocaleDateString("ru", { day: "numeric", month: "short", timeZone: "UTC" }),
    opened,
    merged,
  }));
}

/** То же по календарным месяцам (UTC), включая текущий. */
export function monthly(prs: HistoricalPr[], months = 12, now = Date.now()): TimePoint[] {
  const d = new Date(now);
  const index = (iso: string) => {
    const t = new Date(iso);
    return (t.getUTCFullYear() - d.getUTCFullYear()) * 12 + t.getUTCMonth() - d.getUTCMonth() + months - 1;
  };
  const points = Array.from({ length: months }, (_, i) => ({
    ts: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (months - 1 - i), 1),
    opened: 0,
    merged: 0,
  }));
  countInto(prs, (iso) => points[index(iso)]);
  return points.map(({ ts, opened, merged }) => ({
    label: new Date(ts).toLocaleDateString("ru", { month: "short", timeZone: "UTC" }),
    opened,
    merged,
  }));
}

/** Шкала под период: до 90 дней — недели, дальше — месяцы (иначе 26–52 узких столбика). */
export function timeline(prs: HistoricalPr[], period: Period): { unit: "week" | "month"; points: TimePoint[] } {
  return period.days <= 90
    ? { unit: "week", points: weekly(prs, Math.ceil(period.days / 7)) }
    : { unit: "month", points: monthly(prs, Math.round(period.days / 30.4)) };
}

export const ttfr = (pr: HistoricalPr) =>
  pr.firstReview ? workingHoursBetween(pr.readyAt, new Date(pr.firstReview.at).getTime()) : null;

/** До мержа было хотя бы одно ревью от других людей. */
export const reviewedBeforeMerge = (pr: HistoricalPr) =>
  Boolean(pr.mergedAt && pr.reviewers.some((r) => r.at <= pr.mergedAt!));

/**
 * Время до мержа — только для PR, прошедших ревью. PR, смерженные без ревью (свои репозитории, хотфиксы),
 * мержатся за минуты и иначе тянули бы все медианы вниз; их долю показывает reviewRate.
 */
export const ttm = (pr: HistoricalPr) =>
  reviewedBeforeMerge(pr) ? workingHoursBetween(pr.readyAt, new Date(pr.mergedAt!).getTime()) : null;

const nums = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null);

export type RepoStat = { repo: string; prs: number; medianTtfr: number | null; medianTtm: number | null };

export function byRepo(prs: HistoricalPr[]): RepoStat[] {
  return [...Map.groupBy(prs, (p) => p.repo)]
    .map(([repo, items]) => ({
      repo,
      prs: items.length,
      medianTtfr: median(nums(items.map(ttfr))),
      medianTtm: median(nums(items.map(ttm))),
    }))
    .sort((a, b) => (b.medianTtfr ?? -1) - (a.medianTtfr ?? -1));
}

export const SIZES = [
  { label: "S", hint: "< 50 строк", max: 50 },
  { label: "M", hint: "50–250", max: 250 },
  { label: "L", hint: "250–1000", max: 1000 },
  { label: "XL", hint: "> 1000", max: Infinity },
] as const;

export type SizeStat = {
  label: string;
  hint: string;
  prs: number;
  medianTtfr: number | null;
  medianTtm: number | null;
};

/** Как размер PR влияет на скорость: медианы до первого ревью и до мержа по группам S/M/L/XL. */
export function bySize(prs: HistoricalPr[]): SizeStat[] {
  return SIZES.map((s, i) => {
    const min = i === 0 ? 0 : SIZES[i - 1].max;
    const items = prs.filter((p) => p.size >= min && p.size < s.max);
    return {
      label: s.label,
      hint: s.hint,
      prs: items.length,
      medianTtfr: median(nums(items.map(ttfr))),
      medianTtm: median(nums(items.map(ttm))),
    };
  });
}

/** Точка для диаграммы «размер ↔ скорость»: один PR. Время — в рабочих часах, null — ещё не было. */
export type SizeSpeedPoint = {
  url: string;
  title: string;
  repo: string;
  number: number;
  size: number;
  ttfr: number | null;
  ttm: number | null;
};

export function sizeVsSpeed(prs: HistoricalPr[]): SizeSpeedPoint[] {
  return prs.map((p) => ({
    url: p.url,
    title: p.title,
    repo: p.repo.split("/")[1],
    number: p.number,
    size: p.size,
    ttfr: ttfr(p),
    ttm: ttm(p),
  }));
}

export type ReviewerStat = { login: string; prs: number; firstResponder: number; medianResponse: number | null };

/** Кто ревьюит мои PR и как быстро отвечает первым. */
export function reviewers(prs: HistoricalPr[]): ReviewerStat[] {
  const stats = new Map<string, { prs: Set<string>; times: number[] }>();
  for (const pr of prs) {
    for (const r of pr.reviewers) {
      const s = stats.get(r.author) ?? { prs: new Set(), times: [] };
      s.prs.add(pr.url);
      stats.set(r.author, s);
    }
    if (pr.firstReview) stats.get(pr.firstReview.author)?.times.push(ttfr(pr)!);
  }
  return [...stats]
    .map(([login, s]) => ({
      login,
      prs: s.prs.size,
      firstResponder: s.times.length,
      medianResponse: median(s.times),
    }))
    .sort((a, b) => b.prs - a.prs);
}

export function summary(prs: HistoricalPr[]) {
  return {
    total: prs.length,
    merged: prs.filter((p) => p.state === "MERGED").length,
    medianTtfr: median(nums(prs.map(ttfr))),
    medianTtm: median(nums(prs.map(ttm))),
  };
}

/**
 * Этапы цикла PR (как у Swarmia), в рабочих часах, только для смерженных после ревью:
 * — в работе: от открытия до запроса ревью;
 * — в ревью: от запроса ревью до последнего одобрения (без одобрения — до мержа);
 * — до мержа: от последнего одобрения до мержа.
 */
export type Stages = { progress: number; review: number; merge: number };

export function stagesOf(pr: HistoricalPr): Stages | null {
  if (!reviewedBeforeMerge(pr)) return null; // без ревью этапов «в ревью» и «до мержа» нет
  if (!pr.mergedAt) return null;
  const merged = new Date(pr.mergedAt).getTime();
  const requested = Math.min(new Date(pr.reviewRequestedAt).getTime(), merged);
  const approved = pr.lastApprovalAt ? Math.max(requested, new Date(pr.lastApprovalAt).getTime()) : merged;
  return {
    progress: workingHoursBetween(pr.createdAt, requested),
    review: workingHoursBetween(new Date(requested).toISOString(), approved),
    merge: workingHoursBetween(new Date(approved).toISOString(), merged),
  };
}

export type StageRow = { name: string; prs: number } & Stages;

/** Медианы этапов: «Все PR» + репозитории с наибольшим числом смерженных PR. */
export function stageBreakdown(prs: HistoricalPr[], topRepos = 6): StageRow[] {
  const row = (name: string, items: HistoricalPr[]): StageRow | null => {
    const s = items.map(stagesOf).filter((x): x is Stages => x !== null);
    if (!s.length) return null;
    return {
      name,
      prs: s.length,
      progress: median(s.map((x) => x.progress)) ?? 0,
      review: median(s.map((x) => x.review)) ?? 0,
      merge: median(s.map((x) => x.merge)) ?? 0,
    };
  };
  const repos = [...Map.groupBy(prs, (p) => p.repo)]
    .map(([repo, items]) => row(repo.split("/")[1], items))
    .filter((r): r is StageRow => r !== null)
    .sort((a, b) => b.prs - a.prs)
    .slice(0, topRepos);
  const all = row("Все PR", prs);
  return all ? [all, ...repos] : repos;
}

/** Доля смерженных PR, в которых до мержа не было ни одного ревью от других людей. */
export function reviewRate(prs: HistoricalPr[]) {
  const merged = prs.filter((p) => p.mergedAt);
  const unreviewed = merged.filter((p) => !reviewedBeforeMerge(p)).length;
  return { merged: merged.length, unreviewed, share: merged.length ? unreviewed / merged.length : 0 };
}

/** Оценка времени цикла по порогам Swarmia: < 24 ч — отлично, < 5 рабочих дней — хорошо. */
export function cycleTier(hours: number | null): { label: string; tone: "good" | "ok" | "bad" } | null {
  if (hours === null) return null;
  if (hours < 24) return { label: "отлично", tone: "good" };
  if (hours < 5 * 24) return { label: "хорошо", tone: "ok" };
  return { label: "требует внимания", tone: "bad" };
}
