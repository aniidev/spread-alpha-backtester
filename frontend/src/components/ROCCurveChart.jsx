import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const STROKE = '#38bdf8'

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-q-faint">FPR: {d.fpr.toFixed(3)}</p>
      <p className="text-q-accent font-semibold">TPR: {d.tpr.toFixed(3)}</p>
    </div>
  )
}

export default function ROCCurveChart({ data, auc }) {
  const points = useMemo(() => (data ?? []).filter((p) => p && p.fpr != null), [data])

  if (!points.length) {
    return (
      <div className="h-[260px] flex items-center justify-center">
        <p className="text-q-faint text-xs">ROC curve unavailable</p>
      </div>
    )
  }

  // Diagonal reference (random classifier)
  const diagonal = [{ fpr: 0, tpr: 0 }, { fpr: 1, tpr: 1 }]

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart margin={{ top: 10, right: 14, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} />
          <XAxis
            type="number"
            dataKey="fpr"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v) => v.toFixed(2)}
            tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            label={{
              value: 'False Positive Rate',
              fill: '#64748b', fontSize: 11, position: 'insideBottom', offset: -4,
            }}
            axisLine={{ stroke: '#1a2f50' }}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="tpr"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v) => v.toFixed(2)}
            tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            label={{
              value: 'True Positive Rate',
              fill: '#64748b', fontSize: 11, angle: -90, position: 'insideLeft',
            }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a4a75', strokeWidth: 1 }} />

          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
            stroke="#475569"
            strokeDasharray="4 3"
            strokeWidth={1}
            ifOverflow="extendDomain"
          />

          <Line
            data={diagonal}
            dataKey="tpr"
            type="linear"
            stroke="#475569"
            strokeDasharray="4 3"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />
          <Line
            data={points}
            dataKey="tpr"
            type="monotone"
            stroke={STROKE}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {auc != null && (
        <div className="absolute top-2 right-4 text-xs font-mono px-2 py-1 rounded bg-q-elevated border border-q-border text-q-accent">
          AUC = {auc.toFixed(3)}
        </div>
      )}
    </div>
  )
}
