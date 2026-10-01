import { Suspense } from "react";
import type { Metadata } from "next";
import { getMyOpenPullRequests, type PullRequest } from "@/lib/github";
import { getMyPrHistory, type HistoricalPr } from "@/lib/history";
import type { Fetched } from "@/lib/cache-tags";
import { byRepo, bySize, reviewers, summary, weekly } from "@/lib/analytics";
import { bucketOf, staleReview, type Bucket } from "@/lib/attention";
import { formatHours, reviewSlaHours } from "@/lib/time";
import { Columns, HBars, Legend, type Series } from "@/components/charts";
import { getSelectedOrg } from "@/lib/org";
import { requireSession } from "@/lib/session";
import { GithubError } from "@/components/github-error";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Аналитика · Git Monitor" };

const DAYS = 90;

export default function AnalyticsPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold">Аналитика</h1>
      <Suspense fallback={<p className="mt-6 text-zinc-500">Собираю историю PR… первый раз это ~10 секунд</p>}>
        <Analytics />
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

const one = (key: string, label: string): Series[] => [{ key, label, color: "var(--series-1)" }];

async function Analytics() {
  const { sealed } = await requireSession();
  const org = await getSelectedOrg();

  let loaded: [Fetched<HistoricalPr>, Fetched<PullRequest>] | { error: unknown };
  try {
    loaded = await Promise.all([getMyPrHistory(sealed, org, DAYS), getMyOpenPullRequests(sealed, org)]);
  } catch (error) {
    loaded = { error };
  }
  if ("error" in loaded) return <GithubError error={loaded.error} />;
  const [h, o] = loaded;
  if (h.unauthorized || o.unauthorized) return <GithubError unauthorized />;
  const [history, open] = [h.items, o.items];
  const fetchedAt = h.fetchedAt < o.fetchedAt ? h.fetchedAt : o.fetchedAt; // показываем самые старые данные

  const s = summary(history);
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Мои PR за {DAYS} дней {org ? `в ${org}` : "во всех организациях"}. Время — в рабочих часах (без выходных), от
          ready for review.
        </p>
        <AutoRefresh fetchedAt={fetchedAt} seconds={600} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Открыто сейчас" value={String(open.length)} />
        <Tile
          label={`Без ревью > ${formatHours(reviewSlaHours())}`}
          value={String(stale)}
          tone={stale ? "bad" : undefined}
        />
        <Tile label={`Смержено за ${DAYS} дн`} value={`${s.merged}`} hint={`из ${s.total} созданных`} />
        <Tile label="Медиана до 1-го ревью" value={s.medianTtfr === null ? "—" : formatHours(s.medianTtfr)} />
        <Tile label="Медиана до мержа" value={s.medianTtm === null ? "—" : formatHours(s.medianTtm)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Открытые PR по репозиториям" footer={<Legend series={BUCKET_SERIES} />}>
          {openByRepo.length ? (
            <HBars data={openByRepo} y="repo" series={BUCKET_SERIES} />
          ) : (
            <Empty>Открытых PR нет</Empty>
          )}
        </Card>

        <Card title="Открыто и смержено по неделям" footer={<Legend series={WEEK_SERIES} />}>
          <Columns data={weekly(history)} x="week" series={WEEK_SERIES} />
        </Card>

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

        <Card title="Время до мержа по размеру PR" subtitle="медиана; размер — добавлено + удалено строк">
          <Columns
            data={bySize(history).map((b) => ({ size: `${b.label} · ${b.hint}`, medianTtm: b.medianTtm, prs: b.prs }))}
            x="size"
            series={one("medianTtm", "До мержа")}
            unit="hours"
          />
        </Card>
      </div>

      <Card title="Кто ревьюит мои PR">
        <ReviewersTable rows={reviewers(history)} />
      </Card>
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

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 text-2xl font-semibold">
        {tone === "bad" && <span className="text-base text-red-600" aria-label="внимание">⚠︎</span>}
        {value}
      </div>
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
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
