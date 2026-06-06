import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const BAR_COLORS = [
  '#38bdf8', '#a78bfa', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#22d3ee', '#84cc16',
]

const FEATURE_LABELS = {
  zscore: 'Z-Score',
  zscore_lag1: 'Z-Score lag 1',
  zscore_lag5: 'Z-Score lag 5',
  spread_momentum_5: 'Spread Mom (5)',
  spread_momentum_10: 'Spread Mom (10)',
  half_life: 'Half-Life',
  rolling_vol_ratio: 'Vol Ratio',
  spread_rsi_14: 'Spread RSI(14)',
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-q-text font-semibold mb-0.5">
        {FEATURE_LABELS[d.feature] ?? d.feature}
      </p>
      <p className="text-q-accent">
        {(d.importance * 100).toFixed(2)}%
      </p>
    </div>
  )
}

export default function FeatureImportanceChart({ data }) {
  const sorted = useMemo(() => {
    if (!data?.length) return []
    return [...data]
      .sort((a, b) => b.importance - a.importance)
      .map((row) => ({
        ...row,
        label: FEATURE_LABELS[row.feature] ?? row.feature,
      }))
  }, [data])

  if (!sorted.length) {
    return (
      <div className="h-[260px] flex items-center justify-center">
        <p className="text-q-faint text-xs">No feature importances yet</p>
      </div>
    )
  }

  const maxV = Math.max(...sorted.map((d) => d.importance), 0.01)

  return (
    <ResponsiveContainer width="100%" height={Math.max(260, 32 * sorted.length + 40)}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 10, right: 20, left: 10, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} />
        <XAxis
          type="number"
          domain={[0, maxV * 1.1]}
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#1a2f50' }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={130}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(56,189,248,0.05)' }} />
        <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
          {sorted.map((_, i) => (
            <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
