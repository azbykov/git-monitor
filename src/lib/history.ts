import "server-only";
import { graphql } from "@octokit/graphql";
import { cacheLife, cacheTag } from "next/cache";
import { CACHE_TAGS, unauthorized, type Fetched } from "./cache-tags";
import { isAutomatedPr } from "./automation";
import { isGithubUnauthorized, tokenFrom, type Sealed } from "./session";

export type HistoricalPr = {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  createdAt: string;
  readyAt: string;
  mergedAt: string | null;
  size: number; // additions + deletions
  /** Первое ревью не от меня после ready for review */
  firstReview: { author: string; at: string } | null;
  reviewers: Array<{ author: string; at: string; state: string }>;
  /** Первый запрос ревью (не раньше ready for review); если запросов не было — ready for review */
  reviewRequestedAt: string;
  /** Последнее одобрение (не от меня) до мержа — конец этапа «в ревью» */
  lastApprovalAt: string | null;
  /** PR от бота зависимостей или релизов — в аналитике не учитываем */
  automated: boolean;
};

type Node = {
  number: number;
  title: string;
  url: string;
  state: HistoricalPr["state"];
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  headRefName: string;
  repository: { nameWithOwner: string };
  ready: { nodes: Array<{ createdAt?: string }> };
  requested: { nodes: Array<{ createdAt?: string }> };
  reviews: { nodes: Array<{ author: { login: string } | null; submittedAt: string | null; state: string }> };
};

type Response = {
  viewer: { login: string };
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] };
};

const QUERY = /* GraphQL */ `
  query MyPrHistory($q: String!, $after: String) {
    viewer { login }
    search(query: $q, type: ISSUE, first: 30, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          title
          url
          state
          createdAt
          mergedAt
          additions
          deletions
          headRefName
          repository { nameWithOwner }
          ready: timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], first: 1) {
            nodes { ... on ReadyForReviewEvent { createdAt } }
          }
          requested: timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 1) {
            nodes { ... on ReviewRequestedEvent { createdAt } }
          }
          reviews(first: 30) { nodes { author { login } submittedAt state } }
        }
      }
    }
  }
`;

/**
 * Мои PR, созданные за последние `days` дней.
 *
 * Грузим по календарным месяцам: каждый месяц — отдельная кэшируемая запись, месяцы идут параллельно.
 * Зачем: целый год последовательно — ~45 с, а заполнение `use cache` обрывается на 50 с; плюс периоды
 * переиспользуют уже загруженные месяцы (после «6 месяцев» «год» догружает только недостающие).
 */
export async function getMyPrHistory(sealed: Sealed, org: string | null, days = 90): Promise<Fetched<HistoricalPr>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const months = monthsSince(since);

  const chunks: Fetched<HistoricalPr>[] = [];
  for (let i = 0; i < months.length; i += 4) {
    // по 4 месяца одновременно — чтобы не упереться во вторичные лимиты GitHub
    chunks.push(...(await Promise.all(months.slice(i, i + 4).map((m) => getMonthOfHistory(sealed, org, m)))));
  }
  if (chunks.some((c) => c.unauthorized)) return unauthorized();

  return {
    items: chunks.flatMap((c) => c.items).filter((pr) => pr.createdAt >= since),
    fetchedAt: chunks.map((c) => c.fetchedAt).sort()[0] ?? new Date().toISOString(), // самые старые данные
  };
}

/** ["2025-10", …, "2026-10"] — месяцы (UTC), которые пересекает период. */
function monthsSince(sinceIso: string): string[] {
  const out: string[] = [];
  const cursor = new Date(sinceIso);
  cursor.setUTCDate(1);
  const end = Date.now();
  while (cursor.getTime() <= end) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/** PR, созданные в одном месяце `YYYY-MM`. До 1000 штук — предел поиска GitHub. */
async function getMonthOfHistory(sealed: Sealed, org: string | null, month: string): Promise<Fetched<HistoricalPr>> {
  "use cache: remote";
  const auth = await tokenFrom(sealed);
  if (!auth) {
    cacheLife("seconds");
    return unauthorized();
  }
  const { token, login } = auth;
  cacheTag(CACHE_TAGS.history(login));

  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const range = `${month}-01..${month}-${String(last).padStart(2, "0")}`;
  const q = ["is:pr", "author:@me", `created:${range}`, org && `org:${org}`].filter(Boolean).join(" ");
  const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

  const nodes: Node[] = [];
  let me = "";
  let after: string | null = null;
  try {
    // страницы по 30 — на более крупных GitHub отвечает 502
    for (let page = 0; page < 34; page++) {
      const res: Response = await gql<Response>(QUERY, { q, after });
      me = res.viewer.login;
      nodes.push(...res.search.nodes);
      if (!res.search.pageInfo.hasNextPage) break;
      after = res.search.pageInfo.endCursor;
    }
  } catch (e) {
    if (!isGithubUnauthorized(e)) throw e;
    cacheLife("seconds");
    return unauthorized();
  }
  cacheLife("hours");

  const items = nodes.map((n) => {
    const readyAt = n.ready.nodes[0]?.createdAt ?? n.createdAt;
    const requestedAt = n.requested.nodes[0]?.createdAt;
    const reviewers = n.reviews.nodes
      .filter((r) => r.author && r.author.login !== me && r.submittedAt)
      .map((r) => ({ author: r.author!.login, at: r.submittedAt!, state: r.state }))
      .sort((a, b) => a.at.localeCompare(b.at));
    const approvals = reviewers.filter((r) => r.state === "APPROVED" && (!n.mergedAt || r.at <= n.mergedAt));
    return {
      repo: n.repository.nameWithOwner,
      number: n.number,
      title: n.title,
      url: n.url,
      state: n.state,
      createdAt: n.createdAt,
      readyAt,
      mergedAt: n.mergedAt,
      size: n.additions + n.deletions,
      firstReview: reviewers.find((r) => r.at >= readyAt) ?? null,
      reviewers,
      // ревью могли запросить ещё в черновике — тогда этап «в ревью» начинается с ready for review
      reviewRequestedAt: requestedAt && requestedAt > readyAt ? requestedAt : readyAt,
      lastApprovalAt: approvals.at(-1)?.at ?? null,
      automated: isAutomatedPr({ title: n.title, headRef: n.headRefName }),
    };
  });
  return { items, fetchedAt: new Date().toISOString() };
}
