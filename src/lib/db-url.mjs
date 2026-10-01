/**
 * Neon отдаёт DATABASE_URL с `channel_binding=require` — это параметр libpq,
 * драйвер `postgres` его не знает и шлёт серверу как настройку сессии → «unrecognized configuration parameter».
 * Убираем его; шифрование соединения остаётся за счёт `sslmode=require`.
 * Файл .mjs, чтобы его импортировал и Next, и scripts/migrate.mts без сборки.
 */
export function databaseUrl(raw = process.env.DATABASE_URL) {
  if (!raw) throw new Error("DATABASE_URL не задан. Укажи строку подключения к Postgres в .env.local.");
  const url = new URL(raw);
  url.searchParams.delete("channel_binding");
  return url.toString();
}
