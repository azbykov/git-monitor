import { Suspense } from "react";
import type { Metadata } from "next";
import { getReviewRequests, type ReviewRequest } from "@/lib/reviews";
import type { Fetched } from "@/lib/cache-tags";
import type { Criterion } from "@/lib/attention";
import { getSelectedOrg } from "@/lib/org";
import { requireSession } from "@/lib/session";
import { formatHours, reviewSlaHours, workingHoursBetween } from "@/lib/time";
import { AutoRefresh } from "@/components/auto-refresh";
import { CriterionChip } from "@/components/criterion-chip";
import { GithubError } from "@/components/github-error";

export const metadata: Metadata = { title: "Ревью · Git Monitor" };

export default function ReviewsPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold">Жду моего ревью</h1>
      <Suspense fallback={<p className="mt-6 text-zinc-500">Загружаю запросы на ревью…</p>}>
        <Reviews />
      </Suspense>
    </main>
  );
}

async function Reviews() {
  const { sealed } = await requireSession();
  const org = await getSelectedOrg();
  const subtitle = (
    <p className="mb-6 text-sm text-zinc-500">
      Чужие PR, где запрошено ваше ревью {org ? `в ${org}` : "во всех организациях"} — лично или через команду. Сверху —
      те, что ждут дольше всех.
    </p>
  );

  let loaded: Fetched<ReviewRequest> | { error: unknown };
  try {
    loaded = await getReviewRequests(sealed, org);
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

  const now = new Date(loaded.fetchedAt).getTime(); // ожидание — на момент загрузки (render должен быть чистым)
  const waited = (r: ReviewRequest) => workingHoursBetween(r.requestedAt, now);
  const sorted = loaded.items.toSorted((a, b) => waited(b) - waited(a));
  const people = sorted.filter((r) => !r.automated);
  const bots = sorted.filter((r) => r.automated);
  const overdue = people.filter((r) => !r.isDraft && waited(r) >= reviewSlaHours()).length;

  return (
    <>
      {subtitle}
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800">
          Ждут вас <span className="opacity-60">{people.length}</span>
        </span>
        {overdue > 0 && (
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-red-700 dark:text-red-400">
            ✗ Дольше {formatHours(reviewSlaHours())} — {overdue}
          </span>
        )}
        <div className="ml-auto">
          <AutoRefresh fetchedAt={loaded.fetchedAt} />
        </div>
      </div>

      {people.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Никто не ждёт вашего ревью
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((r) => (
            <ReviewCard key={r.id} r={r} hours={waited(r)} />
          ))}
        </div>
      )}

      {bots.length > 0 && (
        <details className="mt-10">
          <summary className="mb-3 cursor-pointer text-sm font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            От ботов <span className="font-normal text-zinc-400">{bots.length}</span>
          </summary>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bots.map((r) => (
              <ReviewCard key={r.id} r={r} hours={waited(r)} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

const SIZE_WARN = 400;
const SIZE_BAD = 1000;

function chipsOf(r: ReviewRequest, hours: number): Array<Pick<Criterion, "status" | "label" | "hint"> & { key: string }> {
  const lines = r.additions + r.deletions;
  const chips: Array<Pick<Criterion, "status" | "label" | "hint"> & { key: string }> = [
    r.isDraft
      ? { key: "wait", status: "none", label: "Черновик" }
      : {
          key: "wait",
          status: hours >= reviewSlaHours() ? "bad" : "wait",
          label: `Ждёт вас · ${formatHours(hours)}`,
          hint: "С момента запроса ревью, в рабочих часах",
        },
    r.checks === "success"
      ? { key: "ci", status: "ok", label: "CI" }
      : r.checks === "failure"
        ? { key: "ci", status: "bad", label: "CI упал", hint: "Можно не спешить: автору сначала чинить CI" }
        : r.checks === "pending"
          ? { key: "ci", status: "wait", label: "CI идёт" }
          : { key: "ci", status: "none", label: "Нет CI" },
    {
      key: "size",
      status: lines > SIZE_BAD ? "bad" : lines > SIZE_WARN ? "wait" : "ok",
      label: `${lines.toLocaleString("ru")} строк`,
      hint: `+${r.additions} −${r.deletions}`,
    },
  ];
  if (r.rerequested) chips.push({ key: "again", status: "wait", label: "Повторно", hint: "Вы уже ревьюили — автор просит посмотреть снова" });
  return chips;
}

function ReviewCard({ r, hours }: { r: ReviewRequest; hours: number }) {
  const chips = chipsOf(r, hours);
  const bad = chips.some((c) => c.key === "wait" && c.status === "bad");
  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border border-l-4 border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${
        bad ? "border-l-red-500" : "border-l-amber-400"
      }`}
    >
      <header>
        <div className="mb-1 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <span>{r.repo.split("/")[1]}</span>
          <span>#{r.number}</span>
          {r.viaTeam && <span className="ml-auto truncate">через @{r.viaTeam}</span>}
        </div>
        <a href={r.url} target="_blank" rel="noreferrer" className="font-medium leading-snug hover:underline">
          {r.title}
        </a>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {r.authorAvatar && <img src={r.authorAvatar} alt="" className="size-4 rounded-full" />}@{r.author}
        </div>
      </header>
      <ul className="flex flex-wrap gap-1.5" aria-label="Состояние PR">
        {chips.map((c) => (
          <CriterionChip key={c.key} c={c} />
        ))}
      </ul>
    </article>
  );
}
