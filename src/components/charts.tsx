"use client";

import { useRef, useState } from "react";
import { formatHours } from "@/lib/time";

export type Unit = "count" | "hours";
const FORMAT: Record<Unit, (v: number) => string> = {
  count: (v) => String(Math.round(v * 10) / 10),
  hours: (v) => (v ? formatHours(v) : "0"),
};

export type Series = { key: string; label: string; color: string };

type TipState = { x: number; y: number; title: string; rows: Array<{ label: string; value: string; color?: string }> } | null;

function Tooltip({ tip }: { tip: TipState }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-32 -translate-x-1/2 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs shadow-md"
      style={{
        left: tip.x,
        top: tip.y - 8,
        background: "var(--viz-surface)",
        borderColor: "var(--viz-border)",
        color: "var(--viz-ink)",
      }}
    >
      <div className="mb-0.5 font-medium">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5" style={{ color: "var(--viz-ink-2)" }}>
          {r.color && <span className="inline-block size-2 rounded-sm" style={{ background: r.color }} />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 tabular-nums" style={{ color: "var(--viz-ink)" }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--viz-ink-2)" }}>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Вертикальные столбцы, несколько серий рядом (grouped). Ховер — по всей группе. */
export function Columns<T extends Record<string, string | number | null>>({
  data,
  x,
  series,
  unit = "count",
  height = 180,
}: {
  data: T[];
  x: keyof T;
  series: Series[];
  unit?: Unit;
  height?: number;
}) {
  const format = FORMAT[unit];
  const [tip, setTip] = useState<TipState>(null);
  const root = useRef<HTMLDivElement>(null);
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0)))));
  const ticks = [0, max / 2, max];

  return (
    <div ref={root} className="relative" onMouseLeave={() => setTip(null)}>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-right text-[10px] tabular-nums" style={{ height, color: "var(--viz-muted)" }}>
          {ticks.toReversed().map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 h-px"
              style={{ bottom: (t / max) * height, background: t === 0 ? "var(--viz-axis)" : "var(--viz-grid)" }}
            />
          ))}
          <div className="relative flex items-end" style={{ height }}>
            {data.map((d, i) => (
              <div
                key={i}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 rounded-sm px-1 hover:bg-current/5"
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const p = root.current!.getBoundingClientRect();
                  setTip({
                    x: r.left - p.left + r.width / 2,
                    y: r.top - p.top + 12,
                    title: String(d[x]),
                    rows: series.map((s) => ({
                      label: s.label,
                      color: s.color,
                      value: d[s.key] === null ? "—" : format(Number(d[s.key])),
                    })),
                  });
                }}
              >
                {series.map((s) => {
                  const v = Number(d[s.key] ?? 0);
                  return (
                    <div
                      key={s.key}
                      className="min-w-[3px] max-w-6 flex-1 rounded-t"
                      style={{ height: v ? Math.max(2, (v / max) * height) : 0, background: s.color }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-1 flex text-[10px]" style={{ color: "var(--viz-muted)" }}>
            {data.map((d, i) => (
              <span key={i} className="flex-1 truncate text-center">
                {data.length > 8 && i % 2 ? "" : String(d[x])}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Горизонтальные полосы; несколько серий складываются в стек. */
export function HBars<T extends Record<string, string | number | null>>({
  data,
  y,
  series,
  unit = "count",
  showTotal = true,
  mono = true,
}: {
  data: T[];
  y: keyof T;
  series: Series[];
  unit?: Unit;
  showTotal?: boolean;
  /** Подписи моноширинным (имена репозиториев) или обычным шрифтом (текст) */
  mono?: boolean;
}) {
  const format = FORMAT[unit];
  const [tip, setTip] = useState<TipState>(null);
  const root = useRef<HTMLDivElement>(null);
  const total = (d: T) => series.reduce((sum, s) => sum + Number(d[s.key] ?? 0), 0);
  const max = Math.max(1, ...data.map(total));

  return (
    <div ref={root} className="relative space-y-1.5" onMouseLeave={() => setTip(null)}>
      {data.map((d, i) => {
        const sum = total(d);
        return (
          <div
            key={i}
            className={`grid items-center gap-3 rounded-sm text-xs hover:bg-current/5 ${mono ? "grid-cols-[minmax(0,9rem)_1fr]" : "grid-cols-[minmax(0,14rem)_1fr]"}`}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const p = root.current!.getBoundingClientRect();
              setTip({
                x: r.left - p.left + r.width / 2,
                y: r.top - p.top,
                title: String(d[y]),
                rows: series
                  .filter((s) => d[s.key] !== null && (series.length === 1 || Number(d[s.key]) > 0))
                  .map((s) => ({ label: s.label, color: s.color, value: format(Number(d[s.key])) })),
              });
            }}
          >
            <span className={`truncate text-right ${mono ? "font-mono" : ""}`} style={{ color: "var(--viz-ink-2)" }} title={String(d[y])}>
              {String(d[y])}
            </span>
            <div className="flex items-center gap-2">
              <div className="flex h-4 gap-[2px]" style={{ width: `${(sum / max) * 100}%` }}>
                {series.map((s) => {
                  const v = Number(d[s.key] ?? 0);
                  if (!v) return null;
                  return (
                    <div
                      key={s.key}
                      className="h-full first:rounded-l-sm last:rounded-r"
                      style={{ flexGrow: v, flexBasis: 0, minWidth: 2, background: s.color }}
                    />
                  );
                })}
              </div>
              {showTotal && (
                <span className="shrink-0 tabular-nums" style={{ color: "var(--viz-ink-2)" }}>
                  {sum ? format(sum) : "—"}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
}
