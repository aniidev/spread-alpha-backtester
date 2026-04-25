import { useMemo } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import { chartTick, tooltipDate, thinTicks } from '../utils/format.js'

const LINE_COLOR  = '#a78bfa'
const LONG_FILL   = 'rgba(16,185,129,0.12)'
const SHORT_FILL  = 'rgba(239,68,68,0.12)'
const LONG_STROKE = 'rgba(16,185,129,0.0)'
const SHORT_STROKE= 'rgba(239,68,68,0.0)'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  const z = d?.value
  const pos = d?.position

  const posLabel =
    pos === 1 ? <span className="text-q-green">▲ long spread</span>
    : pos === -1 ? <span className="text-q-red">▼ short spread</span>
    : <span className="text-q-faint">flat</span>

  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-q-faint mb-1">{tooltipDate(label)}</p>
      <p className="text-q-violet font-semibold mb-0.5">
        z = {z != null ? z.toFixed(3) : '—'}
      </p>
      <p>{posLabel}</p>
    </div>
  )
}

/** Compute contiguous blocks of non-zero position for ReferenceArea shading. */
function positionBlocks(data) {
  const blocks = []
  let blockStart = null
  let blockPos = 0

  for (let i = 0; i < data.length; i++) {
    const pos = data[i].position ?? 0
    if (pos !== 0 && blockPos === 0) {
      blockStart = data[i].date
      blockPos = pos
    } else if (pos !== blockPos && blockPos !== 0) {
      blocks.push({ x1: blockStart, x2: data[i].date, position: blockPos })
      if (pos !== 0) {
        blockStart = data[i].date
        blockPos = pos
      } else {
        blockStart = null
        blockPos = 0
      }
    }
  }

  if (blockPos !== 0 && blockStart != null) {
    blocks.push({ x1: blockStart, x2: data[data.length - 1].date, position: blockPos })
  }
  return blocks
}

export default function ZScoreChart({ data, entryZ = 2.0 }) {
  const filtered = useMemo(() => (data ?? []).filter((d) => d.value != null), [data])
  const ticks    = useMemo(() => thinTicks(filtered.map((d) => d.date), 8), [filtered])
  const blocks   = useMemo(() => positionBlocks(data ?? []), [data])

  const [yMin, yMax] = useMemo(() => {
    if (!filtered.length) return [-3, 3]
    const vals = filtered.map((d) => d.value)
    const bound = Math.max(Math.abs(Math.min(...vals)), Math.abs(Math.max(...vals)), entryZ + 0.5)
    return [-bound * 1.05, bound * 1.05]
  }, [filtered, entryZ])

  if (!filtered.length) return <EmptyChart />

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={filtered} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
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
          tickFormatter={(v) => v.toFixed(1)}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a4a75', strokeWidth: 1 }} />

        {/* Position background shading */}
        {blocks.map((b, i) => (
          <ReferenceArea
            key={i}
            x1={b.x1}
            x2={b.x2}
            fill={b.position === 1 ? LONG_FILL : SHORT_FILL}
            stroke={b.position === 1 ? LONG_STROKE : SHORT_STROKE}
            strokeWidth={0}
          />
        ))}

        {/* Reference lines */}
        <ReferenceLine y={0}        stroke="#2a4a75" strokeWidth={1} />
        <ReferenceLine y={ entryZ}  stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1.2} />
        <ReferenceLine y={-entryZ}  stroke="#10b981" strokeDasharray="5 3" strokeWidth={1.2} />

        {/* Z-score line */}
        <Line
          type="monotone"
          dataKey="value"
          stroke={LINE_COLOR}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 4, fill: LINE_COLOR, strokeWidth: 0 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function EmptyChart() {
  return (
    <div className="h-[260px] flex items-center justify-center">
      <p className="text-q-faint text-xs">No z-score data available</p>
    </div>
  )
}
