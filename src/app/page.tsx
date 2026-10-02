import { Suspense } from "react";
import Link from "next/link";
import { getMyOpenPullRequests, type PullRequest } from "@/lib/github";
import type { Fetched } from "@/lib/cache-tags";
import { BUCKETS, PROBLEMS, QUIET_BUCKETS, bucketOf, problemsOf, type Bucket, type Problem } from "@/lib/attention";
import { PrCard } from "@/components/pr-card";
import { AutoRefresh } from "@/components/auto-refresh";
import { getSelectedOrg } from "@/lib/org";
import { requireSession } from "@/lib/session";
import { GithubError } from "@/components/github-error";

export default function Page({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold">Мои PR</h1>
      <Suspense fallback={<p className="mt-6 text-zinc-500">Загружаю PR из GitHub…</p>}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const { filter } = await searchParams;
  const active = typeof filter === "string" && filter in PROBLEMS ? (filter as Problem) : null;
  const { sealed } = await requireSession();
  const org = await getSelectedOrg();
  const subtitle = (
    <p className="mb-6 text-sm text-zinc-500">Мои открытые PR {org ? `в ${org}` : "во всех организациях"}</p>
  );

  let loaded: Fetched<PullRequest> | { error: unknown };
  try {
    loaded = await getMyOpenPullRequests(sealed, org);
  } catch (error) {
    loaded = { error };
  }
  if ("error" in loaded || loaded.unauthorized)
    return (
      <>
        {subtitle}
        {"error" in loaded ? <GithubError error={loaded.error} /> : <GithubError unauthorized />}
      </>
    );
  const { items: prs, fetchedAt } = loaded;

  if (prs.length === 0)
    return (
      <>
        {subtitle}
        <p className="text-zinc-500">Открытых PR нет 🎉</p>
      </>
    );

  // Боты и заброшенные PR — отдельно и в счётчики проблем не входят, иначе они забивают список
  const live = prs.filter((pr) => !QUIET_BUCKETS.has(bucketOf(pr)));
  const counts = Object.fromEntries(
    (Object.keys(PROBLEMS) as Problem[]).map((p) => [p, live.filter((pr) => problemsOf(pr).includes(p)).length]),
  ) as Record<Problem, number>;

  const visible = active ? live.filter((pr) => problemsOf(pr).includes(active)) : prs;
  const buckets = Map.groupBy(visible, bucketOf);

  return (
    <>
      {subtitle}
      <nav className="mb-8 flex flex-wrap items-center gap-2 text-sm">
        <FilterChip href="/" label="Все" count={live.length} selected={!active} />
        {(Object.keys(PROBLEMS) as Problem[]).map((p) => (
          <FilterChip
            key={p}
            href={`/?filter=${p}`}
            label={PROBLEMS[p]}
            count={counts[p]}
            selected={active === p}
            alert={counts[p] > 0}
          />
        ))}
        <div className="ml-auto">
          <AutoRefresh fetchedAt={fetchedAt} />
        </div>
      </nav>

      <div className="space-y-10">
        {(Object.keys(BUCKETS) as Bucket[]).map((b) => {
          const items = buckets.get(b);
          if (!items?.length) return null;
          const grid = (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((pr) => (
                <PrCard key={pr.id} pr={pr} />
              ))}
            </div>
          );
          const heading = (
            <>
              {BUCKETS[b]} <span className="font-normal text-zinc-400">{items.length}</span>
            </>
          );
          // Шумные секции свёрнуты по умолчанию
          return QUIET_BUCKETS.has(b) ? (
            <details key={b} className="group">
              <summary className="mb-3 cursor-pointer text-sm font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                {heading}
              </summary>
              {grid}
            </details>
          ) : (
            <section key={b}>
              <h2 className="mb-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">{heading}</h2>
              {grid}
            </section>
          );
        })}
      </div>
    </>
  );
}

function FilterChip(props: { href: string; label: string; count: number; selected: boolean; alert?: boolean }) {
  return (
    <Link
      href={props.href}
      className={`rounded-full border px-3 py-1 ${
        props.selected
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      }`}
    >
      {props.label}{" "}
      <span className={props.alert && !props.selected ? "font-semibold text-red-600" : "opacity-60"}>{props.count}</span>
    </Link>
  );
}
