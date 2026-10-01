"use server";

import { cookies } from "next/headers";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { ALL, ORG_COOKIE, isOrgLogin } from "@/lib/org";
import { requireSession } from "@/lib/session";
import { signIn, signOut } from "@/auth";

export async function setOrgAction(org: string) {
  await requireSession();
  if (org !== ALL && !isOrgLogin(org)) throw new Error("Некорректная организация");
  (await cookies()).set(ORG_COOKIE, org, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}

/** Кнопка «↻»: выбросить кэш GitHub, следующий рендер пойдёт за свежими данными. */
export async function refreshGithubAction() {
  const { user } = await requireSession();
  updateTag(CACHE_TAGS.openPrs(user.login));
  updateTag(CACHE_TAGS.history(user.login));
}

export async function loginAction() {
  await signIn("github", { redirectTo: "/" });
}

export async function logoutAction() {
  (await cookies()).delete(ORG_COOKIE);
  await signOut({ redirectTo: "/login" });
}
