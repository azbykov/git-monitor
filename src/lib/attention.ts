import type { PullRequest } from "./github";
import { formatHours, reviewSlaHours, workingHoursBetween } from "./time";
import { OLD_PR_DAYS } from "./automation";

export type Problem = "checks" | "conflicts" | "comments" | "stale";

export type Bucket = "action" | "waiting" | "ready" | "draft" | "old" | "bots";

export const BUCKETS: Record<Bucket, string> = {
  action: "Требуют моих действий",
  waiting: "Ждут других",
  ready: "Готовы к мержу",
  draft: "Черновики",
  old: `Без активности > ${OLD_PR_DAYS} дней — закрыть или оживить?`,
  bots: "От ботов",
};

/** Секции, которые по умолчанию свёрнуты и не попадают в счётчики проблем — это шум. */
export const QUIET_BUCKETS: ReadonlySet<Bucket> = new Set(["old", "bots"]);

const isOld = (pr: PullRequest, now = Date.now()) => now - new Date(pr.updatedAt).getTime() > OLD_PR_DAYS * 86_400_000;

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
  if (pr.automated) return "bots";
  if (isOld(pr)) return "old";
  if (pr.isDraft) return "draft";
  if (problemsOf(pr).length > 0) return "action";
  // Готов: CI зелёный (или его нет), конфликтов нет, ревью одобрено, замечаний без ответа нет.
  // Размер — подсказка, а не блокер.
  const c = Object.fromEntries(criteriaOf(pr).map((x) => [x.key, x.status]));
  const ready = c.ci !== "bad" && c.ci !== "wait" && c.conflicts === "ok" && c.review === "ok" && c.comments !== "bad";
  return ready ? "ready" : "waiting";
}

/** Состояние одного критерия: ок / ждём / проблема / нейтрально (нет данных, черновик). */
export type CriterionStatus = "ok" | "wait" | "bad" | "none";
export type Criterion = {
  key: "ci" | "conflicts" | "review" | "comments" | "size";
  status: CriterionStatus;
  label: string;
  /** Подсказка при наведении */
  hint?: string;
};

/** Большие PR дольше ревьюят — поэтому подсвечиваем размер, но мерж он не блокирует. */
const SIZE_WARN = 400;
const SIZE_BAD = 1000;

/**
 * Фиксированный набор критериев для каждого PR — как блок мержа у GitHub или колонки в gh-dash:
 * зелёное тоже показываем, чтобы сразу было видно, что уже в порядке.
 */
export function criteriaOf(pr: PullRequest, now = Date.now()): Criterion[] {
  const failed = pr.checks.failed;
  const ci: Criterion =
    pr.checks.state === "success"
      ? { key: "ci", status: "ok", label: "CI" }
      : pr.checks.state === "pending"
        ? { key: "ci", status: "wait", label: "CI идёт" }
        : pr.checks.state === "failure"
          ? {
              key: "ci",
              status: "bad",
              label: failed.length ? `CI · ${failed[0].name}${failed.length > 1 ? ` +${failed.length - 1}` : ""}` : "CI упал",
              hint: failed.map((c) => c.name).join(", "),
            }
          : { key: "ci", status: "none", label: "Нет CI" };

  const conflicts: Criterion =
    pr.mergeable === "MERGEABLE"
      ? { key: "conflicts", status: "ok", label: "Без конфликтов" }
      : pr.mergeable === "CONFLICTING"
        ? { key: "conflicts", status: "bad", label: "Конфликт", hint: `${pr.headRef} → ${pr.baseRef}` }
        : { key: "conflicts", status: "wait", label: "Конфликты проверяются" };

  // «одобрили / всего ревьюеров»: нужное число одобрений GitHub отдаёт только с доступом к защите ветки
  const total = new Set([...pr.approvedBy, ...pr.changesRequestedBy, ...pr.requestedReviewers]).size;
  const ratio = total ? ` · ${pr.approvedBy.length}/${total}` : "";
  const stale = staleReview(pr, now);
  const waited = formatHours(workingHoursBetween(pr.readyAt, now));
  const review: Criterion = pr.isDraft
    ? { key: "review", status: "none", label: "Черновик" }
    : pr.changesRequestedBy.length
      ? { key: "review", status: "bad", label: "Просят правки", hint: pr.changesRequestedBy.map((l) => "@" + l).join(", ") }
      : pr.approvedBy.length
        ? { key: "review", status: "ok", label: `Одобрено${ratio}`, hint: pr.approvedBy.map((l) => "@" + l).join(", ") }
        : stale?.kind === "no-review"
          ? { key: "review", status: "bad", label: `Без ревью · ${waited}`, hint: "Дольше SLA, в рабочих часах" }
          : pr.hasReviewFromOthers
            ? // ревью уже было (например, комментарии без вердикта) — срок с момента ready тут ничего не значит
              { key: "review", status: "wait", label: `Ждёт одобрения${ratio}` }
            : { key: "review", status: "wait", label: `Ждёт ревью${ratio} · ${waited}`, hint: "В рабочих часах" };

  const comments: Criterion = pr.threadsAwaitingMe.length
    ? { key: "comments", status: "bad", label: `${pr.threadsAwaitingMe.length} без ответа` }
    : stale?.kind === "no-reply"
      ? { key: "comments", status: "bad", label: `Ревьюер молчит · ${formatHours(stale.hours)}` }
      : pr.threadsAwaitingOthers
        ? { key: "comments", status: "wait", label: `Ждём ответа · ${pr.threadsAwaitingOthers}` }
        : { key: "comments", status: "ok", label: "Замечаний нет" };

  const lines = pr.additions + pr.deletions;
  const size: Criterion = {
    key: "size",
    status: lines > SIZE_BAD ? "bad" : lines > SIZE_WARN ? "wait" : "ok",
    label: `${lines.toLocaleString("ru")} строк`,
    hint: `+${pr.additions} −${pr.deletions}`,
  };

  return [ci, conflicts, review, comments, size];
}
