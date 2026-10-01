import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { decode, getToken } from "next-auth/jwt";
import { devGithubToken } from "./dev-auth";

/**
 * Обёртка над сессией Auth.js для серверного кода.
 *
 * GitHub-токен лежит внутри зашифрованной JWT-cookie Auth.js (см. callbacks.jwt в src/auth.ts).
 * В кэшируемые функции передаём не токен, а саму зашифрованную cookie (`Sealed`): аргументы `use cache`
 * становятся ключом кэша, и токен в открытом виде туда попадать не должен. Расшифровать её можно только AUTH_SECRET.
 */
export type Sealed = { jwt: string; salt: string };

/** Откуда токен: OAuth-вход, личный токен владельца из env (OWNER_GITHUB_TOKEN) или dev-режим. */
export type TokenSource = "oauth" | "owner" | "dev";
export type SessionUser = { login: string; avatarUrl: string; token: string; source: TokenSource };
export type Session = { user: SessionUser; sealed: Sealed };

const COOKIE = "authjs.session-token";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET не задан");
  return s;
}

/** Сессия режима разработки (DEV_GITHUB_TOKEN): сам токен в ключ кэша не попадает. */
const DEV_SEALED: Sealed = { jwt: "dev", salt: "dev" };

/** Владелец серверного токена (DEV_ / OWNER_GITHUB_TOKEN) — узнаём у GitHub один раз на процесс. */
const tokenOwners = new Map<string, Promise<{ login: string; avatarUrl: string }>>();

function ownerOf(token: string, envName: string) {
  let owner = tokenOwners.get(token);
  if (!owner) {
    owner = fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${envName} не подошёл: GitHub ответил ${res.status}`);
        const u = (await res.json()) as { login: string; avatar_url: string };
        return { login: u.login, avatarUrl: u.avatar_url };
      })
      .catch((e) => {
        tokenOwners.delete(token); // ошибку не запоминаем — после исправления токена заработает без перезапуска
        throw e;
      });
    tokenOwners.set(token, owner);
  }
  return owner;
}

/**
 * Личный токен владельца (OWNER_GITHUB_TOKEN) — для тех, у кого организации не одобрили OAuth-приложение.
 * Подставляется только тому, кто вошёл через GitHub под тем же логином, что и владелец токена:
 * личность подтверждает OAuth, доступ даёт токен из env. В браузер он не попадает никак.
 */
async function withOwnerToken(user: SessionUser): Promise<SessionUser> {
  const token = process.env.OWNER_GITHUB_TOKEN;
  if (!token) return user;
  const owner = await ownerOf(token, "OWNER_GITHUB_TOKEN").catch((e) => {
    console.error(e); // не ломаем вход владельцу из-за протухшего токена — остаётся OAuth-токен
    return null;
  });
  return owner?.login.toLowerCase() === user.login.toLowerCase() ? { ...user, token, source: "owner" } : user;
}

/** Расшифровывает cookie Auth.js. Используется и внутри кэшируемых функций. */
export async function unseal(sealed: Sealed): Promise<SessionUser | null> {
  if (sealed.jwt === DEV_SEALED.jwt) {
    const token = devGithubToken();
    if (!token) return null;
    const owner = await ownerOf(token, "DEV_GITHUB_TOKEN");
    return { ...owner, token, source: "dev" };
  }
  const payload = await decode({ token: sealed.jwt, secret: secret(), salt: sealed.salt }).catch(() => null);
  if (!payload?.accessToken || !payload.login) return null;
  return withOwnerToken({
    login: payload.login,
    avatarUrl: payload.picture ?? "",
    token: payload.accessToken,
    source: "oauth",
  });
}

/** Текущая сессия или null. */
export async function getSession(): Promise<Session | null> {
  if (devGithubToken()) {
    const user = await unseal(DEV_SEALED);
    return user ? { user, sealed: DEV_SEALED } : null;
  }

  // На https Auth.js добавляет к имени cookie префикс __Secure- (и режет большие cookie на части .0, .1)
  const secure = (await cookies()).getAll().some((c) => c.name.startsWith(`__Secure-${COOKIE}`));
  const salt = secure ? `__Secure-${COOKIE}` : COOKIE;
  const jwt = await getToken({ req: { headers: await headers() }, secret: secret(), secureCookie: secure, raw: true });
  if (!jwt) return null;
  const sealed = { jwt, salt };
  const user = await unseal(sealed);
  return user ? { user, sealed } : null;
}

/** Для страниц и серверных экшенов: без сессии — на /login. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Текст ошибки, по которому страницы понимают, что надо перелогиниться. */
export const GITHUB_UNAUTHORIZED = "GITHUB_UNAUTHORIZED";

/** Достаёт токен из зашифрованной сессии — внутри кэшируемых функций. null — сессия недействительна. */
export async function tokenFrom(sealed: Sealed): Promise<{ token: string; login: string } | null> {
  return unseal(sealed);
}

/** GitHub ответил 401 — токен отозван или истёк. */
export const isGithubUnauthorized = (e: unknown) =>
  typeof e === "object" && e !== null && "status" in e && e.status === 401;

/** Для некэшируемого кода (серверные экшены): 401 → понятная ошибка. */
export function rethrowAuth(e: unknown): never {
  if (isGithubUnauthorized(e)) throw new Error(GITHUB_UNAUTHORIZED);
  throw e;
}
