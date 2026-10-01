/**
 * Теги кэша запросов к GitHub. Кэшируемые функции помечены `"use cache: remote"`:
 * локально это память dev-сервера, на Vercel — общий кэш, переживающий перезапуски функций.
 */
/**
 * Результат кэшируемого запроса + когда он реально был получен из GitHub.
 * `unauthorized` — GitHub не принял токен. Это значение, а не исключение: в production Next скрывает
 * текст ошибок из кэшируемых функций, и страница не смогла бы отличить его от прочих сбоев.
 */
export type Fetched<T> = { items: T[]; fetchedAt: string; unauthorized?: true };

export const unauthorized = <T>(): Fetched<T> => ({ items: [], fetchedAt: new Date().toISOString(), unauthorized: true });

/** Теги — на пользователя: «↻» одного человека не сбрасывает кэш остальным. */
export const CACHE_TAGS = {
  openPrs: (login: string) => `github:open-prs:${login}`, // cacheLife("minutes"): 1 мин свежие, потом отдаём старое и обновляем в фоне
  history: (login: string) => `github:history:${login}`, // cacheLife("hours")
  orgs: (login: string) => `github:orgs:${login}`, // cacheLife("days")
};
