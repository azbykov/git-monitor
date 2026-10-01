/**
 * Локальная разработка без OAuth: в `next dev` с DEV_GITHUB_TOKEN приложение работает от этого токена
 * и не требует входа. В production-сборке NODE_ENV === "production", так что обход невозможен.
 * Отдельный модуль без server-only — его импортирует и proxy.
 */
export function devGithubToken(): string | null {
  if (process.env.NODE_ENV !== "development") return null;
  return process.env.DEV_GITHUB_TOKEN || null;
}
