import "server-only";
import { Agent, getDefaultModel, run } from "@openai/agents";
import type postgres from "postgres";
import { z } from "zod";
import { db } from "./db";
import { listReviewComments, type ReviewComment } from "./comments";

const MAX_COMMENTS = 400;
const MAX_BODY = 600;

/** Что возвращает модель. Количество НЕ просим — модель считает плохо, считаем сами по assignments. */
const LlmOutput = z.object({
  themes: z
    .array(
      z.object({
        key: z.string().describe("короткий латинский slug, например missing-tests"),
        title: z.string().describe("название темы по-русски, 2–5 слов"),
        description: z.string().describe("что именно ревьюеры замечают, 1–2 предложения"),
        advice: z.string().describe("конкретная привычка, которая предотвратит такие замечания"),
      }),
    )
    .describe("5–10 повторяющихся тем"),
  assignments: z
    .array(z.object({ c: z.string().describe("id комментария, например c12"), theme: z.string() }))
    .describe("тема для КАЖДОГО комментария: key темы, 'other' или 'noise'"),
  checklist: z.array(z.string()).describe("5–10 пунктов самопроверки перед открытием PR, самые частые — первыми"),
});

export type FeedbackTheme = {
  key: string;
  title: string;
  description: string;
  advice: string;
  count: number;
  commentIds: string[];
};

export type FeedbackResult = {
  themes: FeedbackTheme[];
  checklist: string[];
  otherCount: number;
  noiseCount: number;
};

export type FeedbackAnalysis = {
  id: number;
  createdAt: string;
  model: string;
  commentsCount: number;
  periodFrom: string;
  periodTo: string;
  result: FeedbackResult;
};

const MODEL = process.env.OPENAI_MODEL || getDefaultModel();

const agent = new Agent({
  name: "Review feedback analyst",
  instructions: `Тебе дают замечания, которые ревьюеры оставили на pull request'ы одного разработчика.
Задача — найти повторяющиеся паттерны в ЕГО ошибках, чтобы он перестал их допускать.

Правила:
- Выдели 5–10 тем. Тема должна быть про привычку автора (тесты, обработка ошибок, нейминг,
  типизация, производительность, структура PR, описание PR и т.п.), а не про конкретный файл.
- Присвой КАЖДОМУ комментарию ровно одну тему по его id.
- 'noise' — не замечание: «LGTM», «спасибо», вопросы ради уточнения, обсуждение без претензии.
- 'other' — замечание, которое не вписывается ни в одну тему.
- Комментарии могут быть на любом языке; отвечай по-русски.`,
  model: MODEL,
  outputType: LlmOutput,
});

/** Сопоставляет короткие id из ответа модели с комментариями и считает темы сами. */
export function tally(comments: ReviewComment[], output: z.infer<typeof LlmOutput>): FeedbackResult {
  const byTheme = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const a of output.assignments) {
    const comment = comments[Number(a.c.replace(/^c/, ""))];
    if (!comment || seen.has(comment.id)) continue; // модель могла повторить id
    seen.add(comment.id);
    byTheme.set(a.theme, [...(byTheme.get(a.theme) ?? []), comment.id]);
  }
  const known = new Set(output.themes.map((t) => t.key));
  const unassigned = comments.length - seen.size;
  const unknown = [...byTheme].filter(([k]) => !known.has(k) && k !== "noise").flatMap(([, ids]) => ids);

  return {
    themes: output.themes
      .map((t) => ({ ...t, commentIds: byTheme.get(t.key) ?? [], count: byTheme.get(t.key)?.length ?? 0 }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count),
    checklist: output.checklist,
    otherCount: unknown.length + unassigned,
    noiseCount: byTheme.get("noise")?.length ?? 0,
  };
}

function toPrompt(comments: ReviewComment[]) {
  return comments
    .map((c, i) => {
      const where = c.path ? `${c.repo} · ${c.path}` : `${c.repo} · общее ревью`;
      const body = c.body.replace(/\s+/g, " ").slice(0, MAX_BODY);
      return `[c${i}] (${where}) ${body}`;
    })
    .join("\n");
}

/** AI-анализ пока скрыт: включается переменной AI_ANALYSIS_ENABLED=true. */
export const aiAnalysisEnabled = () => process.env.AI_ANALYSIS_ENABLED === "true";

export async function analyzeFeedback(login: string, org: string | null, days = 180): Promise<FeedbackAnalysis> {
  if (!aiAnalysisEnabled()) throw new Error("AI-анализ выключен");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не задан");

  const comments = (await listReviewComments(login, org, days)).slice(0, MAX_COMMENTS);
  if (comments.length < 5) throw new Error("Слишком мало замечаний для анализа — сначала синхронизируй");

  const { finalOutput } = await run(agent, `Замечаний: ${comments.length}\n\n${toPrompt(comments)}`);
  if (!finalOutput) throw new Error("Модель не вернула результат");

  const result = tally(comments, finalOutput);

  const sql = db();
  const [row] = await sql`
    insert into feedback_analyses (user_login, org, model, comments_count, period_from, period_to, result)
    values (
      ${login},
      ${org ?? ""},
      ${MODEL},
      ${comments.length},
      ${comments.at(-1)!.createdAt},
      ${comments[0].createdAt},
      ${sql.json(result as unknown as postgres.JSONValue)}
    )
    returning id, created_at
  `;
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    model: MODEL,
    commentsCount: comments.length,
    periodFrom: comments.at(-1)!.createdAt,
    periodTo: comments[0].createdAt,
    result,
  };
}

export async function latestAnalysis(login: string, org: string | null): Promise<FeedbackAnalysis | null> {
  const [row] = await db()`
    select id, created_at, model, comments_count, period_from, period_to, result
    from feedback_analyses where user_login = ${login} and org = ${org ?? ""}
    order by created_at desc limit 1
  `;
  if (!row) return null;
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    model: row.model,
    commentsCount: row.comments_count,
    periodFrom: new Date(row.period_from).toISOString(),
    periodTo: new Date(row.period_to).toISOString(),
    result: row.result as FeedbackResult,
  };
}
