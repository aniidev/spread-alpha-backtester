import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts'

const N_BINS = 20

function buildHistogram(trades) {
  const returns = (trades ?? [])
    .map((t) => t.return)
    .filter((r) => r != null)
    .map((r) => r * 100)  // convert to percentage

  if (returns.length === 0) return []

  const mn = Math.min(...returns)
  const mx = Math.max(...returns)
  const range = mx - mn || 0.01
  const binW = range / N_BINS

  const bins = Array.from({ length: N_BINS }, (_, i) => {
    const lo = mn + i * binW
    const hi = lo + binW
    const mid = (lo + hi) / 2
    return { label: `${lo.toFixed(1)}%`, lo, hi, mid, count: 0 }
  })

  for (const r of returns) {
    const idx = Math.min(Math.floor((r - mn) / binW), N_BINS - 1)
    if (idx >= 0) bins[idx].count++
  }

  return bins
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-q-faint mb-1">
        [{d.lo.toFixed(2)}%, {d.hi.toFixed(2)}%)
      </p>
      <p className={d.mid >= 0 ? 'text-q-green font-semibold' : 'text-q-red font-semibold'}>
        {d.count} trade{d.count !== 1 ? 's' : ''}
      </p>
    </div>
  )
}

export default function TradeHistogramChart({ trades }) {
  const bins = useMemo(() => buildHistogram(trades), [trades])

  if (!bins.length) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-q-faint text-xs">No trade data available</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={bins} margin={{ top: 10, right: 10, left: 5, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: '#475569', fontSize: 10, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#1a2f50' }}
          tickLine={false}
          interval={Math.floor(N_BINS / 5)}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <ReferenceLine x={bins.find((b) => b.lo <= 0 && b.hi >= 0)?.label ?? ''} stroke="#2a4a75" />
        <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {bins.map((b, i) => (
            <Cell key={i} fill={b.mid >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
