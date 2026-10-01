import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { decode, getToken } from "next-auth/jwt";

/**
 * Обёртка над сессией Auth.js для серверного кода.
 *
 * GitHub-токен лежит внутри зашифрованной JWT-cookie Auth.js (см. callbacks.jwt в src/auth.ts).
 * В кэшируемые функции передаём не токен, а саму зашифрованную cookie (`Sealed`): аргументы `use cache`
 * становятся ключом кэша, и токен в открытом виде туда попадать не должен. Расшифровать её можно только AUTH_SECRET.
 */
export type Sealed = { jwt: string; salt: string };

export type SessionUser = { login: string; avatarUrl: string; token: string };
export type Session = { user: SessionUser; sealed: Sealed };

const COOKIE = "authjs.session-token";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET не задан");
  return s;
}

/** Расшифровывает cookie Auth.js. Используется и внутри кэшируемых функций. */
export async function unseal(sealed: Sealed): Promise<SessionUser | null> {
  const payload = await decode({ token: sealed.jwt, secret: secret(), salt: sealed.salt }).catch(() => null);
  if (!payload?.accessToken || !payload.login) return null;
  return { login: payload.login, avatarUrl: payload.picture ?? "", token: payload.accessToken };
}

/** Текущая сессия или null. */
export async function getSession(): Promise<Session | null> {
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

/** Достаёт токен из зашифрованной сессии — внутри кэшируемых функций. */
export async function tokenFrom(sealed: Sealed): Promise<{ token: string; login: string }> {
  const user = await unseal(sealed);
  if (!user) throw new Error(GITHUB_UNAUTHORIZED);
  return user;
}

/** GitHub ответил 401 — токен отозван или истёк. */
export function rethrowAuth(e: unknown): never {
  if (typeof e === "object" && e && "status" in e && e.status === 401) throw new Error(GITHUB_UNAUTHORIZED);
  throw e;
}
