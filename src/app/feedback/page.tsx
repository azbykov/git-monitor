import { Suspense } from "react";
import type { Metadata } from "next";
import { listReviewComments, type ReviewComment } from "@/lib/comments";
import { aiAnalysisEnabled, latestAnalysis, type FeedbackAnalysis, type FeedbackTheme } from "@/lib/feedback";
import { requireSession } from "@/lib/session";
import { HBars } from "@/components/charts";
import { ActionButton } from "./action-button";
import { analyzeAction, syncAction } from "./actions";
import { getSelectedOrg } from "@/lib/org";

export const metadata: Metadata = { title: "Замечания · Git Monitor" };

export default function FeedbackPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Что мне пишут на ревью</h1>
          <p className="max-w-2xl text-sm text-zinc-500">
            Замечания других людей к моим PR за полгода
            {aiAnalysisEnabled() && ", разобранные по темам. LLM только раскладывает замечания по темам — количество считается кодом"}
            .
          </p>
        </div>
        <div className="flex gap-2">
          <ActionButton action={syncAction} label="↻ Синхронизировать" pendingLabel="Тяну из GitHub…" />
          {aiAnalysisEnabled() && (
            <ActionButton action={analyzeAction} label="✨ Проанализировать" pendingLabel="Модель думает…" primary />
          )}
        </div>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Загружаю…</p>}>
        <Feedback />
      </Suspense>
    </main>
  );
}

async function Feedback() {
  const { user } = await requireSession();
  const org = await getSelectedOrg();

  let comments: ReviewComment[];
  let analysis: FeedbackAnalysis | null;
  try {
    [comments, analysis] = await Promise.all([
      listReviewComments(user.login, org),
      aiAnalysisEnabled() ? latestAnalysis(user.login, org) : null,
    ]);
  } catch (e) {
    return (
      <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600">
        {e instanceof Error ? e.message : String(e)}
      </p>
    );
  }

  if (comments.length === 0)
    return <Empty>В базе пока нет замечаний. Нажмите «Синхронизировать», чтобы загрузить их из GitHub.</Empty>;

  if (!analysis) return <RawFeedback comments={comments} />;

  const byId = new Map(comments.map((c) => [c.id, c]));
  const newSince = comments.filter((c) => c.createdAt > analysis.createdAt).length;
  const { themes, checklist, otherCount, noiseCount } = analysis.result;
  const date = (iso: string) => new Date(iso).toLocaleDateString("ru", { day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        Анализ от {date(analysis.createdAt)} · {analysis.commentsCount} замечаний с {date(analysis.periodFrom)} по{" "}
        {date(analysis.periodTo)} · модель {analysis.model} · без темы: {otherCount}, не замечания: {noiseCount}
        {newSince > 0 && <span className="text-amber-600"> · {newSince} новых после анализа</span>}
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">Чек-лист перед открытием PR</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {checklist.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 inline-block size-4 shrink-0 rounded border border-zinc-300 dark:border-zinc-700" />
                {item}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">Частые темы замечаний</h2>
          <div className="mt-4">
            <HBars
              data={themes.map((t) => ({ title: t.title, count: t.count }))}
              y="title"
              mono={false}
              series={[{ key: "count", label: "Замечаний", color: "var(--series-1)" }]}
            />
          </div>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {themes.map((t) => (
          <ThemeCard key={t.key} theme={t} comments={t.commentIds.map((id) => byId.get(id)).filter((c) => !!c)} />
        ))}
      </div>
    </div>
  );
}

function ThemeCard({ theme, comments }: { theme: FeedbackTheme; comments: ReviewComment[] }) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{theme.title}</h3>
        <span className="text-sm tabular-nums text-zinc-500">{theme.count}</span>
      </header>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{theme.description}</p>
      <p className="rounded-lg bg-emerald-500/5 p-2.5 text-sm">
        <span className="font-medium text-emerald-700 dark:text-emerald-400">Привычка: </span>
        {theme.advice}
      </p>
      {comments.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Примеры замечаний ({comments.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {comments.map((c) => (
              <li key={c.id}>
                <a href={c.url} target="_blank" rel="noreferrer" className="block rounded-md p-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <span className="font-medium">@{c.author}</span>{" "}
                  <span className="font-mono text-zinc-500">
                    {c.repo.split("/")[1]}#{c.prNumber}
                    {c.path && ` · ${c.path.split("/").pop()}`}
                  </span>
                  <span className="mt-0.5 line-clamp-3 block text-zinc-700 dark:text-zinc-300">{c.body}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

/** Без AI: кто и где пишет замечания + лента последних. */
function RawFeedback({ comments }: { comments: ReviewComment[] }) {
  const top = (key: (c: ReviewComment) => string) =>
    [...Map.groupBy(comments, key)]
      .map(([name, items]) => ({ name, count: items.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  const series = [{ key: "count", label: "Замечаний", color: "var(--series-1)" }];

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        {comments.length} замечаний от {new Set(comments.map((c) => c.author)).size} ревьюеров
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">Кто пишет больше всего</h2>
          <div className="mt-4">
            <HBars data={top((c) => "@" + c.author)} y="name" series={series} />
          </div>
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">В каких репозиториях</h2>
          <div className="mt-4">
            <HBars data={top((c) => c.repo.split("/")[1])} y="name" series={series} />
          </div>
        </section>
      </div>
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Последние замечания</h2>
        <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {comments.slice(0, 50).map((c) => (
            <li key={c.id}>
              <a href={c.url} target="_blank" rel="noreferrer" className="block py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <span className="font-medium">@{c.author}</span>{" "}
                <span className="font-mono text-xs text-zinc-500">
                  {c.repo.split("/")[1]}#{c.prNumber}
                  {c.path && ` · ${c.path.split("/").pop()}`}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-zinc-700 dark:text-zinc-300">{c.body}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {children}
    </p>
  );
}
