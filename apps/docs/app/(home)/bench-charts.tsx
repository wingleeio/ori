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

function MetricChart({
  title,
  values,
  format,
}: {
  title: string;
  values: (s: BenchSeries) => number[];
  format: (v: number) => string;
}) {
  const series = BENCH_SERIES.map((s) => ({ ...s, vals: values(s) }));
  const max = Math.max(...series.flatMap((s) => s.vals));
  const { niceMax, step } = niceScale(max);

  const W = 560;
  const H = 300;
  const m = { t: 14, r: 18, b: 34, l: 52 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const x = (i: number) => m.l + (pw * i) / (BENCH_SIZES.length - 1);
  const y = (v: number) => m.t + ph - (ph * v) / niceMax;

  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(v);

  return (
    <figure className="m-0">
      <figcaption className="ff-mono mb-2 text-[11px] uppercase tracking-[0.16em] text-fd-muted-foreground">
        {title}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {/* gridlines + y-axis labels */}
        {ticks.map((v) => (
          <g key={v}>
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
        {/* series lines + points */}
        {series.map((s) => (
          <g key={s.id}>
            <polyline
              points={s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={s.id === "ori" ? 2.5 : 1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.vals.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={s.id === "ori" ? 3 : 2.5} fill={s.color} />
            ))}
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function BenchCharts() {
  return (
    <div>
      {/* legend */}
      <div className="ff-mono mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fd-muted-foreground">
        {BENCH_SERIES.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: s.color }}
            />
            <span className={s.id === "ori" ? "font-medium text-fd-foreground" : ""}>{s.label}</span>
          </span>
        ))}
        <span className="ml-auto text-[11px] text-fd-muted-foreground/70">x-axis: blocks in the note</span>
      </div>

      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        <div>
          <MetricChart title="Main-thread render time (ms)" values={(s) => s.ms} format={(v) => `${v}`} />
          <p className="mt-2 text-sm text-fd-muted-foreground">
            At 5,000 blocks ori stays near <span className="text-fd-foreground">17ms</span>; the
            others range from <span className="text-fd-foreground">46 to 265ms</span>.
          </p>
        </div>
        <div>
          <MetricChart title="DOM nodes rendered" values={(s) => s.nodes} format={fmtNum} />
          <p className="mt-2 text-sm text-fd-muted-foreground">
            ori renders only the viewport — about <span className="text-fd-foreground">76 nodes</span>{" "}
            at any size. The others render the whole document.
          </p>
        </div>
      </div>

      <p className="ff-mono mt-7 text-[11px] leading-relaxed text-fd-muted-foreground/70">
        {BENCH_ENV}. Main-thread time to mount and lay out the same N-paragraph document (paint
        excluded). Below ~350 blocks Lexical's lighter core is faster by a few ms. Reproduce with{" "}
        <code className="text-fd-muted-foreground">apps/bench</code>.
      </p>
    </div>
  );
}
