import type { PullRequest } from "./github";
import { reviewSlaHours, workingHoursBetween } from "./time";

export type Problem = "checks" | "conflicts" | "comments" | "stale";

export type Bucket = "action" | "waiting" | "ready" | "draft";

export const BUCKETS: Record<Bucket, string> = {
  action: "Требуют моих действий",
  waiting: "Ждут других",
  ready: "Готовы к мержу",
  draft: "Черновики",
};

export const PROBLEMS: Record<Problem, string> = {
  checks: "Падают чекеры",
  conflicts: "Конфликты",
  comments: "Замечания",
  stale: "Долго без ревью",
};

export type StaleReview = {
  kind: "no-review" | "no-reply";
  hours: number; // рабочие часы ожидания
};

/**
 * PR завис на ревью: либо его никто не смотрел дольше SLA,
 * либо я ответил на замечания, а ревьюер молчит дольше SLA.
 */
export function staleReview(pr: PullRequest, now = Date.now()): StaleReview | null {
  if (pr.isDraft) return null;
  const sla = reviewSlaHours();

  if (!pr.hasReviewFromOthers) {
    const hours = workingHoursBetween(pr.readyAt, now);
    return hours >= sla ? { kind: "no-review", hours } : null;
  }
  if (pr.oldestUnansweredReplyAt) {
    const hours = workingHoursBetween(pr.oldestUnansweredReplyAt, now);
    return hours >= sla ? { kind: "no-reply", hours } : null;
  }
  return null;
}

/** Что в PR требует моего вмешательства (для «долго без ревью» — пнуть ревьюеров). */
export function problemsOf(pr: PullRequest): Problem[] {
  const out: Problem[] = [];
  if (pr.checks.state === "failure") out.push("checks");
  if (pr.mergeable === "CONFLICTING") out.push("conflicts");
  if (pr.threadsAwaitingMe.length > 0 || pr.changesRequestedBy.length > 0) out.push("comments");
  if (staleReview(pr)) out.push("stale");
  return out;
}

export function bucketOf(pr: PullRequest): Bucket {
  if (pr.isDraft) return "draft";
  if (problemsOf(pr).length > 0) return "action";
  if (pr.approvedBy.length > 0 && pr.checks.state !== "pending") return "ready";
  return "waiting";
}

/** Чего ждём, если от меня ничего не нужно. */
export function waitingReason(pr: PullRequest): string | null {
  if (pr.checks.state === "pending") return "CI ещё идёт";
  if (pr.mergeable === "UNKNOWN") return "GitHub проверяет конфликты";
  if (pr.threadsAwaitingOthers > 0) return `Ответил на ${pr.threadsAwaitingOthers} замеч., ждём ревьюера`;
  if (pr.approvedBy.length === 0) return "Ждёт ревью";
  return null;
}
