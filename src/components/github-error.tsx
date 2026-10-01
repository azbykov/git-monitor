import { GITHUB_UNAUTHORIZED } from "@/lib/session";

/** Ошибка загрузки из GitHub; если токен отозван — предлагаем войти заново. */
export function GithubError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600">
      {message.includes(GITHUB_UNAUTHORIZED) ? (
        <>
          GitHub больше не принимает ваш токен — возможно, доступ отозван.{" "}
          <a href="/login" className="font-medium underline">
            Войти заново
          </a>
        </>
      ) : (
        message
      )}
    </p>
  );
}
