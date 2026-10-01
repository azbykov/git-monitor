"use server";

import { revalidatePath } from "next/cache";
import { syncReviewComments } from "@/lib/comments";
import { analyzeFeedback } from "@/lib/feedback";
import { getSelectedOrg } from "@/lib/org";
import { requireSession } from "@/lib/session";

// Экшены доступны по прямому POST, поэтому каждый сам проверяет сессию.

export type ActionState = { ok: boolean; message: string } | null;

const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function syncAction(): Promise<ActionState> {
  const { user } = await requireSession(); // вне try: redirect() работает через исключение
  try {
    const { fetched, inserted } = await syncReviewComments(user);
    revalidatePath("/feedback");
    return { ok: true, message: `Получено ${fetched} замечаний, новых — ${inserted}` };
  } catch (e) {
    return fail(e);
  }
}

export async function analyzeAction(): Promise<ActionState> {
  const { user } = await requireSession();
  try {
    const { commentsCount, result } = await analyzeFeedback(user.login, await getSelectedOrg());
    revalidatePath("/feedback");
    return { ok: true, message: `Разобрано ${commentsCount} замечаний, тем: ${result.themes.length}` };
  } catch (e) {
    return fail(e);
  }
}
