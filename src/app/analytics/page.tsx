import { Suspense } from "react";
import type { Metadata } from "next";
import { getMyOpenPullRequests, type PullRequest } from "@/lib/github";
import { getMyPrHistory, type HistoricalPr } from "@/lib/history";
import type { Fetched } from "@/lib/cache-tags";
import Link from "next/link";
import {
  PERIODS,
  byRepo,
  bySize,
  cycleTier,
  periodFrom,
  reviewRate,
  reviewers,
  sizeVsSpeed,
  stageBreakdown,
  summary,
  timeline,
  type Period,
} from "@/lib/analytics";
import { SizeSpeedChart } from "@/components/size-speed-chart";
import { QUIET_BUCKETS, bucketOf, staleReview, type Bucket } from "@/lib/attention";
import { formatHours, reviewSlaHours } from "@/lib/time";
import { Columns, HBars, Legend, type Series } from "@/components/charts";
import { getSelectedOrg } from "@/lib/org";
import { requireSession } from "@/lib/session";
import { GithubError } from "@/components/github-error";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Аналитика · Git Monitor" };

export default function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold">Аналитика</h1>
      <Suspense
        fallback={
          <p className="mt-6 text-zinc-500">
            Собираю историю PR… При первом открытии периода это занимает от 10 секунд (за год — до минуты), потом —
            из кэша.
          </p>
        }
      >
        <Analytics searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const WEEK_SERIES: Series[] = [
  { key: "opened", label: "Открыто", color: "var(--series-1)" },
  { key: "merged", label: "Смержено", color: "var(--series-2)" },
];

const BUCKET_SERIES: Array<Series & { key: Bucket }> = [
  { key: "action", label: "Требуют действий", color: "var(--status-critical)" },
  { key: "waiting", label: "Ждут других", color: "var(--status-warning)" },
  { key: "ready", label: "Готовы к мержу", color: "var(--status-good)" },
  { key: "draft", label: "Черновики", color: "var(--status-neutral)" },
];

const STAGE_SERIES: Series[] = [
  { key: "progress", label: "В работе", color: "var(--series-1)" },
  { key: "review", label: "В ревью", color: "var(--series-2)" },
  { key: "merge", label: "До мержа", color: "var(--series-3)" },
];

const one = (key: string, label: string): Series[] => [{ key, label, color: "var(--series-1)" }];

async function Analytics({ searchParams }: Pick<PageProps<"/analytics">, "searchParams">) {
  const period = periodFrom((await searchParams).period);
  const { sealed } = await requireSession();
  const org = await getSelectedOrg();

  let loaded: [Fetched<HistoricalPr>, Fetched<PullRequest>] | { error: unknown };
  try {
    loaded = await Promise.all([getMyPrHistory(sealed, org, period.days), getMyOpenPullRequests(sealed, org)]);
  } catch (error) {
    loaded = { error };
  }
  if ("error" in loaded) return <GithubError error={loaded.error} />;
  const [h, o] = loaded;
  if (h.unauthorized || o.unauthorized) return <GithubError unauthorized />;
  // PR от ботов и заброшенные не учитываем: они искажают метрики (как фильтр «Bots» у Swarmia)
  const history = h.items.filter((p) => !p.automated);
  const botPrs = h.items.length - history.length;
  const open = o.items.filter((pr) => !QUIET_BUCKETS.has(bucketOf(pr)));
  const fetchedAt = h.fetchedAt < o.fetchedAt ? h.fetchedAt : o.fetchedAt; // показываем самые старые данные

  const s = summary(history);
  const rate = reviewRate(history);
  const tier = cycleTier(s.medianTtm);
  const stages = stageBreakdown(history);
  const line = timeline(history, period);
  const stale = open.filter((pr) => staleReview(pr)).length;
  const repos = byRepo(history);
  const openByRepo = [...Map.groupBy(open, (pr) => pr.repo)]
    .map(([repo, items]) => {
      const count = (b: Bucket) => items.filter((pr) => bucketOf(pr) === b).length;
      return { repo: repo.split("/")[1], action: count("action"), waiting: count("waiting"), ready: count("ready"), draft: count("draft") };
    })
    .sort((a, b) => b.action - a.action || b.waiting - a.waiting);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker active={period} />
        <AutoRefresh fetchedAt={fetchedAt} seconds={600} />
      </div>
      <p className="text-sm text-zinc-500">
        Мои PR, созданные за {period.label.toLowerCase()} {org ? `в ${org}` : "во всех организациях"}. Время — в рабочих
        часах (без выходных), от ready for review.
        {botPrs > 0 && ` PR от ботов (${botPrs}) не учитываются.`}
        {h.items.length >= 1000 && " Показаны последние 1000 PR — больше поиск GitHub не отдаёт."}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Открыто сейчас" value={String(open.length)} />
        <Tile
          label={`Без ревью > ${formatHours(reviewSlaHours())}`}
          value={String(stale)}
          tone={stale ? "bad" : undefined}
        />
        <Tile label={`Смержено за ${period.short}`} value={`${s.merged}`} hint={`из ${s.total} созданных`} />
        <Tile label="Медиана до 1-го ревью" value={s.medianTtfr === null ? "—" : formatHours(s.medianTtfr)} />
        <Tile
          label="Медиана до мержа (с ревью)"
          value={s.medianTtm === null ? "—" : formatHours(s.medianTtm)}
          hint={tier ? tier.label : undefined}
          hintTone={tier?.tone}
        />
        <Tile
          label="Смержено без ревью"
          value={rate.merged ? `${Math.round(rate.share * 100)}%` : "—"}
          hint={`${rate.unreviewed} из ${rate.merged}`}
          tone={rate.share > 0.25 ? "bad" : undefined}
        />
      </div>

      <Card
        title="Где PR проводит время"
        subtitle="Медианы этапов для PR, смерженных после ревью, в рабочих часах. В работе — от открытия до запроса ревью; в ревью — до последнего одобрения; до мержа — от одобрения до мержа. Сумма медиан не равна медиане всего цикла."
        footer={<Legend series={STAGE_SERIES} />}
      >
        {stages.length ? (
          <HBars data={stages} y="name" series={STAGE_SERIES} unit="hours" mono={false} />
        ) : (
          <Empty>За этот период смерженных PR нет</Empty>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Открытые PR по репозиториям" footer={<Legend series={BUCKET_SERIES} />}>
          {openByRepo.length ? (
            <HBars data={openByRepo} y="repo" series={BUCKET_SERIES} />
          ) : (
            <Empty>Открытых PR нет</Empty>
          )}
        </Card>

        <Card
          title={`Открыто и смержено по ${line.unit === "week" ? "неделям" : "месяцам"}`}
          footer={<Legend series={WEEK_SERIES} />}
        >
          <Columns data={line.points} x="label" series={WEEK_SERIES} />
        </Card>

      </div>

      <Card
        title="Размер PR и скорость ревью"
        subtitle="Каждая точка — PR. Обе оси логарифмические. Наведите, чтобы увидеть PR, кликните — откроется на GitHub."
      >
        {history.length ? (
          <SizeSpeedChart points={sizeVsSpeed(history)} groups={bySize(history)} />
        ) : (
          <Empty>За этот период PR нет</Empty>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Сколько ждать первого ревью — по репозиториям" subtitle="медиана">
          {repos.some((r) => r.medianTtfr !== null) ? (
            <HBars
              data={repos.filter((r) => r.medianTtfr !== null).map((r) => ({ ...r, repo: r.repo.split("/")[1] }))}
              y="repo"
              series={one("medianTtfr", "До 1-го ревью")}
              unit="hours"
            />
          ) : (
            <Empty>Пока нет PR с ревью</Empty>
          )}
        </Card>

        <Card title="Кто ревьюит мои PR">
          <ReviewersTable rows={reviewers(history)} />
        </Card>
      </div>
    </div>
  );
}

function ReviewersTable({ rows }: { rows: ReturnType<typeof reviewers> }) {
  if (!rows.length) return <Empty>Ревью пока не было</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="py-1.5 pr-4 font-normal">Ревьюер</th>
            <th className="py-1.5 pr-4 text-right font-normal">PR отревьюил</th>
            <th className="py-1.5 pr-4 text-right font-normal">Был первым</th>
            <th className="py-1.5 text-right font-normal">Медиана первого ответа</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr key={r.login} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5 pr-4">
                <a href={`https://github.com/${r.login}`} target="_blank" rel="noreferrer" className="hover:underline">
                  @{r.login}
                </a>
              </td>
              <td className="py-1.5 pr-4 text-right">{r.prs}</td>
              <td className="py-1.5 pr-4 text-right">{r.firstResponder}</td>
              <td className="py-1.5 text-right">{r.medianResponse === null ? "—" : formatHours(r.medianResponse)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeriodPicker({ active }: { active: Period }) {
  return (
    <nav className="flex flex-wrap gap-2 text-sm" aria-label="Период">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={`/analytics?period=${p.key}`}
          aria-current={p.key === active.key ? "page" : undefined}
          className={`rounded-full border px-3 py-1 ${
            p.key === active.key
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          }`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

const HINT_TONE = { good: "text-emerald-600", ok: "text-amber-600", bad: "text-red-600" } as const;

function Tile(props: { label: string; value: string; hint?: string; tone?: "bad"; hintTone?: keyof typeof HINT_TONE }) {
  const { label, value, hint, tone, hintTone } = props;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 text-2xl font-semibold">
        {tone === "bad" && <span className="text-base text-red-600" aria-label="внимание">⚠︎</span>}
        {value}
      </div>
      {hint && <div className={`text-xs ${hintTone ? HINT_TONE[hintTone] : "text-zinc-500"}`}>{hint}</div>}
    </div>
  );
}

function Card(props: { title: string; subtitle?: string; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">{props.title}</h2>
      {props.subtitle && <p className="text-xs text-zinc-500">{props.subtitle}</p>}
      <div className="mt-4">{props.children}</div>
      {props.footer && <div className="mt-4">{props.footer}</div>}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-zinc-500">{children}</p>;
}
