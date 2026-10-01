import { readFileSync } from "node:fs";
import postgres from "postgres";
import { databaseUrl } from "../src/lib/db-url.mjs";

const sql = postgres(databaseUrl(), { max: 1 });
await sql.unsafe(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
await sql.end();
console.log("Схема применена");
