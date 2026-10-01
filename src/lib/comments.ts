import "server-only";
import { graphql } from "@octokit/graphql";
import { db } from "./db";
import { rethrowAuth, type SessionUser } from "./session";

export type ReviewComment = {
  id: string;
  kind: "thread" | "review";
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  author: string;
  path: string | null;
  diffHunk: string | null;
  body: string;
  url: string;
  createdAt: string;
};

type Author = { __typename: string; login: string } | null;

type Response = {
  viewer: { login: string };
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      number: number;
      title: string;
      url: string;
      repository: { nameWithOwner: string };
      reviewThreads: {
        nodes: Array<{
          comments: {
            nodes: Array<{
              id: string;
              author: Author;
              body: string;
              path: string;
              diffHunk: string;
              url: string;
              createdAt: string;
            }>;
          };
        }>;
      };
      reviews: {
        nodes: Array<{ id: string; author: Author; body: string; url: string; submittedAt: string | null }>;
      };
    }>;
  };
};

const QUERY = /* GraphQL */ `
  query MyReviewComments($q: String!, $after: String) {
    viewer { login }
    search(query: $q, type: ISSUE, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          title
          url
          repository { nameWithOwner }
          reviewThreads(first: 50) {
            nodes {
              comments(first: 10) {
                nodes { id author { __typename login } body path diffHunk url createdAt }
              }
            }
          }
          reviews(first: 30) {
            nodes { id author { __typename login } body url submittedAt }
          }
        }
      }
    }
  }
`;

const isHuman = (a: Author, me: string): a is NonNullable<Author> =>
  !!a && a.login !== me && a.__typename !== "Bot" && !a.login.endsWith("[bot]");

/** Тянет из GitHub замечания других людей к моим PR (во всех организациях), обновлённым за последние `days` дней. */
export async function fetchReviewComments(token: string, days = 180): Promise<ReviewComment[]> {

  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const q = `is:pr author:@me updated:>=${since}`;
  const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

  const out: ReviewComment[] = [];
  let after: string | null = null;
  for (let page = 0; page < 6; page++) {
    const res: Response = await gql<Response>(QUERY, { q, after }).catch(rethrowAuth);
    const me = res.viewer.login;

    for (const pr of res.search.nodes) {
      const base = { repo: pr.repository.nameWithOwner, prNumber: pr.number, prTitle: pr.title, prUrl: pr.url };
      for (const thread of pr.reviewThreads.nodes)
        for (const c of thread.comments.nodes)
          if (isHuman(c.author, me) && c.body.trim())
            out.push({ ...base, id: c.id, kind: "thread", author: c.author.login, path: c.path, diffHunk: c.diffHunk, body: c.body, url: c.url, createdAt: c.createdAt });

      for (const r of pr.reviews.nodes)
        if (isHuman(r.author, me) && r.body.trim() && r.submittedAt)
          out.push({ ...base, id: r.id, kind: "review", author: r.author.login, path: null, diffHunk: null, body: r.body, url: r.url, createdAt: r.submittedAt });
    }

    if (!res.search.pageInfo.hasNextPage) break;
    after = res.search.pageInfo.endCursor;
  }
  return out;
}

/** Синхронизация GitHub → Postgres. Идемпотентна: upsert по id комментария. */
export async function syncReviewComments(user: SessionUser, days?: number) {
  const comments = await fetchReviewComments(user.token, days);
  if (comments.length === 0) return { fetched: 0, inserted: 0 };

  const sql = db();
  const rows = comments.map((c) => ({
    id: c.id,
    user_login: user.login,
    kind: c.kind,
    repo: c.repo,
    pr_number: c.prNumber,
    pr_title: c.prTitle,
    pr_url: c.prUrl,
    author: c.author,
    path: c.path,
    diff_hunk: c.diffHunk,
    body: c.body,
    url: c.url,
    created_at: c.createdAt,
  }));

  const result = await sql`
    insert into review_comments ${sql(rows)}
    on conflict (id) do update set body = excluded.body, pr_title = excluded.pr_title, synced_at = now()
    returning (xmax = 0) as inserted
  `;
  return { fetched: comments.length, inserted: result.filter((r) => r.inserted).length };
}

/** Замечания из базы; `org` = null — по всем организациям. */
export async function listReviewComments(login: string, org: string | null, days = 180): Promise<ReviewComment[]> {
  const rows = await db()`
    select id, kind, repo, pr_number, pr_title, pr_url, author, path, diff_hunk, body, url, created_at
    from review_comments
    where user_login = ${login}
      and created_at >= now() - make_interval(days => ${days})
      and (${org}::text is null or repo like ${org + "/%"})
    order by created_at desc
  `;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    repo: r.repo,
    prNumber: r.pr_number,
    prTitle: r.pr_title,
    prUrl: r.pr_url,
    author: r.author,
    path: r.path,
    diffHunk: r.diff_hunk,
    body: r.body,
    url: r.url,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
