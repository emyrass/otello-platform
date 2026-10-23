import { formatClock, formatNumber } from "../lib/format.ts";
import type { SeriesPoint } from "../lib/selectors.ts";

export function UsageChart({ points, unit = "requests" }: { points: SeriesPoint[]; unit?: string }) {
  const total = points.reduce((sum, point) => sum + point.requests, 0);
  if (total === 0) {
    return <p className="border-t border-ink/10 py-8 text-sm text-char">Usage data will appear after the first accepted request.</p>;
  }
  const width = 640;
  const height = 168;
  const max = Math.max(1, ...points.map((point) => point.requests));
  const baseline = height - 18;
  const step = points.length <= 1 ? 0 : width / (points.length - 1);
  const coords = points.map((point, index) => {
    const x = index * step;
    const y = baseline - (point.requests / max) * (baseline - 12);
    return { x, y, point };
  });
  const path = coords.map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");
  const last = points.at(-1);

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full text-ink" role="img" aria-label={`Usage chart, peak ${formatNumber(max)} ${unit}`}>
        <line x1="0" y1={baseline} x2={width} y2={baseline} stroke="currentColor" strokeOpacity="0.16" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((coord) => (
          <circle key={coord.point.start} cx={coord.x} cy={coord.y} r="2.2" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="mt-2 flex justify-between text-[11px] uppercase tracking-[0.14em] text-mute">
        <span>{points[0] ? formatClock(points[0].start) : ""}</span>
        <span>
          Peak {formatNumber(max)} {unit}
          {last ? ` · last ${formatNumber(last.requests)}` : ""}
        </span>
        <span>Now</span>
      </figcaption>
    </figure>
  );
}

