import "server-only";
import { cookies } from "next/headers";
import { graphql } from "@octokit/graphql";
import { cacheLife, cacheTag } from "next/cache";
import { CACHE_TAGS } from "./cache-tags";
import { rethrowAuth, tokenFrom, type Sealed } from "./session";

export const ORG_COOKIE = "org";
/** Значение cookie для явного выбора «Все организации» */
export const ALL = "*";

/** Логин организации GitHub; проверяем, чтобы значение из cookie не стало инъекцией в поисковый запрос. */
export const isOrgLogin = (v: string) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(v);

/**
 * Выбранная организация из cookie; без выбора — все.
 * Возвращает null, если смотрим по всем организациям.
 */
export async function getSelectedOrg(): Promise<string | null> {
  const value = (await cookies()).get(ORG_COOKIE)?.value;
  if (value === ALL) return null;
  return value && isOrgLogin(value) ? value : null;
}

export type Org = { login: string; avatarUrl: string | null };

type Response = {
  viewer: { organizations: { nodes: Array<{ login: string; avatarUrl: string }> } };
  search: { nodes: Array<{ repository?: { owner: { __typename: string; login: string; avatarUrl: string } } }> };
};

/**
 * Организации пользователя. Членство из viewer.organizations видно только со scope `read:org`,
 * поэтому дополнительно берём владельцев репозиториев из моих последних PR — так список не пустой даже без него.
 */
export async function listMyOrgs(sealed: Sealed): Promise<Org[]> {
  "use cache: remote";
  const { token, login } = await tokenFrom(sealed);
  cacheLife("days");
  cacheTag(CACHE_TAGS.orgs(login));

  const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });
  const res = await gql<Response>(/* GraphQL */ `
    query MyOrgs {
      viewer { organizations(first: 50) { nodes { login avatarUrl } } }
      search(query: "is:pr author:@me sort:updated-desc", type: ISSUE, first: 100) {
        nodes { ... on PullRequest { repository { owner { __typename login avatarUrl } } } }
      }
    }
  `).catch(rethrowAuth);

  const orgs = new Map<string, Org>();
  for (const o of res.viewer.organizations.nodes) orgs.set(o.login, { login: o.login, avatarUrl: o.avatarUrl });
  for (const n of res.search.nodes) {
    const owner = n.repository?.owner;
    if (owner?.__typename === "Organization" && !orgs.has(owner.login))
      orgs.set(owner.login, { login: owner.login, avatarUrl: owner.avatarUrl });
  }
  return [...orgs.values()].sort((a, b) => a.login.localeCompare(b.login));
}
