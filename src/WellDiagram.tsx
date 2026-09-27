import type { WellStructure } from "./wellModel";

interface Props {
  structure: WellStructure;
  holeDepth: number;
}

const H = 360;
const PAD_TOP = 14;
const PAD_BOTTOM = 10;

/** 成井结构纵断面示意：含水层 / 滤料 / 筛管 / 止水四段按深度绘制，止水与筛管重叠处标红 */
function WellDiagram({ structure, holeDepth }: Props) {
  const { aquifer, screen, filter, seal } = structure;
  const scale = (H - PAD_TOP - PAD_BOTTOM) / holeDepth;
  const y = (d: number) => PAD_TOP + d * scale;

  const valid = (t: number, b: number) =>
    Number.isFinite(t) && Number.isFinite(b) && t >= 0 && b > t && b <= holeDepth + 1e-9;

  const bands = [
    { key: "aquifer", label: "含水层", sec: aquifer, x: 46, w: 128, fill: "#dbeafe", stroke: "#2563eb" },
    { key: "filter", label: "滤料", sec: filter, x: 66, w: 40, fill: "#f3d9a4", stroke: "#b45309" },
    { key: "screen", label: "筛管", sec: screen, x: 74, w: 24, fill: "#0f766e", stroke: "#0f766e" },
    { key: "seal", label: "止水", sec: seal, x: 116, w: 40, fill: "#b45309", stroke: "#92400e" },
  ].filter((b) => valid(b.sec.top, b.sec.bottom));

  // 止水段与筛管重叠区
  const hasConflict =
    valid(seal.top, seal.bottom) && valid(screen.top, screen.bottom) &&
    seal.top < screen.bottom && screen.top < seal.bottom;
  const conflictTop = Math.max(seal.top, screen.top);
  const conflictBottom = Math.min(seal.bottom, screen.bottom);

  // 深度刻度：0、孔深及各段边界去重
  const ticks = Array.from(
    new Set(
      [0, holeDepth, ...bands.flatMap((b) => [b.sec.top, b.sec.bottom])]
        .filter((d) => Number.isFinite(d) && d >= 0 && d <= holeDepth)
        .map((d) => Math.round(d * 10) / 10)
    )
  ).sort((a, b) => a - b);

  return (
    <figure className="well-diagram">
      <svg viewBox={`0 0 220 ${H}`} role="img" aria-label="成井结构示意图">
        {/* 钻孔线 */}
        <line x1={46} y1={y(0)} x2={46} y2={y(holeDepth)} stroke="#94a3b8" strokeWidth={1} />
        <line x1={174} y1={y(0)} x2={174} y2={y(holeDepth)} stroke="#94a3b8" strokeWidth={1} />
        <line x1={46} y1={y(0)} x2={174} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />

        {bands.map((b) => (
          <g key={b.key}>
            <rect
              x={b.x}
              y={y(b.sec.top)}
              width={b.w}
              height={Math.max(2, y(b.sec.bottom) - y(b.sec.top))}
              fill={b.fill}
              stroke={b.stroke}
              strokeWidth={1.2}
              rx={2}
            />
            {b.key === "screen" &&
              [0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  x1={b.x + 3}
                  x2={b.x + b.w - 3}
                  y1={y(b.sec.top) + (y(b.sec.bottom) - y(b.sec.top)) * f}
                  y2={y(b.sec.top) + (y(b.sec.bottom) - y(b.sec.top)) * f}
                  stroke="#ffffff"
                  strokeWidth={1.4}
                />
              ))}
            {y(b.sec.bottom) - y(b.sec.top) >= 16 && (
              <text
                x={b.x + b.w / 2}
                y={(y(b.sec.top) + y(b.sec.bottom)) / 2 + 4}
                textAnchor="middle"
                fontSize={11}
                fill={b.key === "screen" || b.key === "seal" ? "#ffffff" : "#334155"}
              >
                {b.label}
              </text>
            )}
          </g>
        ))}

        {hasConflict && (
          <g>
            <rect
              x={66}
              y={y(conflictTop)}
              width={90}
              height={Math.max(3, y(conflictBottom) - y(conflictTop))}
              fill="#e11d48"
              opacity={0.35}
              stroke="#e11d48"
              strokeWidth={1.4}
              strokeDasharray="4 3"
            />
            <text
              x={161}
              y={(y(conflictTop) + y(conflictBottom)) / 2 + 4}
              fontSize={11}
              fontWeight={700}
              fill="#e11d48"
            >
              冲突
            </text>
          </g>
        )}

        {ticks.map((d) => (
          <g key={d}>
            <line x1={40} y1={y(d)} x2={46} y2={y(d)} stroke="#94a3b8" strokeWidth={1} />
            <text x={36} y={y(d) + 3.5} textAnchor="end" fontSize={9.5} fill="#64748b">
              {d.toFixed(1)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>
        <span><i style={{ background: "#dbeafe" }} />含水层</span>
        <span><i style={{ background: "#f3d9a4" }} />滤料</span>
        <span><i style={{ background: "#0f766e" }} />筛管</span>
        <span><i style={{ background: "#b45309" }} />止水</span>
      </figcaption>
    </figure>
  );
}

export default WellDiagram;
