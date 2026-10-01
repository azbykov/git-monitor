import "server-only";
import postgres from "postgres";

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

/** Один пул на процесс (в dev переживает hot reload). Работает и с Neon, и с локальным Postgres. */
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан. Укажи строку подключения к Postgres в .env.local.");
  globalForDb.sql ??= postgres(url, { max: 5, idle_timeout: 20 });
  return globalForDb.sql;
}
