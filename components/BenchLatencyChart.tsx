import type { BenchRun } from '@/app/api/spine-bench/route';

type Props = {
  runs: BenchRun[];
  height?: number;
};

// Pure SVG. Log-scale X (scale), linear Y (latency ms). Three lines: p50, p95, p99.
export function BenchLatencyChart({ runs, height = 280 }: Props) {
  if (runs.length === 0) {
    return (
      <div className="border border-cream/[0.08] p-8 font-mono text-[11px] uppercase tracking-widest text-cream/35">
        No bench runs yet. Run <span className="text-amber">node scripts/scale-bench.mjs</span>.
      </div>
    );
  }

  const width = 720;
  const padding = { top: 30, right: 40, bottom: 50, left: 56 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const minScale = Math.max(1, Math.min(...runs.map((r) => r.scale)));
  const maxScale = Math.max(1, Math.max(...runs.map((r) => r.scale)));
  const logMin = Math.log10(minScale);
  const logMax = Math.log10(Math.max(maxScale, minScale * 10));

  const maxLat = Math.max(10, Math.max(...runs.map((r) => r.p99_latency_ms)) * 1.1);

  const xFor = (scale: number) => {
    const l = Math.log10(Math.max(1, scale));
    const t = logMax === logMin ? 0.5 : (l - logMin) / (logMax - logMin);
    return padding.left + t * plotW;
  };
  const yFor = (ms: number) => padding.top + plotH - (ms / maxLat) * plotH;

  const series = [
    { key: 'p99', color: '#E89A3C', get: (r: BenchRun) => r.p99_latency_ms, label: 'p99' },
    { key: 'p95', color: 'rgba(232, 154, 60, 0.55)', get: (r: BenchRun) => r.p95_latency_ms, label: 'p95' },
    { key: 'p50', color: 'rgba(232, 228, 221, 0.4)', get: (r: BenchRun) => r.p50_latency_ms, label: 'p50' },
  ];

  const sorted = [...runs].sort((a, b) => a.scale - b.scale);

  // X-axis ticks at each full decade within range.
  const decades: number[] = [];
  for (let d = Math.ceil(logMin); d <= Math.floor(logMax); d++) {
    decades.push(Math.pow(10, d));
  }

  // Y-axis ticks at clean round numbers.
  const yTicks = [0, Math.round(maxLat * 0.25), Math.round(maxLat * 0.5), Math.round(maxLat * 0.75), Math.round(maxLat)];

  return (
    <div className="border border-cream/[0.08] bg-cream/[0.015] p-5 md:p-7 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Latency vs scale">
        {/* Y-axis grid + labels */}
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line
              x1={padding.left}
              x2={padding.left + plotW}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="rgba(232, 228, 221, 0.06)"
              strokeWidth="1"
            />
            <text
              x={padding.left - 10}
              y={yFor(t) + 4}
              textAnchor="end"
              fontFamily="monospace"
              fontSize="10"
              fill="rgba(232, 228, 221, 0.35)"
            >
              {t}ms
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {decades.map((d) => (
          <g key={`x-${d}`}>
            <line
              x1={xFor(d)}
              x2={xFor(d)}
              y1={padding.top + plotH}
              y2={padding.top + plotH + 5}
              stroke="rgba(232, 228, 221, 0.2)"
            />
            <text
              x={xFor(d)}
              y={padding.top + plotH + 18}
              textAnchor="middle"
              fontFamily="monospace"
              fontSize="10"
              fill="rgba(232, 228, 221, 0.35)"
            >
              {formatScale(d)}
            </text>
          </g>
        ))}

        {/* Axis title */}
        <text
          x={padding.left + plotW / 2}
          y={height - 10}
          textAnchor="middle"
          fontFamily="monospace"
          fontSize="10"
          fill="rgba(232, 228, 221, 0.45)"
          style={{ textTransform: 'uppercase', letterSpacing: '0.2em' }}
        >
          Memories indexed (log)
        </text>

        {/* Series lines */}
        {series.map((s) => (
          <g key={s.key}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              points={sorted
                .map((r) => `${xFor(r.scale).toFixed(1)},${yFor(s.get(r)).toFixed(1)}`)
                .join(' ')}
            />
            {sorted.map((r, i) => (
              <circle
                key={`${s.key}-${i}`}
                cx={xFor(r.scale)}
                cy={yFor(s.get(r))}
                r="3.5"
                fill={s.color}
              />
            ))}
          </g>
        ))}

        {/* Legend */}
        <g>
          {series.map((s, i) => (
            <g key={s.key} transform={`translate(${padding.left + i * 70}, ${padding.top - 16})`}>
              <circle cx="0" cy="0" r="3.5" fill={s.color} />
              <text
                x="8"
                y="3"
                fontFamily="monospace"
                fontSize="10"
                fill="rgba(232, 228, 221, 0.6)"
                style={{ textTransform: 'uppercase', letterSpacing: '0.2em' }}
              >
                {s.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function formatScale(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}k`;
  return String(n);
}
