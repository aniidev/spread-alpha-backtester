import { useMemo } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono space-y-1">
      <p className="text-q-faint mb-1">{label} bps</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-semibold">
          {p.name}: {p.value != null ? p.value.toFixed(3) : '—'}
        </p>
      ))}
    </div>
  )
}

export default function CostSensitivityChart({ costRuns, baseCostBps = 10 }) {
  const data = useMemo(
    () => (costRuns ?? []).filter((r) => r.cost_bps != null),
    [costRuns]
  )

  if (!data.length) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-q-faint text-xs">No cost sensitivity data</p>
      </div>
    )
  }

  // Y domain: pad around [min_return, max_return] and [min_sharpe, max_sharpe]
  const allReturns = data.map((d) => d.total_return).filter((v) => v != null)
  const allSharpes = data.map((d) => d.sharpe).filter((v) => v != null)

  const retMin = allReturns.length ? Math.min(...allReturns) * 1.1 - 0.01 : -0.1
  const retMax = allReturns.length ? Math.max(...allReturns) * 1.1 + 0.01 : 0.5
  const shMin  = allSharpes.length ? Math.min(...allSharpes) * 1.1 - 0.1 : -1
  const shMax  = allSharpes.length ? Math.max(...allSharpes) * 1.1 + 0.1 : 3

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 10, right: 50, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} />
        <XAxis
          dataKey="cost_bps"
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#1a2f50' }}
          tickLine={false}
          label={{ value: 'Transaction Cost (bps)', fill: '#475569', fontSize: 10, position: 'insideBottom', offset: -2 }}
        />
        {/* Left Y: total return */}
        <YAxis
          yAxisId="ret"
          orientation="left"
          domain={[retMin, retMax]}
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          tick={{ fill: '#10b981', fontSize: 10, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={42}
        />
        {/* Right Y: Sharpe */}
        <YAxis
          yAxisId="sharpe"
          orientation="right"
          domain={[shMin, shMax]}
          tickFormatter={(v) => v.toFixed(1)}
          tick={{ fill: '#38bdf8', fontSize: 10, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={34}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a4a75', strokeWidth: 1 }} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 4 }}
          iconType="plainline"
        />
        {/* Zero return line */}
        <ReferenceLine yAxisId="ret" y={0} stroke="#2a4a75" strokeWidth={1} strokeDasharray="4 2" />
        {/* Base cost marker — vertical line; must declare a yAxisId in dual-axis charts */}
        <ReferenceLine
          yAxisId="ret"
          x={baseCostBps}
          stroke="#f59e0b"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          label={{ value: 'base', fill: '#f59e0b', fontSize: 9, position: 'top' }}
        />
        <Line
          yAxisId="ret"
          type="monotone"
          dataKey="total_return"
          name="Return"
          stroke="#10b981"
          strokeWidth={2}
          dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="sharpe"
          type="monotone"
          dataKey="sharpe"
          name="Sharpe"
          stroke="#38bdf8"
          strokeWidth={2}
          dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
