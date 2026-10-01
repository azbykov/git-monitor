"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshGithubAction } from "@/app/actions";

/**
 * Раз в `seconds` перерисовывает страницу (данные приходят из кэша, он сам обновляется в фоне).
 * Кнопка сбрасывает кэш GitHub и грузит свежие данные.
 */
export function AutoRefresh({ fetchedAt, seconds = 120 }: { fetchedAt: string; seconds?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  const time = new Date(fetchedAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });

  return (
    <button
      onClick={() => startTransition(() => refreshGithubAction())}
      title="Сбросить кэш и загрузить свежие данные из GitHub"
      disabled={pending}
      className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
    >
      {pending ? "Обновляю…" : <span suppressHydrationWarning>↻ {time}</span>}
    </button>
  );
}
