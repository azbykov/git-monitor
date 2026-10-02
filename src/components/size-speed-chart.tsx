"use client";

import { useEffect, useRef, useState } from "react";
import type { SizeSpeedPoint, SizeStat } from "@/lib/analytics";
import { formatHours } from "@/lib/time";

type Metric = "ttfr" | "ttm";
const METRICS: Record<Metric, { label: string; median: keyof SizeStat; empty: string }> = {
  ttfr: { label: "До первого ревью", median: "medianTtfr", empty: "без ревью (включая смерженные без него)" },
  ttm: { label: "До мержа", median: "medianTtm", empty: "не смержены или смержены без ревью" },
};

const HEIGHT = 300;
const M = { top: 22, right: 12, bottom: 30, left: 52 };
const SIZE_EDGES = [50, 250, 1000]; // границы S | M | L | XL — как в bySize
const X_TICKS = [1, 10, 100, 1000, 10000, 100000];
const Y_TICKS = [1, 4, 24, 72, 240, 720, 2400]; // рабочие часы: 1 ч … 100 дн

const log = Math.log10;
const fmtLines = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));

/**
 * Каждый PR — точка: по X размер (добавлено + удалено строк), по Y время в рабочих часах.
 * Обе оси логарифмические: размеры от единиц до десятков тысяч строк, время — от часа до сотен дней.
 */
export function SizeSpeedChart({ points, groups }: { points: SizeSpeedPoint[]; groups: SizeStat[] }) {
  const [metric, setMetric] = useState<Metric>("ttfr");
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = points.filter((p) => p[metric] !== null);
  const missing = points.length - shown.length;

  const maxX = Math.max(10000, ...shown.map((p) => p.size)); // у группы XL всегда есть место на оси
  const maxY = Math.max(24, ...shown.map((p) => p[metric]!));
  const x0 = 0; // log10(1)
  const x1 = Math.ceil(log(maxX));
  const y1 = log(maxY) * 1.05;
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  // Округляем до 0,1 px: сервер и браузер считают log10 с разницей в последнем знаке → ошибка гидратации
  const px = (v: number) => Math.round(v * 10) / 10;
  const sx = (v: number) => px(M.left + ((log(Math.max(1, v)) - x0) / (x1 - x0)) * plotW);
  const sy = (h: number) => px(M.top + plotH - (log(Math.max(1, h)) / y1) * plotH);

  const pixel = shown.map((p) => ({ p, x: sx(p.size), y: sy(p[metric]!) }));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best = -1;
    let bestD = 14 * 14; // радиус попадания больше самой точки
    pixel.forEach((d, i) => {
      const dist = (d.x - mx) ** 2 + (d.y - my) ** 2;
      if (dist < bestD) [best, bestD] = [i, dist];
    });
    setHover(best >= 0 ? best : null);
  }

  const edgesX = [1, ...SIZE_EDGES, 10 ** x1].map(sx);
  const h = hover !== null ? pixel[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Метрика" className="inline-flex rounded-md border border-zinc-200 p-0.5 text-xs dark:border-zinc-800">
          {(Object.keys(METRICS) as Metric[]).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={metric === k}
              onClick={() => {
                setMetric(k);
                setHover(null);
              }}
              className={`rounded px-2.5 py-1 ${
                metric === k ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {METRICS[k].label}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 text-xs" style={{ color: "var(--viz-ink-2)" }}>
          <li className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: "var(--series-1)" }} /> PR
          </li>
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3" style={{ background: "var(--series-2)" }} /> медиана группы
          </li>
        </ul>
      </div>

      <div ref={box} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Размер PR и время ${METRICS[metric].label.toLowerCase()}: ${shown.length} PR`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => h && window.open(h.p.url, "_blank", "noopener")}
          style={{ cursor: h ? "pointer" : "default", display: "block" }}
        >
          {/* сетка по Y */}
          {Y_TICKS.filter((t) => log(t) <= y1).map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke={t === 1 ? "var(--viz-axis)" : "var(--viz-grid)"} />
              <text x={M.left - 6} y={sy(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--viz-muted)">
                {formatHours(t)}
              </text>
            </g>
          ))}
          {/* ось X */}
          {X_TICKS.filter((t) => log(t) <= x1).map((t) => (
            <text key={t} x={sx(t)} y={HEIGHT - M.bottom + 14} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">
              {fmtLines(t)}
            </text>
          ))}
          <text x={width - M.right} y={HEIGHT - 4} textAnchor="end" fontSize={10} fill="var(--viz-muted)">
            строк в PR →
          </text>

          {/* группы S/M/L/XL и их медианы */}
          {groups.map((g, i) => {
            const [a, b] = [edgesX[i], edgesX[i + 1]];
            const med = g[METRICS[metric].median] as number | null;
            return (
              <g key={g.label}>
                {i > 0 && <line x1={a} x2={a} y1={M.top} y2={M.top + plotH} stroke="var(--viz-grid)" />}
                <text x={(a + b) / 2} y={M.top - 8} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">
                  {g.label}
                </text>
                {med !== null && (
                  <line x1={a + 4} x2={b - 4} y1={sy(med)} y2={sy(med)} stroke="var(--series-2)" strokeWidth={2} strokeLinecap="round" />
                )}
              </g>
            );
          })}

          {/* точки: полупрозрачные, с кольцом цвета фона — так видно наложения */}
          {pixel.map((d, i) => (
            <circle
              key={d.p.url}
              cx={d.x}
              cy={d.y}
              r={i === hover ? 6 : 4.5}
              fill="var(--series-1)"
              fillOpacity={i === hover ? 1 : 0.55}
              stroke="var(--viz-surface)"
              strokeWidth={1.5}
            />
          ))}
        </svg>

        {h && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: Math.min(Math.max(h.x, 120), width - 120),
              top: h.y - 10,
              background: "var(--viz-surface)",
              borderColor: "var(--viz-border)",
              color: "var(--viz-ink)",
            }}
          >
            <div className="font-mono" style={{ color: "var(--viz-ink-2)" }}>
              {h.p.repo}#{h.p.number}
            </div>
            <div className="line-clamp-2 font-medium">{h.p.title}</div>
            <div className="mt-0.5 tabular-nums" style={{ color: "var(--viz-ink-2)" }}>
              {h.p.size.toLocaleString("ru")} строк · {METRICS[metric].label.toLowerCase()}: {formatHours(h.p[metric]!)}
            </div>
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {groups.map((g) => {
          const med = g[METRICS[metric].median] as number | null;
          return (
            <div key={g.label} className="rounded-md bg-zinc-500/5 px-2.5 py-1.5">
              <dt style={{ color: "var(--viz-ink-2)" }}>
                {g.label} · {g.hint} · {g.prs} PR
              </dt>
              <dd className="text-sm font-medium tabular-nums">{med === null ? "—" : formatHours(med)}</dd>
            </div>
          );
        })}
      </dl>
      {missing > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--viz-muted)" }}>
          {missing} PR {METRICS[metric].empty} — их нет на графике. Время — в рабочих часах, медиана по группе размера.
        </p>
      )}
    </div>
  );
}
