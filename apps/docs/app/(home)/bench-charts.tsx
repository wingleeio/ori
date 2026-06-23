"use client";

import { useEffect, useRef, useState } from "react";
import { BENCH_ENV, BENCH_SERIES, BENCH_SIZES, type BenchSeries } from "./bench-data";

const fmtSize = (n: number) => (n >= 1000 ? `${n / 1000}k` : `${n}`);
const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString()}k` : `${n}`);

/** A "nice" axis max + step giving ~4–6 gridlines. */
function niceScale(max: number): { niceMax: number; step: number } {
  const rough = max / 4 || 1;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { niceMax: Math.ceil(max / step) * step, step };
}

/** Tween a value toward `target` with easeOutCubic — drives the y-axis rescale
 *  when series are toggled, so the lines glide to the new scale. */
function useTween(target: number): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    let start = 0;
    const dur = 450;
    const tick = (t: number) => {
      if (!start) start = t;
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - (1 - k) ** 3;
      const cur = from + (to - from) * eased;
      fromRef.current = cur;
      setVal(cur);
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);
  return val;
}

function MetricChart({
  title,
  values,
  format,
  hidden,
  played,
}: {
  title: string;
  values: (s: BenchSeries) => number[];
  format: (v: number) => string;
  hidden: Set<string>;
  played: boolean;
}) {
  const series = BENCH_SERIES.map((s) => ({ ...s, vals: values(s) }));
  // Floor is tiny (just avoids a 0 scale) so the sub-millisecond typing chart can
  // zoom in when the slow series are toggled off.
  const visibleMax = Math.max(...series.filter((s) => !hidden.has(s.id)).flatMap((s) => s.vals), 0.01);
  const { niceMax, step } = niceScale(visibleMax);
  const animMax = useTween(niceMax);

  const W = 560;
  const H = 300;
  const m = { t: 14, r: 18, b: 34, l: 52 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const x = (i: number) => m.l + (pw * i) / (BENCH_SIZES.length - 1);
  const y = (v: number) => m.t + ph - (ph * v) / animMax;

  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(v);

  return (
    <figure className="m-0">
      <figcaption className="ff-mono mb-2 text-[11px] uppercase tracking-[0.16em] text-fd-muted-foreground">
        {title}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {/* gridlines + y-axis labels (positions glide as the scale rescales) */}
        {ticks.map((v) => (
          <g key={v} style={{ transition: "opacity 250ms", opacity: 1 }}>
            <line
              x1={m.l}
              y1={y(v)}
              x2={W - m.r}
              y2={y(v)}
              stroke="var(--color-fd-border)"
              strokeWidth={1}
            />
            <text
              x={m.l - 8}
              y={y(v) + 3}
              textAnchor="end"
              className="ff-mono"
              fontSize={10}
              fill="var(--color-fd-muted-foreground)"
            >
              {format(v)}
            </text>
          </g>
        ))}
        {/* x-axis labels */}
        {BENCH_SIZES.map((s, i) => (
          <text
            key={s}
            x={x(i)}
            y={H - 12}
            textAnchor="middle"
            className="ff-mono"
            fontSize={10}
            fill="var(--color-fd-muted-foreground)"
          >
            {fmtSize(s)}
          </text>
        ))}
        {/* series — all rendered; hidden ones fade out and drop out of the scale */}
        {series.map((s, si) => {
          const isHidden = hidden.has(s.id);
          const isOri = s.id === "ori";
          return (
            <g
              key={s.id}
              style={{ opacity: isHidden ? 0 : 1, transition: "opacity 300ms ease" }}
              aria-hidden={isHidden}
            >
              <polyline
                points={s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={isOri ? 2.5 : 1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                style={{
                  strokeDasharray: 1,
                  strokeDashoffset: played ? 0 : 1,
                  transition: `stroke-dashoffset 900ms ease ${si * 80}ms`,
                }}
              />
              {s.vals.map((v, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(v)}
                  r={isOri ? 3 : 2.5}
                  fill={s.color}
                  style={{
                    opacity: played ? 1 : 0,
                    transition: `opacity 250ms ease ${si * 80 + 500}ms`,
                  }}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function BenchCharts() {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [played, setPlayed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Play the draw-in once the charts scroll into view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPlayed(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      // keep at least one series visible
      else if (BENCH_SERIES.length - next.size > 1) next.add(id);
      return next;
    });

  return (
    <div ref={rootRef}>
      {/* legend — click to toggle a series on/off */}
      <div className="ff-mono mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
        {BENCH_SERIES.map((s) => {
          const off = hidden.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              aria-pressed={!off}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 transition-colors ${
                off
                  ? "border-fd-border text-fd-muted-foreground/50"
                  : "border-fd-border bg-fd-muted/40 text-fd-foreground"
              }`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full transition-opacity"
                style={{ background: s.color, opacity: off ? 0.3 : 1 }}
              />
              <span className={off ? "line-through" : s.id === "ori" ? "font-medium" : ""}>
                {s.label}
              </span>
            </button>
          );
        })}
        <span className="ml-auto self-center text-[11px] text-fd-muted-foreground/70">
          tap to toggle · x-axis: blocks in the note
        </span>
      </div>

      <p className="ff-mono mb-4 text-[11px] uppercase tracking-[0.16em] text-fd-foreground">
        Loading
      </p>
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        <div>
          <MetricChart
            title="Main-thread render time (ms)"
            values={(s) => s.ms}
            format={(v) => `${Math.round(v)}`}
            hidden={hidden}
            played={played}
          />
          <p className="mt-2 text-sm text-fd-muted-foreground">
            CodeMirror is fastest — virtualized, with a lightweight document model. ori virtualizes
            its rendering too, but building its CRDT document is O(n), so its time grows to{" "}
            <span className="text-fd-foreground">~17ms</span> at 5,000 blocks — still well under the
            full-render editors (<span className="text-fd-foreground">46–260ms</span>).
          </p>
        </div>
        <div>
          <MetricChart
            title="DOM nodes rendered"
            values={(s) => s.nodes}
            format={fmtNum}
            hidden={hidden}
            played={played}
          />
          <p className="mt-2 text-sm text-fd-muted-foreground">
            ori (<span className="text-fd-foreground">~76</span>) and CodeMirror (
            <span className="text-fd-foreground">~41</span>) render only the viewport at any size.
            The others render every block.
          </p>
        </div>
      </div>

      <p className="ff-mono mb-4 mt-12 text-[11px] uppercase tracking-[0.16em] text-fd-foreground">
        Typing
      </p>
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2 md:items-center">
        <MetricChart
          title="Scripting time per keystroke (ms)"
          values={(s) => s.editMs}
          format={(v) => `${Math.round(v * 10) / 10}`}
          hidden={hidden}
          played={played}
        />
        <div className="text-sm text-fd-muted-foreground">
          <p>
            Here virtualization pays off for ori: typing only re-renders the block you&apos;re in, so
            it stays flat at <span className="text-fd-foreground">~0.3ms/keystroke</span> whether the
            note has 100 or 5,000 blocks.
          </p>
          <p className="mt-3">
            CodeMirror and Lexical are a touch faster; TipTap and Quill creep up. Slate re-renders the
            whole document on every keystroke — <span className="text-fd-foreground">~25ms at 5,000
            blocks</span>, where typing visibly lags. Toggle the others off to compare the fast ones.
          </p>
        </div>
      </div>

      <p className="ff-mono mt-9 text-[11px] leading-relaxed text-fd-muted-foreground/70">
        {BENCH_ENV}. <span className="text-fd-muted-foreground">Loading:</span> main-thread time to
        mount + lay out the document (paint excluded).{" "}
        <span className="text-fd-muted-foreground">Typing:</span> main-thread scripting time per
        keystroke (beforeinput + input handlers), typing real characters — lower is snappier.
        CodeMirror renders plain text here (it also powers Obsidian&apos;s rich text); ori is a rich
        block editor with built-in CRDT collaboration. Absolute ms vary by machine. Reproduce with{" "}
        <code className="text-fd-muted-foreground">apps/bench</code>.
      </p>
    </div>
  );
}
