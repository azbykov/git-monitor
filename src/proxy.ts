import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { devGithubToken } from "@/lib/dev-auth";

/**
 * Без сессии Auth.js — на /login. Это быстрая проверка для редиректа;
 * страницы и экшены всё равно проверяют сессию сами через requireSession().
 */
const withAuth = auth((request) => {
  if (!request.auth) return NextResponse.redirect(new URL("/login", request.nextUrl));
});

export function proxy(request: NextRequest, event: NextFetchEvent) {
  // next dev + DEV_GITHUB_TOKEN: вход не нужен (в production-сборке не срабатывает)
  if (devGithubToken()) return NextResponse.next();
  return withAuth(request, event as never);
}

export const config = {
  // Открыто без входа: страница входа, маршруты Auth.js и статика
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
