import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell, ResponsiveContainer } from 'recharts'

const N_BINS = 24

function buildBins(values) {
  const valid = values.filter((v) => v != null && isFinite(v))
  if (!valid.length) return []
  const vPct = valid.map((v) => v * 100)
  const mn = Math.min(...vPct)
  const mx = Math.max(...vPct)
  const range = mx - mn || 0.1
  const w = range / N_BINS
  const bins = Array.from({ length: N_BINS }, (_, i) => ({
    lo: mn + i * w, hi: mn + (i + 1) * w,
    mid: mn + (i + 0.5) * w,
    count: 0,
    label: `${(mn + (i + 0.5) * w).toFixed(1)}%`,
  }))
  for (const v of vPct) {
    const idx = Math.min(Math.floor((v - mn) / w), N_BINS - 1)
    if (idx >= 0) bins[idx].count++
  }
  return bins
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-q-faint mb-1">
        Return [{d.lo.toFixed(1)}%, {d.hi.toFixed(1)}%)
      </p>
      <p className={d.mid >= 0 ? 'text-q-green font-semibold' : 'text-q-red font-semibold'}>
        {d.count} simulation{d.count !== 1 ? 's' : ''}
      </p>
    </div>
  )
}

export default function BootstrapReturnChart({ bootstrapRuns, meanReturn }) {
  const values = useMemo(
    () => (bootstrapRuns ?? []).map((r) => r.cumulative_return),
    [bootstrapRuns]
  )
  const bins = useMemo(() => buildBins(values), [values])

  if (!bins.length) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-q-faint text-xs">No bootstrap data (need ≥3 trades)</p>
      </div>
    )
  }

  const zeroLabel = bins.reduce(
    (best, b) => Math.abs(b.mid) < Math.abs(best.mid) ? b : best, bins[0]
  )?.label

  const meanLabel = meanReturn != null
    ? bins.reduce(
        (best, b) => Math.abs(b.mid - meanReturn * 100) < Math.abs(best.mid - meanReturn * 100) ? b : best,
        bins[0]
      )?.label
    : null

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={bins} margin={{ top: 10, right: 10, left: 5, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: '#475569', fontSize: 10, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#1a2f50' }}
          tickLine={false}
          interval={Math.floor(N_BINS / 6)}
          label={{ value: 'Cumulative Return', fill: '#475569', fontSize: 10, position: 'insideBottom', offset: -2 }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#475569', fontSize: 10, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <ReferenceLine x={zeroLabel} stroke="#2a4a75" strokeWidth={1.5} strokeDasharray="4 2" />
        {meanLabel && (
          <ReferenceLine
            x={meanLabel}
            stroke="#a78bfa"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            label={{ value: `μ=${(meanReturn * 100).toFixed(1)}%`, fill: '#a78bfa', fontSize: 10, position: 'top' }}
          />
        )}
        <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {bins.map((b, i) => (
            <Cell key={i} fill={b.mid >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
