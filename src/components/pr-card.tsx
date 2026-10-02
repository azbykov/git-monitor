import type { PullRequest } from "@/lib/github";
import { criteriaOf, problemsOf, staleReview } from "@/lib/attention";
import { CriterionChip } from "./criterion-chip";
import { formatHours } from "@/lib/time";

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
function ago(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const hours = Math.round(diff / 3_600_000);
  return Math.abs(hours) < 24 ? rtf.format(hours, "hour") : rtf.format(Math.round(hours / 24), "day");
}

function snippet(text: string, max = 160) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
}

export function PrCard({ pr }: { pr: PullRequest }) {
  const problems = problemsOf(pr);
  const criteria = criteriaOf(pr);
  const allGreen = criteria.every((c) => c.key === "size" || c.status === "ok" || c.status === "none");
  const accent =
    problems.length > 0 ? "border-l-red-500" : allGreen ? "border-l-emerald-500" : "border-l-amber-400";
  const reviewWaiting = criteria.find((c) => c.key === "review")?.status === "wait";

  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border border-l-4 border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${accent}`}
    >
      <header>
        <div className="mb-1 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <a href={`https://github.com/${pr.repo}/pulls`} target="_blank" rel="noreferrer" className="hover:underline">
            {pr.repo.split("/")[1]}
          </a>
          <span>#{pr.number}</span>
          <span className="ml-auto">{ago(pr.updatedAt)}</span>
        </div>
        <a href={pr.url} target="_blank" rel="noreferrer" className="font-medium leading-snug hover:underline">
          {pr.title}
        </a>
      </header>

      <ul className="flex flex-wrap gap-1.5" aria-label="Состояние PR">
        {criteria.map((c) => (
          <CriterionChip key={c.key} c={c} />
        ))}
      </ul>

      {problems.includes("checks") && (
        <Block tone="red" title={`Упали чекеры${pr.checks.failed.length ? ` (${pr.checks.failed.length})` : ""}`}>
          <ul className="space-y-0.5">
            {pr.checks.failed.map((c) => (
              <li key={c.name} className="truncate">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
                    ✗ {c.name}
                  </a>
                ) : (
                  <>✗ {c.name}</>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {problems.includes("conflicts") && (
        <Block tone="orange" title="Конфликт с базовой веткой">
          <span className="font-mono">
            {pr.headRef} → {pr.baseRef}
          </span>
        </Block>
      )}

      {problems.includes("comments") && (
        <Block tone="amber" title={commentsTitle(pr)}>
          <ul className="space-y-2">
            {pr.threadsAwaitingMe.slice(0, 3).map((t) => (
              <li key={t.url}>
                <a href={t.url} target="_blank" rel="noreferrer" className="block hover:underline">
                  <span className="font-medium">@{t.author}</span>{" "}
                  <span className="font-mono opacity-70">{t.path.split("/").pop()}</span>
                  <span className="block opacity-80">{snippet(t.body)}</span>
                </a>
              </li>
            ))}
            {pr.threadsAwaitingMe.length > 3 && (
              <li>
                <a href={`${pr.url}/files`} target="_blank" rel="noreferrer" className="hover:underline">
                  ещё {pr.threadsAwaitingMe.length - 3} →
                </a>
              </li>
            )}
          </ul>
        </Block>
      )}

      {problems.includes("stale") && <StaleBlock pr={pr} />}

      {reviewWaiting && pr.requestedReviewers.length > 0 && (
        <p className="text-xs text-zinc-500">Ждём: {pr.requestedReviewers.map((r) => "@" + r).join(", ")}</p>
      )}
    </article>
  );
}

function commentsTitle(pr: PullRequest) {
  const parts = [];
  if (pr.threadsAwaitingMe.length) parts.push(`${pr.threadsAwaitingMe.length} без ответа`);
  if (pr.changesRequestedBy.length) parts.push(`правки просит ${pr.changesRequestedBy.map((l) => "@" + l).join(", ")}`);
  return `Замечания: ${parts.join(" · ")}`;
}

function StaleBlock({ pr }: { pr: PullRequest }) {
  const stale = staleReview(pr)!;
  const who = pr.requestedReviewers.map((r) => "@" + r).join(", ");
  return (
    <Block
      tone="violet"
      title={`${stale.kind === "no-review" ? "Без ревью" : "Ревьюер не отвечает"} ${formatHours(stale.hours)} (раб.)`}
    >
      {stale.kind === "no-review"
        ? who
          ? `Ждём: ${who} — стоит пнуть`
          : "Ревьюеры не назначены — назначьте кого-нибудь"
        : "Вы ответили на замечания, ответа пока нет — напомните ревьюеру"}
    </Block>
  );
}

const TONES = {
  red: "border-red-500/30 bg-red-500/5 [&>h3]:text-red-600 dark:[&>h3]:text-red-400",
  orange: "border-orange-500/30 bg-orange-500/5 [&>h3]:text-orange-600 dark:[&>h3]:text-orange-400",
  amber: "border-amber-500/30 bg-amber-500/5 [&>h3]:text-amber-700 dark:[&>h3]:text-amber-400",
  violet: "border-violet-500/30 bg-violet-500/5 [&>h3]:text-violet-700 dark:[&>h3]:text-violet-400",
} as const;

function Block({ tone, title, children }: { tone: keyof typeof TONES; title: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-lg border p-2.5 text-xs ${TONES[tone]}`}>
      <h3 className="mb-1 font-semibold">{title}</h3>
      {children}
    </section>
  );
}
