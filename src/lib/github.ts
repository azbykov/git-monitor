import "server-only";
import { graphql } from "@octokit/graphql";
import { cacheLife, cacheTag } from "next/cache";
import { CACHE_TAGS, unauthorized, type Fetched } from "./cache-tags";
import { isGithubUnauthorized, tokenFrom, type Sealed } from "./session";

export type FailedCheck = { name: string; url: string | null };

export type ReviewComment = {
  author: string;
  path: string;
  body: string;
  url: string;
  createdAt: string;
};

export type PullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string; // owner/name
  isDraft: boolean;
  updatedAt: string;
  baseRef: string;
  headRef: string;
  additions: number;
  deletions: number;
  /** CONFLICTING — есть конфликты; UNKNOWN — GitHub ещё не посчитал */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  checks: {
    state: "success" | "failure" | "pending" | "none";
    failed: FailedCheck[];
  };
  /** Неразрешённые треды, где последнее слово не за мной — ждут моего ответа */
  threadsAwaitingMe: ReviewComment[];
  /** Неразрешённые треды, где я уже ответил — ждут ревьюера */
  threadsAwaitingOthers: number;
  changesRequestedBy: string[];
  approvedBy: string[];
  /** С какого момента PR ждёт ревью: ready for review или создание */
  readyAt: string;
  /** Есть ли хоть одно ревью/комментарий ревью не от меня */
  hasReviewFromOthers: boolean;
  /** Самый давний мой ответ в треде, на который ревьюер ещё не отреагировал */
  oldestUnansweredReplyAt: string | null;
  requestedReviewers: string[];
};

type CheckNode =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null };

type Author = { login: string } | null;

type PrNode = {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  mergeable: PullRequest["mergeable"];
  repository: { nameWithOwner: string };
  commits: {
    nodes: Array<{
      commit: { statusCheckRollup: { state: string; contexts: { nodes: CheckNode[] } } | null };
    }>;
  };
  reviewThreads: {
    nodes: Array<{
      isResolved: boolean;
      path: string;
      first: { nodes: Array<{ author: Author; body: string; url: string; createdAt: string }> };
      last: { nodes: Array<{ author: Author; createdAt: string }> };
    }>;
  };
  latestReviews: { nodes: Array<{ state: string; author: Author }> };
  timelineItems: { nodes: Array<{ createdAt?: string }> };
  reviewRequests: {
    nodes: Array<{ requestedReviewer: { login?: string; name?: string } | null }>;
  };
};

type Response = { viewer: { login: string }; search: { nodes: PrNode[] } };

const QUERY = /* GraphQL */ `
  query MyOpenPRs($q: String!) {
    viewer { login }
    search(query: $q, type: ISSUE, first: 50) {
      nodes {
        ... on PullRequest {
          id
          number
          title
          url
          isDraft
          createdAt
          updatedAt
          baseRefName
          headRefName
          additions
          deletions
          mergeable
          repository { nameWithOwner }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                  contexts(first: 50) {
                    nodes {
                      __typename
                      ... on CheckRun { name status conclusion detailsUrl }
                      ... on StatusContext { context state targetUrl }
                    }
                  }
                }
              }
            }
          }
          reviewThreads(first: 50) {
            nodes {
              isResolved
              path
              first: comments(first: 1) { nodes { author { login } body url createdAt } }
              last: comments(last: 1) { nodes { author { login } createdAt } }
            }
          }
          latestReviews(first: 20) { nodes { state author { login } } }
          timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) {
            nodes { ... on ReadyForReviewEvent { createdAt } }
          }
          reviewRequests(first: 10) {
            nodes {
              requestedReviewer {
                ... on User { login }
                ... on Team { name }
              }
            }
          }
        }
      }
    }
  }
`;

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

function mapChecks(node: PrNode): PullRequest["checks"] {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup;
  if (!rollup) return { state: "none", failed: [] };

  const failed: FailedCheck[] = [];
  for (const c of rollup.contexts.nodes) {
    if (c.__typename === "CheckRun" && c.conclusion && FAILED_CONCLUSIONS.has(c.conclusion))
      failed.push({ name: c.name, url: c.detailsUrl });
    if (c.__typename === "StatusContext" && (c.state === "FAILURE" || c.state === "ERROR"))
      failed.push({ name: c.context, url: c.targetUrl });
  }

  const state =
    rollup.state === "SUCCESS"
      ? "success"
      : rollup.state === "FAILURE" || rollup.state === "ERROR"
        ? "failure"
        : "pending";
  return { state, failed };
}

/** Мои открытые PR; `org` = null — по всем организациям. */
export async function getMyOpenPullRequests(sealed: Sealed, org: string | null): Promise<Fetched<PullRequest>> {
  "use cache: remote";
  const auth = await tokenFrom(sealed);
  if (!auth) {
    cacheLife("seconds");
    return unauthorized();
  }
  const { token, login } = auth;
  cacheTag(CACHE_TAGS.openPrs(login));

  const q = ["is:pr", "is:open", "author:@me", "archived:false", org && `org:${org}`, "sort:updated-desc"]
    .filter(Boolean)
    .join(" ");

  const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });
  let data: Response;
  try {
    data = await gql<Response>(QUERY, { q });
  } catch (e) {
    if (!isGithubUnauthorized(e)) throw e; // прочие ошибки не кэшируются
    cacheLife("seconds");
    return unauthorized();
  }
  cacheLife("minutes");
  const { viewer, search } = data;
  const me = viewer.login;

  const items = search.nodes.map((n) => {
    const open = n.reviewThreads.nodes.filter((t) => !t.isResolved);
    const awaitingMe = open.filter((t) => t.last.nodes[0]?.author?.login !== me);
    const myReplyTimes = open
      .filter((t) => t.last.nodes[0]?.author?.login === me)
      .map((t) => t.last.nodes[0].createdAt)
      .sort();
    const reviewers = (state: string) =>
      n.latestReviews.nodes.filter((r) => r.state === state).map((r) => r.author?.login ?? "ghost");

    return {
      id: n.id,
      number: n.number,
      title: n.title,
      url: n.url,
      repo: n.repository.nameWithOwner,
      isDraft: n.isDraft,
      updatedAt: n.updatedAt,
      baseRef: n.baseRefName,
      headRef: n.headRefName,
      additions: n.additions,
      deletions: n.deletions,
      mergeable: n.mergeable,
      checks: mapChecks(n),
      threadsAwaitingMe: awaitingMe.map((t) => {
        const c = t.first.nodes[0];
        return {
          author: c?.author?.login ?? "ghost",
          path: t.path,
          body: c?.body ?? "",
          url: c?.url ?? n.url,
          createdAt: c?.createdAt ?? n.updatedAt,
        };
      }),
      threadsAwaitingOthers: open.length - awaitingMe.length,
      changesRequestedBy: reviewers("CHANGES_REQUESTED"),
      approvedBy: reviewers("APPROVED"),
      readyAt: n.timelineItems.nodes[0]?.createdAt ?? n.createdAt,
      hasReviewFromOthers: n.latestReviews.nodes.some((r) => r.author?.login !== me),
      oldestUnansweredReplyAt: myReplyTimes[0] ?? null,
      requestedReviewers: n.reviewRequests.nodes
        .map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name)
        .filter((x): x is string => Boolean(x)),
    };
  });
  return { items, fetchedAt: new Date().toISOString() };
}
