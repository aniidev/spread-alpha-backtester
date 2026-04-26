/**
 * SVG semicircular gauge displaying the 0–100 robustness score.
 * Green ≥70 · Amber ≥40 · Red <40
 */
export default function RobustnessScoreGauge({ score }) {
  const clamped = Math.max(0, Math.min(100, score ?? 0))

  // Arc geometry: semicircle from (-r,0) to (r,0) in a 200×110 viewBox
  const cx = 100, cy = 95, r = 80
  const arcLen = Math.PI * r         // full semicircle = π·r ≈ 251
  const filled = (clamped / 100) * arcLen

  const color =
    clamped >= 70 ? '#10b981' :
    clamped >= 40 ? '#f59e0b' : '#ef4444'

  const label =
    clamped >= 70 ? 'ROBUST' :
    clamped >= 40 ? 'MODERATE' : 'FRAGILE'

  // Start point: left of semicircle (cx-r, cy)
  // End point:   right of semicircle (cx+r, cy)
  const trackPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 110" width="200" height="110" aria-label={`Robustness score: ${clamped}`}>
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="#1a2f50"
          strokeWidth="12"
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d={trackPath}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${arcLen}`}
          style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />
        {/* Glow effect */}
        <path
          d={trackPath}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${arcLen}`}
          strokeOpacity="0.3"
          style={{ filter: 'blur(3px)', transition: 'stroke-dasharray 0.8s' }}
        />
        {/* Score number */}
        <text
          x={cx}
          y={cy - 8}
          textAnchor="middle"
          fill={color}
          fontSize="32"
          fontWeight="700"
          fontFamily="JetBrains Mono, monospace"
        >
          {Math.round(clamped)}
        </text>
        {/* /100 */}
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fill="#475569"
          fontSize="12"
          fontFamily="JetBrains Mono, monospace"
        >
          / 100
        </text>
        {/* End labels */}
        <text x={cx - r - 4} y={cy + 18} textAnchor="end" fill="#475569" fontSize="9" fontFamily="Inter">0</text>
        <text x={cx + r + 4} y={cy + 18} textAnchor="start" fill="#475569" fontSize="9" fontFamily="Inter">100</text>
      </svg>

      <span
        className="text-xs font-bold tracking-widest px-2 py-0.5 rounded border mt-1"
        style={{ color, borderColor: color + '40', background: color + '15' }}
      >
        {label}
      </span>
    </div>
  )
}
