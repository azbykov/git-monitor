import { Suspense } from "react";
import Link from "next/link";
import { getMyOpenPullRequests, type PullRequest } from "@/lib/github";
import { BUCKETS, PROBLEMS, bucketOf, problemsOf, type Bucket, type Problem } from "@/lib/attention";
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

  let prs: PullRequest[];
  let fetchedAt: string;
  try {
    ({ items: prs, fetchedAt } = await getMyOpenPullRequests(sealed, org));
  } catch (e) {
    return (
      <>
        {subtitle}
        <GithubError error={e} />
      </>
    );
  }

  if (prs.length === 0)
    return (
      <>
        {subtitle}
        <p className="text-zinc-500">Открытых PR нет 🎉</p>
      </>
    );

  const counts = Object.fromEntries(
    (Object.keys(PROBLEMS) as Problem[]).map((p) => [p, prs.filter((pr) => problemsOf(pr).includes(p)).length]),
  ) as Record<Problem, number>;

  const visible = active ? prs.filter((pr) => problemsOf(pr).includes(active)) : prs;
  const buckets = Map.groupBy(visible, bucketOf);

  return (
    <>
      {subtitle}
      <nav className="mb-8 flex flex-wrap items-center gap-2 text-sm">
        <FilterChip href="/" label="Все" count={prs.length} selected={!active} />
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
          return (
            <section key={b}>
              <h2 className="mb-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                {BUCKETS[b]} <span className="font-normal text-zinc-400">{items.length}</span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((pr) => (
                  <PrCard key={pr.id} pr={pr} />
                ))}
              </div>
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
