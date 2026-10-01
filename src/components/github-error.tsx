import { GITHUB_UNAUTHORIZED } from "@/lib/session";

/**
 * Ошибка загрузки из GitHub. `unauthorized` — токен не принят: предлагаем войти заново.
 * Текст прочих ошибок из кэшируемых функций Next в production скрывает, поэтому показываем общий.
 */
export function GithubError({ error, unauthorized }: { error?: unknown; unauthorized?: boolean }) {
  const message = error instanceof Error ? error.message : error ? String(error) : "";
  const isAuth = unauthorized || message.includes(GITHUB_UNAUTHORIZED);
  const isRedacted = message.includes("omitted in production");
  return (
    <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600">
      {isAuth ? (
        <>
          GitHub не принимает ваш токен — возможно, доступ отозван.{" "}
          <a href="/login" className="font-medium underline">
            Войти заново
          </a>
        </>
      ) : isRedacted || !message ? (
        "Не удалось загрузить данные из GitHub. Попробуйте обновить страницу чуть позже."
      ) : (
        message
      )}
    </p>
  );
}
