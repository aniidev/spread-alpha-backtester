import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell, ResponsiveContainer } from 'recharts'
import { fmt } from '../utils/format.js'

const N_BINS = 24

function buildBins(sharpes) {
  const valid = sharpes.filter((v) => v != null && isFinite(v))
  if (!valid.length) return []
  const mn = Math.min(...valid)
  const mx = Math.max(...valid)
  const range = mx - mn || 0.1
  const w = range / N_BINS
  const bins = Array.from({ length: N_BINS }, (_, i) => ({
    lo: mn + i * w, hi: mn + (i + 1) * w,
    mid: mn + (i + 0.5) * w,
    count: 0,
    label: (mn + (i + 0.5) * w).toFixed(2),
  }))
  for (const v of valid) {
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
        Sharpe [{d.lo.toFixed(2)}, {d.hi.toFixed(2)})
      </p>
      <p className={d.mid >= 0 ? 'text-q-green font-semibold' : 'text-q-red font-semibold'}>
        {d.count} window{d.count !== 1 ? 's' : ''}
      </p>
    </div>
  )
}

export default function SharpeHistChart({ windowRuns, meanSharpe }) {
  const sharpes = useMemo(() => (windowRuns ?? []).map((r) => r.sharpe), [windowRuns])
  const bins = useMemo(() => buildBins(sharpes), [sharpes])

  if (!bins.length) return <EmptyChart label="No window data" />

  const ticks = bins
    .filter((_, i) => i % Math.floor(N_BINS / 6) === 0)
    .map((b) => b.label)

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
          label={{ value: 'Sharpe Ratio', fill: '#475569', fontSize: 10, position: 'insideBottom', offset: -2 }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#475569', fontSize: 10, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        {/* Zero line */}
        <ReferenceLine
          x={bins.reduce((best, b) => Math.abs(b.mid) < Math.abs(best.mid) ? b : best, bins[0])?.label}
          stroke="#2a4a75"
          strokeWidth={1.5}
          strokeDasharray="4 2"
        />
        {/* Mean line */}
        {meanSharpe != null && (
          <ReferenceLine
            x={bins.reduce((best, b) => Math.abs(b.mid - meanSharpe) < Math.abs(best.mid - meanSharpe) ? b : best, bins[0])?.label}
            stroke="#38bdf8"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            label={{ value: `μ=${meanSharpe?.toFixed(2)}`, fill: '#38bdf8', fontSize: 10, position: 'top' }}
          />
        )}
        <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {bins.map((b, i) => (
            <Cell key={i} fill={b.mid >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function EmptyChart({ label = 'No data' }) {
  return (
    <div className="h-[220px] flex items-center justify-center">
      <p className="text-q-faint text-xs">{label}</p>
    </div>
  )
}
