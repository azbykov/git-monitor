import type { HistoricalPr } from "./history";
import { median, workingHoursBetween } from "./time";

const DAY = 86_400_000;

function mondayOf(iso: string | number) {
  const d = new Date(iso);
  const shift = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - shift);
}

export type WeekPoint = { week: string; opened: number; merged: number };

/** Сколько PR я открыл и сколько смержил по неделям. */
export function weekly(prs: HistoricalPr[], weeks = 13, now = Date.now()): WeekPoint[] {
  const start = mondayOf(now) - (weeks - 1) * 7 * DAY;
  const points = Array.from({ length: weeks }, (_, i) => ({
    ts: start + i * 7 * DAY,
    opened: 0,
    merged: 0,
  }));
  const at = (iso: string) => points[Math.round((mondayOf(iso) - start) / (7 * DAY))];
  for (const pr of prs) {
    const o = at(pr.createdAt);
    if (o) o.opened++;
    if (pr.mergedAt) {
      const m = at(pr.mergedAt);
      if (m) m.merged++;
    }
  }
  return points.map(({ ts, opened, merged }) => ({
    week: new Date(ts).toLocaleDateString("ru", { day: "numeric", month: "short", timeZone: "UTC" }),
    opened,
    merged,
  }));
}

export const ttfr = (pr: HistoricalPr) =>
  pr.firstReview ? workingHoursBetween(pr.readyAt, new Date(pr.firstReview.at).getTime()) : null;

export const ttm = (pr: HistoricalPr) =>
  pr.mergedAt ? workingHoursBetween(pr.readyAt, new Date(pr.mergedAt).getTime()) : null;

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

export type SizeStat = { label: string; hint: string; prs: number; medianTtm: number | null };

/** Как размер PR влияет на время до мержа. */
export function bySize(prs: HistoricalPr[]): SizeStat[] {
  return SIZES.map((s, i) => {
    const min = i === 0 ? 0 : SIZES[i - 1].max;
    const items = prs.filter((p) => p.size >= min && p.size < s.max);
    return { label: s.label, hint: s.hint, prs: items.length, medianTtm: median(nums(items.map(ttm))) };
  });
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
