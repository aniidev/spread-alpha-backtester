import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { chartTick, tooltipDate, thinTicks } from '../utils/format.js'

const STROKE   = '#38bdf8'
const FILL_TOP = 'rgba(56,189,248,0.25)'
const FILL_BOT = 'rgba(56,189,248,0.01)'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value
  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-q-faint mb-1">{tooltipDate(label)}</p>
      <p className="text-q-accent font-semibold">
        {v != null
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
          : '—'}
      </p>
    </div>
  )
}

export default function EquityCurveChart({ data, initialCapital = 100000 }) {
  const filtered = useMemo(() => (data ?? []).filter((d) => d.value != null), [data])
  const dates    = useMemo(() => filtered.map((d) => d.date), [filtered])
  const ticks    = useMemo(() => thinTicks(dates, 8), [dates])

  const [yMin, yMax] = useMemo(() => {
    if (!filtered.length) return [0, 1]
    const vals = filtered.map((d) => d.value)
    const mn = Math.min(...vals, initialCapital) * 0.98
    const mx = Math.max(...vals, initialCapital) * 1.02
    return [mn, mx]
  }, [filtered, initialCapital])

  if (!filtered.length) return <EmptyChart />

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={filtered} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={STROKE} stopOpacity={0.3} />
            <stop offset="95%" stopColor={STROKE} stopOpacity={0.02} />
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
          domain={[yMin, yMax]}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a4a75', strokeWidth: 1 }} />
        <ReferenceLine
          y={initialCapital}
          stroke="#475569"
          strokeDasharray="4 3"
          strokeWidth={1}
          label={{ value: 'Initial', fill: '#475569', fontSize: 10, position: 'insideLeft' }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={STROKE}
          strokeWidth={1.5}
          fill="url(#equityGrad)"
          dot={false}
          activeDot={{ r: 4, fill: STROKE, strokeWidth: 0 }}
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function EmptyChart() {
  return (
    <div className="h-[260px] flex items-center justify-center">
      <p className="text-q-faint text-xs">No equity data available</p>
    </div>
  )
}
