import "server-only";
import postgres from "postgres";
import { databaseUrl } from "./db-url.mjs";

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

/** Один пул на процесс (в dev переживает hot reload). Работает и с Neon, и с локальным Postgres. */
export function db() {
  globalForDb.sql ??= postgres(databaseUrl(), { max: 5, idle_timeout: 20 });
  return globalForDb.sql;
}
