import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

declare module "next-auth" {
  interface Session {
    user: { login: string } & import("next-auth").DefaultSession["user"];
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    login?: string;
    /** GitHub-токен. Живёт только в зашифрованной cookie, в session() не попадает. */
    accessToken?: string;
  }
}

/**
 * Auth.js v5. Ключи берутся из env автоматически: AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET.
 * Сессия — JWT в зашифрованной cookie, базы для пользователей нет.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      // repo — читать PR в приватных репозиториях, read:org — список организаций
      authorization: { params: { scope: "read:user repo read:org" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    jwt({ token, account, profile }) {
      // account и profile есть только в момент входа
      if (account) token.accessToken = account.access_token;
      if (profile) token.login = profile.login as string;
      return token;
    },
    session({ session, token }) {
      // Это уходит в браузер через /api/auth/session — токен сюда не кладём
      session.user.login = token.login ?? "";
      return session;
    },
  },
});
