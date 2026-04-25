import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { chartTick, tooltipDate, thinTicks } from '../utils/format.js'

const STROKE = '#ef4444'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value
  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-q-faint mb-1">{tooltipDate(label)}</p>
      <p className="text-q-red font-semibold">
        {v != null ? `${(v * 100).toFixed(2)}%` : '—'}
      </p>
    </div>
  )
}

export default function DrawdownChart({ data }) {
  const filtered = useMemo(() => (data ?? []).filter((d) => d.value != null), [data])
  const ticks    = useMemo(() => thinTicks(filtered.map((d) => d.date), 6), [filtered])

  const yMin = useMemo(() => {
    if (!filtered.length) return -0.3
    const mn = Math.min(...filtered.map((d) => d.value))
    return Math.min(mn * 1.05, -0.01)
  }, [filtered])

  if (!filtered.length) return <EmptyChart />

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={filtered} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={STROKE} stopOpacity={0.4} />
            <stop offset="95%" stopColor={STROKE} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} />
        <XAxis
          dataKey="date"
          ticks={ticks}
          tickFormatter={chartTick}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#1a2f50' }}
          tickLine={false}
        />
        <YAxis
          domain={[yMin, 0]}
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a4a75', strokeWidth: 1 }} />
        <ReferenceLine y={0} stroke="#2a4a75" strokeWidth={1} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={STROKE}
          strokeWidth={1.5}
          fill="url(#ddGrad)"
          dot={false}
          activeDot={{ r: 4, fill: STROKE, strokeWidth: 0 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function EmptyChart() {
  return (
    <div className="h-[220px] flex items-center justify-center">
      <p className="text-q-faint text-xs">No drawdown data available</p>
    </div>
  )
}
