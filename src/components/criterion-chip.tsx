import type { Criterion } from "@/lib/attention";

const CHIP: Record<Criterion["status"], { cls: string; icon: string; sr: string }> = {
  ok: {
    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    icon: "✓",
    sr: "в порядке",
  },
  wait: { cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400", icon: "◷", sr: "ожидание" },
  bad: { cls: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400", icon: "✗", sr: "проблема" },
  none: { cls: "border-zinc-300 bg-zinc-500/5 text-zinc-500 dark:border-zinc-700", icon: "–", sr: "нет данных" },
};

/** Один критерий: иконка + текст, чтобы статус читался не только по цвету. */
export function CriterionChip({ c }: { c: Pick<Criterion, "status" | "label" | "hint"> }) {
  const s = CHIP[c.status];
  return (
    <li
      title={c.hint}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs ${s.cls}`}
    >
      <span aria-hidden>{s.icon}</span>
      <span className="sr-only">{s.sr}:</span>
      <span className="truncate">{c.label}</span>
    </li>
  );
}

