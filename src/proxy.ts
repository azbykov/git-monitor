import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Без сессии Auth.js — на /login. Это быстрая проверка для редиректа;
 * страницы и экшены всё равно проверяют сессию сами через requireSession().
 */
export const proxy = auth((request) => {
  if (!request.auth) return NextResponse.redirect(new URL("/login", request.nextUrl));
});

export const config = {
  // Открыто без входа: страница входа, маршруты Auth.js и статика
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
