import "server-only";
import { graphql } from "@octokit/graphql";
import { cacheLife, cacheTag } from "next/cache";
import { CACHE_TAGS, unauthorized, type Fetched } from "./cache-tags";
import { isAutomatedPr } from "./automation";
import { isGithubUnauthorized, tokenFrom, type Sealed } from "./session";

/** Чужой PR, где запрошено моё ревью (лично или через команду). */
export type ReviewRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string; // owner/name
  author: string;
  authorAvatar: string;
  isDraft: boolean;
  automated: boolean;
  additions: number;
  deletions: number;
  checks: "success" | "failure" | "pending" | "none";
  /** С какого момента ждут именно меня: последний запрос ревью у меня или моей команды */
  requestedAt: string;
  /** Через какую команду пришёл запрос (null — лично) */
  viaTeam: string | null;
  /** Я уже ревьюил этот PR раньше — значит, это повторный запрос после правок */
  rerequested: boolean;
};

type Requested = { __typename: "User"; login: string } | { __typename: "Team"; slug: string } | null;

type Node = {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  headRefName: string;
  additions: number;
  deletions: number;
  repository: { nameWithOwner: string };
  author: { __typename: string; login: string; avatarUrl: string } | null;
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
  timelineItems: { nodes: Array<{ createdAt?: string; requestedReviewer?: Requested }> };
  reviews: { nodes: Array<{ author: { login: string } | null }> };
};

type Response = { viewer: { login: string }; search: { nodes: Node[] } };

const QUERY = /* GraphQL */ `
  query ReviewRequests($q: String!) {
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
          headRefName
          additions
          deletions
          repository { nameWithOwner }
          author { __typename login avatarUrl }
          commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
          timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) {
            nodes {
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  __typename
                  ... on User { login }
                  ... on Team { slug }
                }
              }
            }
          }
          reviews(last: 50) { nodes { author { login } } }
        }
      }
    }
  }
`;

const CHECKS: Record<string, ReviewRequest["checks"]> = { SUCCESS: "success", FAILURE: "failure", ERROR: "failure" };

/** PR, где ждут моего ревью: `review-requested:@me` (включает запросы через мои команды). */
export async function getReviewRequests(sealed: Sealed, org: string | null): Promise<Fetched<ReviewRequest>> {
  "use cache: remote";
  const auth = await tokenFrom(sealed);
  if (!auth) {
    cacheLife("seconds");
    return unauthorized();
  }
  const { token, login } = auth;
  cacheTag(CACHE_TAGS.reviews(login));

  const q = ["is:pr", "is:open", "review-requested:@me", "-author:@me", "archived:false", org && `org:${org}`]
    .filter(Boolean)
    .join(" ");
  const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

  let data: Response;
  try {
    data = await gql<Response>(QUERY, { q });
  } catch (e) {
    if (!isGithubUnauthorized(e)) throw e;
    cacheLife("seconds");
    return unauthorized();
  }
  cacheLife("minutes");
  const me = data.viewer.login;

  const items = data.search.nodes.map((n): ReviewRequest => {
    const events = n.timelineItems.nodes.filter((e) => e.createdAt && e.requestedReviewer);
    // Последний запрос лично мне; если его нет — последний запрос любой команде (через неё и пришёл запрос)
    const personal = events.filter((e) => e.requestedReviewer?.__typename === "User" && e.requestedReviewer.login === me).at(-1);
    const team = events.filter((e) => e.requestedReviewer?.__typename === "Team").at(-1);
    const event = personal ?? team;
    const raw = n.commits.nodes[0]?.commit.statusCheckRollup?.state;
    return {
      id: n.id,
      number: n.number,
      title: n.title,
      url: n.url,
      repo: n.repository.nameWithOwner,
      author: n.author?.login ?? "ghost",
      authorAvatar: n.author?.avatarUrl ?? "",
      isDraft: n.isDraft,
      automated: isAutomatedPr({ title: n.title, headRef: n.headRefName, authorIsBot: n.author?.__typename === "Bot" }),
      additions: n.additions,
      deletions: n.deletions,
      checks: raw ? (CHECKS[raw] ?? "pending") : "none",
      requestedAt: event?.createdAt ?? n.createdAt,
      viaTeam: !personal && event?.requestedReviewer?.__typename === "Team" ? event.requestedReviewer.slug : null,
      rerequested: n.reviews.nodes.some((r) => r.author?.login === me),
    };
  });
  return { items, fetchedAt: new Date().toISOString() };
}
