import "server-only";
import { graphql } from "@octokit/graphql";
import { cacheLife, cacheTag } from "next/cache";
import { CACHE_TAGS, unauthorized, type Fetched } from "./cache-tags";
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
  reviewers: Array<{ author: string; at: string }>;
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
  repository: { nameWithOwner: string };
  timelineItems: { nodes: Array<{ createdAt?: string }> };
  reviews: { nodes: Array<{ author: { login: string } | null; submittedAt: string | null }> };
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
          repository { nameWithOwner }
          timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], first: 1) {
            nodes { ... on ReadyForReviewEvent { createdAt } }
          }
          reviews(first: 20) { nodes { author { login } submittedAt } }
        }
      }
    }
  }
`;

/** Мои PR, созданные за последние `days` дней (не больше 300; страницы по 30 — крупнее GitHub отвечает 502). */
export async function getMyPrHistory(sealed: Sealed, org: string | null, days = 90): Promise<Fetched<HistoricalPr>> {
  "use cache: remote";
  const auth = await tokenFrom(sealed);
  if (!auth) {
    cacheLife("seconds");
    return unauthorized();
  }
  const { token, login } = auth;
  cacheTag(CACHE_TAGS.history(login));

  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const q = ["is:pr", "author:@me", `created:>=${since}`, org && `org:${org}`].filter(Boolean).join(" ");
  const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

  const nodes: Node[] = [];
  let me = "";
  let after: string | null = null;
  try {
    for (let page = 0; page < 10; page++) {
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
    const readyAt = n.timelineItems.nodes[0]?.createdAt ?? n.createdAt;
    const reviewers = n.reviews.nodes
      .filter((r) => r.author && r.author.login !== me && r.submittedAt)
      .map((r) => ({ author: r.author!.login, at: r.submittedAt! }))
      .sort((a, b) => a.at.localeCompare(b.at));
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
    };
  });
  return { items, fetchedAt: new Date().toISOString() };
}
