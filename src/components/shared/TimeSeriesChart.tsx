import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

export interface TimeSeriesChartSeries {
  key: string;
  label: string;
  color: string;
  points: { ts: number; value: number }[];
}

interface TimeSeriesChartProps {
  series: TimeSeriesChartSeries[];
  height?: number;
  formatValue?: (v: number) => string;
}

const PAD_LEFT = 44;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 24;
const FALLBACK_WIDTH = 600; // used only for the first render, before ResizeObserver reports the real width

function defaultFormatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function nearestPoint(points: { ts: number; value: number }[], ts: number): { ts: number; value: number } | null {
  let best: { ts: number; value: number } | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const dist = Math.abs(p.ts - ts);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

/**
 * Hand-rolled multi-line SVG time-series chart — no charting library
 * dependency, this app has none. The viewBox width tracks the container's
 * real measured pixel width (via ResizeObserver) rather than a fixed
 * constant — a fixed viewBox stretched non-uniformly to fit each card
 * (preserveAspectRatio="none") scaled X and Y differently, which squished
 * all the SVG <text> glyphs horizontally and made them unreadable. Matching
 * the viewBox to the real pixel size keeps the scale 1:1 in both directions.
 */
export function TimeSeriesChart({ series, height = 180, formatValue = defaultFormatValue }: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const allPoints = useMemo(() => series.flatMap((s) => s.points), [series]);
  const hasData = allPoints.length > 0;

  const { minTs, maxTs, minVal, maxVal } = useMemo(() => {
    if (allPoints.length === 0) return { minTs: 0, maxTs: 1, minVal: 0, maxVal: 1 };
    let lowTs = Infinity;
    let highTs = -Infinity;
    let highVal = 0;
    for (const p of allPoints) {
      if (p.ts < lowTs) lowTs = p.ts;
      if (p.ts > highTs) highTs = p.ts;
      if (p.value > highVal) highVal = p.value;
    }
    if (lowTs === highTs) highTs = lowTs + 1;
    // 1.1x headroom put the peak only ~13px below the top gridline — close enough to the
    // 11px-tall axis label sitting right at that same y that a tall spike visually crowded
    // (looked like it was overlapping) the number instead of just approaching it. 1.25x
    // roughly doubles that gap to ~29px, comfortably clear of the label's own glyph height.
    return { minTs: lowTs, maxTs: highTs, minVal: 0, maxVal: highVal > 0 ? highVal * 1.25 : 1 };
  }, [allPoints]);

  const xFor = (ts: number) => PAD_LEFT + ((ts - minTs) / (maxTs - minTs)) * (width - PAD_LEFT - PAD_RIGHT);
  const yFor = (v: number) => height - PAD_BOTTOM - ((v - minVal) / (maxVal - minVal)) * (height - PAD_TOP - PAD_BOTTOM);

  const gridValues = [0, 0.5, 1].map((f) => minVal + f * (maxVal - minVal));

  function handleMouseMove(e: MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setHoverX(Math.min(Math.max(e.clientX - rect.left, PAD_LEFT), width - PAD_RIGHT));
  }

  const hoverTs = hoverX !== null ? minTs + ((hoverX - PAD_LEFT) / (width - PAD_LEFT - PAD_RIGHT)) * (maxTs - minTs) : null;

  return (
    <div className="ts-chart" ref={containerRef}>
      {!hasData ? (
        <div className="status-note">No data for this range yet.</div>
      ) : (
        <>
          <svg
            ref={svgRef}
            className="ts-chart__svg"
            viewBox={`0 0 ${width} ${height}`}
            style={{ height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverX(null)}
          >
            {gridValues.map((v, i) => (
              <g key={i}>
                <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={yFor(v)} y2={yFor(v)} className="ts-chart__gridline" />
                <text x={PAD_LEFT - 6} y={yFor(v)} textAnchor="end" dominantBaseline="middle" className="ts-chart__axis-label">
                  {formatValue(v)}
                </text>
              </g>
            ))}

            <text x={PAD_LEFT} y={height - 6} textAnchor="start" className="ts-chart__axis-label">
              {formatTs(minTs)}
            </text>
            <text x={width - PAD_RIGHT} y={height - 6} textAnchor="end" className="ts-chart__axis-label">
              {formatTs(maxTs)}
            </text>

            {series.map((s) => (
              <polyline
                key={s.key}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                points={s.points.map((p) => `${xFor(p.ts)},${yFor(p.value)}`).join(' ')}
              />
            ))}

            {hoverX !== null && <line x1={hoverX} x2={hoverX} y1={PAD_TOP} y2={height - PAD_BOTTOM} className="ts-chart__crosshair" />}
          </svg>

          {hoverTs !== null && (
            <div className="ts-chart__tooltip" style={{ left: `${(hoverX! / width) * 100}%` }}>
              <div className="ts-chart__tooltip-time">{formatTs(hoverTs)}</div>
              {series.map((s) => {
                const p = nearestPoint(s.points, hoverTs);
                if (!p) return null;
                return (
                  <div key={s.key} className="ts-chart__tooltip-row">
                    <span className="ts-chart__tooltip-dot" style={{ background: s.color }} />
                    {s.label}: {formatValue(p.value)}
                  </div>
                );
              })}
            </div>
          )}

          {series.length > 1 && (
            <div className="ts-chart__legend">
              {series.map((s) => (
                <span key={s.key} className="ts-chart__legend-item">
                  <span className="ts-chart__legend-dot" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
