import { useState, useCallback, useMemo } from 'react'
import {
  Brain, Play, Target, Activity, ChevronDown, ChevronUp, SlidersHorizontal,
} from 'lucide-react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend, Scatter, ScatterChart,
  BarChart, Bar, Cell, ZAxis,
} from 'recharts'
import { api } from '../api/client.js'
import { fmt, chartTick, tooltipDate, thinTicks } from '../utils/format.js'
import FeatureImportanceChart from './FeatureImportanceChart.jsx'
import ROCCurveChart from './ROCCurveChart.jsx'

// ── Defaults ──────────────────────────────────────────────────

const DEFAULT_FORM = {
  ticker_a: 'MA',
  ticker_b: 'V',
  start: '2020-01-01',
  end: '2024-12-31',
  zscore_lookback: 60,
  entry_z: 2.0,
  exit_z: 0.5,
  rolling_beta: false,
  beta_lookback: 60,
  initial_capital: 100000,
  transaction_cost: 0.001,
  model_type: 'gbm',
  n_bars_target: 5,
  train_fraction: 0.7,
  long_threshold: 0.6,
  short_threshold: 0.4,
}

const MODEL_OPTIONS = [
  { id: 'lr',  label: 'Logistic Regression', desc: 'Linear baseline · interpretable' },
  { id: 'gbm', label: 'Gradient Boosting',   desc: 'Non-linear · captures interactions' },
  { id: 'rf',  label: 'Random Forest',       desc: 'Robust ensemble · less overfit' },
]

// ── Small UI helpers ──────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold tracking-widest uppercase text-q-faint mb-3">
      {children}
    </p>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-q-muted">{label}</label>
        {hint && <span className="text-xs text-q-faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, step = 1, min, max }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

// ── Classification metric chips ───────────────────────────────

const CLF_METRICS = [
  { key: 'accuracy',  label: 'Accuracy',  good: 0.55 },
  { key: 'precision', label: 'Precision', good: 0.55 },
  { key: 'recall',    label: 'Recall',    good: 0.55 },
  { key: 'f1',        label: 'F1',        good: 0.55 },
  { key: 'auc_roc',   label: 'AUC-ROC',   good: 0.6  },
]

function ClassifierMetricsRow({ metrics }) {
  if (!metrics) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {CLF_METRICS.map(({ key, label, good }) => {
        const v = metrics[key]
        const color = v == null
          ? 'text-q-muted'
          : v >= good ? 'text-q-green' : v >= good - 0.1 ? 'text-q-amber' : 'text-q-red'
        return (
          <div key={key} className="rounded-xl border border-q-border bg-q-surface p-3 flex flex-col gap-1">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-q-faint">{label}</p>
            <p className={`text-xl font-bold font-mono ${color}`}>
              {v != null ? v.toFixed(3) : '—'}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── KPI comparison cards ──────────────────────────────────────

const KPI_COMPARISON = [
  { key: 'final_equity',       label: 'Final Equity',  fmt: (v) => fmt.currency(v), better: 'higher' },
  { key: 'total_return',       label: 'Total Return',  fmt: (v) => fmt.pct(v),       better: 'higher' },
  { key: 'annualized_return',  label: 'Ann. Return',   fmt: (v) => fmt.pct(v),       better: 'higher' },
  { key: 'annualized_volatility', label: 'Ann. Vol',   fmt: (v) => fmt.pct(v),       better: 'lower'  },
  { key: 'sharpe_ratio',       label: 'Sharpe',        fmt: (v) => fmt.decimal(v),   better: 'higher' },
  { key: 'calmar_ratio',       label: 'Calmar',        fmt: (v) => fmt.decimal(v),   better: 'higher' },
  { key: 'max_drawdown',       label: 'Max DD',        fmt: (v) => fmt.pct(v),       better: 'higher' }, // less negative
  { key: 'win_rate',           label: 'Win Rate',      fmt: (v) => fmt.pct(v),       better: 'higher' },
  { key: 'profit_factor',      label: 'Profit Factor', fmt: (v) => fmt.decimal(v),   better: 'higher' },
  { key: 'n_trades',           label: 'Trades',        fmt: (v) => fmt.int(v),       better: 'neutral'},
  { key: 'exposure_fraction',  label: 'Exposure',      fmt: (v) => fmt.pct(v),       better: 'neutral'},
  { key: 'total_costs',        label: 'Total Costs',   fmt: (v) => fmt.currency(v),  better: 'lower'  },
]

function compareSign(better, base, ml) {
  if (base == null || ml == null) return 0
  if (better === 'higher') return Math.sign(ml - base)
  if (better === 'lower')  return Math.sign(base - ml)
  return 0
}

function KpiCompareCard({ label, baselineVal, mlVal, fmtFn, sign }) {
  const colorBase = 'text-q-text'
  const colorML = sign > 0 ? 'text-q-green' : sign < 0 ? 'text-q-red' : 'text-q-text'
  return (
    <div className="rounded-xl border border-q-border bg-q-surface p-3 flex flex-col gap-2">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-q-faint">{label}</p>
      <div className="grid grid-cols-2 gap-2 mt-1">
        <div>
          <p className="text-[10px] uppercase text-q-faint mb-0.5">Baseline</p>
          <p className={`text-base font-mono font-semibold ${colorBase}`}>
            {baselineVal != null ? fmtFn(baselineVal) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-q-violet mb-0.5">ML</p>
          <p className={`text-base font-mono font-semibold ${colorML}`}>
            {mlVal != null ? fmtFn(mlVal) : '—'}
          </p>
        </div>
      </div>
    </div>
  )
}

function KpiComparison({ baseline, ml }) {
  if (!baseline || !ml) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {KPI_COMPARISON.map(({ key, label, fmt: fmtFn, better }) => (
        <KpiCompareCard
          key={key}
          label={label}
          baselineVal={baseline[key]}
          mlVal={ml[key]}
          fmtFn={fmtFn}
          sign={compareSign(better, baseline[key], ml[key])}
        />
      ))}
    </div>
  )
}

// ── Feature time-series chart (z-score + ML probability) ──────

function FeatureTimeSeriesTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const z = payload.find((p) => p.dataKey === 'zscore')?.value
  const p = payload.find((p) => p.dataKey === 'ml_prob')?.value
  const sig = payload.find((p) => p.dataKey === 'ml_signal')?.value
  const sigText = sig === 1 ? <span className="text-q-green">▲ long</span>
    : sig === -1 ? <span className="text-q-red">▼ short</span>
    : <span className="text-q-faint">flat</span>
  return (
    <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-q-faint mb-1">{tooltipDate(label)}</p>
      <p className="text-q-violet">z = {z != null ? z.toFixed(3) : '—'}</p>
      <p className="text-q-accent">p = {p != null ? p.toFixed(3) : '—'}</p>
      <p>{sigText}</p>
    </div>
  )
}

function FeatureTimeSeriesChart({ data, entryZ = 2.0, longThr = 0.6, shortThr = 0.4 }) {
  const filtered = useMemo(
    () => (data ?? []).filter((d) => d.zscore != null || d.ml_prob != null),
    [data],
  )
  const ticks = useMemo(() => thinTicks(filtered.map((d) => d.date), 8), [filtered])

  if (!filtered.length) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <p className="text-q-faint text-xs">No feature time-series data</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={filtered} margin={{ top: 10, right: 50, left: 10, bottom: 0 }}>
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
          yAxisId="z"
          domain={['auto', 'auto']}
          tickFormatter={(v) => v.toFixed(1)}
          tick={{ fill: '#a78bfa', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={40}
          label={{ value: 'z', fill: '#a78bfa', fontSize: 10, angle: -90, position: 'insideLeft' }}
        />
        <YAxis
          yAxisId="p"
          orientation="right"
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v) => v.toFixed(2)}
          tick={{ fill: '#38bdf8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={40}
          label={{ value: 'p', fill: '#38bdf8', fontSize: 10, angle: 90, position: 'insideRight' }}
        />
        <Tooltip content={<FeatureTimeSeriesTooltip />} cursor={{ stroke: '#2a4a75', strokeWidth: 1 }} />
        <Legend
          wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: '#94a3b8' }}
          iconType="line"
        />

        <ReferenceLine yAxisId="z" y={0} stroke="#2a4a75" strokeWidth={1} />
        <ReferenceLine yAxisId="z" y={ entryZ} stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1} />
        <ReferenceLine yAxisId="z" y={-entryZ} stroke="#10b981" strokeDasharray="5 3" strokeWidth={1} />

        <ReferenceLine yAxisId="p" y={longThr} stroke="#38bdf8" strokeDasharray="2 4" strokeWidth={0.7} />
        <ReferenceLine yAxisId="p" y={shortThr} stroke="#38bdf8" strokeDasharray="2 4" strokeWidth={0.7} />

        <Line
          yAxisId="z"
          type="monotone"
          dataKey="zscore"
          name="Z-score"
          stroke="#a78bfa"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="p"
          type="monotone"
          dataKey="ml_prob"
          name="ML probability"
          stroke="#38bdf8"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Equity overlay (baseline vs ML) ───────────────────────────

function EquityOverlay({ baseline, ml, initialCapital }) {
  const merged = useMemo(() => {
    const map = new Map()
    for (const d of baseline ?? []) {
      if (d.value == null) continue
      map.set(d.date, { date: d.date, baseline: d.value })
    }
    for (const d of ml ?? []) {
      if (d.value == null) continue
      const row = map.get(d.date) ?? { date: d.date }
      row.ml = d.value
      map.set(d.date, row)
    }
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1))
  }, [baseline, ml])

  const ticks = useMemo(() => thinTicks(merged.map((d) => d.date), 8), [merged])

  if (!merged.length) {
    return (
      <div className="h-[260px] flex items-center justify-center">
        <p className="text-q-faint text-xs">No equity data</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={merged} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
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
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={55}
        />
        <Tooltip
          formatter={(v) => fmt.currency(v)}
          labelFormatter={tooltipDate}
          contentStyle={{
            backgroundColor: '#0f1c33',
            border: '1px solid #1a2f50',
            borderRadius: 8,
            fontSize: 12,
            fontFamily: 'JetBrains Mono',
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: '#94a3b8' }}
          iconType="line"
        />
        <ReferenceLine y={initialCapital} stroke="#475569" strokeDasharray="4 3" strokeWidth={1} />
        <Line type="monotone" dataKey="baseline" name="Z-score baseline" stroke="#94a3b8" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="ml"       name="ML strategy"      stroke="#a78bfa" strokeWidth={1.7} dot={false} connectNulls={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Threshold sweep panel ─────────────────────────────────────

function SweepSharpeChart({ rows, baselineSharpe, bestKey }) {
  const symmetric = useMemo(
    () => (rows ?? []).filter((r) => r.symmetric && r.sharpe_ratio != null),
    [rows],
  )
  const asymmetric = useMemo(
    () => (rows ?? []).filter((r) => !r.symmetric && r.sharpe_ratio != null),
    [rows],
  )

  if (!symmetric.length && !asymmetric.length) {
    return (
      <div className="h-[260px] flex items-center justify-center">
        <p className="text-q-faint text-xs">No sweep data</p>
      </div>
    )
  }

  // Compose a reasonable y-domain that always includes baseline
  const allSharpes = [
    ...symmetric.map((r) => r.sharpe_ratio),
    ...asymmetric.map((r) => r.sharpe_ratio),
  ]
  if (baselineSharpe != null) allSharpes.push(baselineSharpe)
  const yMin = Math.min(...allSharpes) - 0.2
  const yMax = Math.max(...allSharpes) + 0.2

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} />
        <XAxis
          type="number"
          dataKey="long_threshold"
          domain={[0.5, 0.85]}
          ticks={[0.55, 0.60, 0.65, 0.70, 0.75, 0.80]}
          tickFormatter={(v) => v.toFixed(2)}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#1a2f50' }}
          tickLine={false}
          label={{
            value: 'Long threshold (t_hi)',
            fill: '#64748b', fontSize: 11, position: 'insideBottom', offset: -4,
          }}
        />
        <YAxis
          type="number"
          dataKey="sharpe_ratio"
          domain={[yMin, yMax]}
          tickFormatter={(v) => v.toFixed(2)}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={50}
          label={{
            value: 'Sharpe', fill: '#64748b', fontSize: 11, angle: -90, position: 'insideLeft',
          }}
        />
        <Tooltip
          cursor={{ stroke: '#2a4a75', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload
            return (
              <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
                <p className="text-q-faint">
                  t_hi {d.long_threshold?.toFixed(2)} · t_lo {d.short_threshold?.toFixed(2)}
                  {d.symmetric ? '' : ' (asym)'}
                </p>
                <p className="text-q-accent">Sharpe {d.sharpe_ratio?.toFixed(3) ?? '—'}</p>
                <p className="text-q-muted">Return {fmt.pct(d.total_return)}</p>
                <p className="text-q-muted">Trades {fmt.int(d.n_trades)}</p>
              </div>
            )
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono', color: '#94a3b8' }}
          iconType="circle"
        />

        {baselineSharpe != null && (
          <ReferenceLine
            y={baselineSharpe}
            stroke="#f59e0b"
            strokeDasharray="5 3"
            strokeWidth={1.2}
            label={{
              value: `Baseline ${baselineSharpe.toFixed(2)}`,
              fill: '#f59e0b', fontSize: 10, position: 'insideTopRight',
            }}
          />
        )}

        {symmetric.length > 0 && (
          <Scatter
            name="Symmetric (t_lo = 1 − t_hi)"
            data={symmetric}
            fill="#a78bfa"
            line={{ stroke: '#a78bfa', strokeWidth: 1.5 }}
            shape="circle"
          />
        )}
        {asymmetric.length > 0 && (
          <Scatter
            name="Asymmetric"
            data={asymmetric}
            fill="#38bdf8"
            shape="diamond"
          />
        )}
      </ScatterChart>
    </ResponsiveContainer>
  )
}

function ThresholdSweepTable({ rows, bestKey }) {
  if (!rows?.length) return null
  const sorted = [...rows].sort((a, b) => {
    const aS = a.sharpe_ratio ?? -Infinity
    const bS = b.sharpe_ratio ?? -Infinity
    return bS - aS
  })
  return (
    <div className="overflow-x-auto rounded-lg border border-q-border">
      <table className="w-full text-xs font-mono">
        <thead className="bg-q-elevated text-q-faint">
          <tr>
            <th className="px-3 py-2 text-left font-semibold tracking-wider uppercase">t_hi</th>
            <th className="px-3 py-2 text-left font-semibold tracking-wider uppercase">t_lo</th>
            <th className="px-3 py-2 text-left font-semibold tracking-wider uppercase">Type</th>
            <th className="px-3 py-2 text-right font-semibold tracking-wider uppercase">Sharpe</th>
            <th className="px-3 py-2 text-right font-semibold tracking-wider uppercase">Return</th>
            <th className="px-3 py-2 text-right font-semibold tracking-wider uppercase">Max DD</th>
            <th className="px-3 py-2 text-right font-semibold tracking-wider uppercase">Trades</th>
            <th className="px-3 py-2 text-right font-semibold tracking-wider uppercase">Win Rate</th>
            <th className="px-3 py-2 text-right font-semibold tracking-wider uppercase">Costs</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const isBest = r === bestKey || (
              bestKey != null &&
              r.long_threshold === bestKey.long_threshold &&
              r.short_threshold === bestKey.short_threshold
            )
            return (
              <tr
                key={`${r.long_threshold}-${r.short_threshold}-${i}`}
                className={`border-t border-q-border ${
                  isBest
                    ? 'bg-q-green/10 text-q-text'
                    : 'text-q-muted hover:bg-q-elevated/50'
                }`}
              >
                <td className="px-3 py-1.5">
                  {isBest && <span className="text-q-green mr-1">★</span>}
                  {r.long_threshold.toFixed(2)}
                </td>
                <td className="px-3 py-1.5">{r.short_threshold.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-q-faint">{r.symmetric ? 'sym' : 'asym'}</td>
                <td className={`px-3 py-1.5 text-right ${
                  r.sharpe_ratio == null ? '' : r.sharpe_ratio >= 1 ? 'text-q-green' : r.sharpe_ratio >= 0 ? 'text-q-amber' : 'text-q-red'
                }`}>
                  {r.sharpe_ratio != null ? r.sharpe_ratio.toFixed(2) : '—'}
                </td>
                <td className={`px-3 py-1.5 text-right ${
                  r.total_return == null ? '' : r.total_return >= 0 ? 'text-q-green' : 'text-q-red'
                }`}>
                  {fmt.pct(r.total_return)}
                </td>
                <td className="px-3 py-1.5 text-right text-q-red">{fmt.pct(r.max_drawdown)}</td>
                <td className="px-3 py-1.5 text-right">{fmt.int(r.n_trades)}</td>
                <td className="px-3 py-1.5 text-right">{fmt.pct(r.win_rate)}</td>
                <td className="px-3 py-1.5 text-right text-q-red/80">{fmt.currency(r.total_costs)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ThresholdSweepPanel({ sweep }) {
  if (!sweep || !sweep.grid?.length) return null
  const summary = sweep.summary ?? {}
  const beats = summary.beats_baseline
  const text = summary.summary_text ?? ''
  return (
    <div className="rounded-xl border border-q-border bg-q-surface p-4 space-y-4">
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={14} className="text-q-accent" />
        <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">
          Threshold Sweep — Sharpe vs Long Threshold
        </p>
        <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded border ${
          beats
            ? 'text-q-green border-q-green/30 bg-q-green/10'
            : 'text-q-amber border-q-amber/30 bg-q-amber/10'
        }`}>
          {beats ? '✓ ML BEATS BASELINE' : 'BASELINE STILL AHEAD'}
        </span>
      </div>

      {text && (
        <p className="text-sm text-q-muted leading-relaxed border-l-2 border-q-accent/40 pl-3">
          {text}
        </p>
      )}

      <SweepSharpeChart
        rows={sweep.grid}
        baselineSharpe={summary.baseline_sharpe}
        bestKey={summary.best}
      />

      <ThresholdSweepTable rows={sweep.grid} bestKey={summary.best} />
    </div>
  )
}

// ── Probability calibration panel ─────────────────────────────

function CalibrationHistogram({ bins }) {
  const data = useMemo(
    () => (bins ?? []).map((b) => ({
      label: b.bin_lower.toFixed(1),
      lower: b.bin_lower,
      upper: b.bin_upper,
      count: b.count,
    })),
    [bins],
  )
  if (!data.length) {
    return <div className="h-[240px] flex items-center justify-center">
      <p className="text-q-faint text-xs">No calibration data</p>
    </div>
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 14 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#1a2f50' }}
          tickLine={false}
          interval={0}
          label={{ value: 'Predicted probability', fill: '#64748b', fontSize: 11, position: 'insideBottom', offset: -6 }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          width={40}
          label={{ value: 'count', fill: '#64748b', fontSize: 11, angle: -90, position: 'insideLeft' }}
        />
        <Tooltip
          cursor={{ fill: '#1a2f5033' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload
            return (
              <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
                <p className="text-q-faint">p ∈ [{d.lower.toFixed(1)}, {d.upper.toFixed(1)})</p>
                <p className="text-q-violet">count {d.count}</p>
              </div>
            )
          }}
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.lower < 0.1 || d.lower >= 0.9 ? '#7c5cff' : '#a78bfa'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function ReliabilityCurve({ bins }) {
  const points = useMemo(
    () => (bins ?? [])
      .filter((b) => b.count > 0 && b.mean_predicted != null && b.fraction_positive != null)
      .map((b) => ({
        predicted: b.mean_predicted,
        actual: b.fraction_positive,
        count: b.count,
      })),
    [bins],
  )
  if (!points.length) {
    return <div className="h-[240px] flex items-center justify-center">
      <p className="text-q-faint text-xs">No reliability data</p>
    </div>
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 14 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2f50" strokeOpacity={0.5} />
        <XAxis
          type="number" dataKey="predicted" domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v) => v.toFixed(2)}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={{ stroke: '#1a2f50' }} tickLine={false}
          label={{ value: 'Mean predicted', fill: '#64748b', fontSize: 11, position: 'insideBottom', offset: -6 }}
        />
        <YAxis
          type="number" dataKey="actual" domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v) => v.toFixed(2)}
          tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false} tickLine={false} width={40}
          label={{ value: 'Actual reversion', fill: '#64748b', fontSize: 11, angle: -90, position: 'insideLeft' }}
        />
        <ZAxis type="number" dataKey="count" range={[40, 360]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3', stroke: '#2a4a75' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload
            return (
              <div className="bg-q-elevated border border-q-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
                <p className="text-q-accent">predicted {d.predicted.toFixed(3)}</p>
                <p className="text-q-green">actual {d.actual.toFixed(3)}</p>
                <p className="text-q-faint">n = {d.count}</p>
              </div>
            )
          }}
        />
        {/* Perfect-calibration diagonal */}
        <ReferenceLine
          segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
          stroke="#475569" strokeDasharray="5 4" strokeWidth={1}
          ifOverflow="hidden"
        />
        <Scatter data={points} fill="#38bdf8" line={{ stroke: '#38bdf8', strokeWidth: 1.2 }} shape="circle" />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

function CalibrationPanel({ calibration }) {
  if (!calibration || !calibration.bins?.length) return null
  const extreme = calibration.extreme_bin_fraction
  // High extreme-bin mass *together with* a reliability curve that hugs the
  // diagonal is fine (genuinely easy/hard bars). Overconfidence looks like
  // extreme mass that does NOT track actual outcomes — flagged amber.
  const overconfident = extreme != null && extreme > 0.85
  return (
    <div className="rounded-xl border border-q-border bg-q-surface p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-q-accent" />
        <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">
          Probability Calibration — Test Set
        </p>
        {extreme != null && (
          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded border ${
            overconfident
              ? 'text-q-amber border-q-amber/30 bg-q-amber/10'
              : 'text-q-green border-q-green/30 bg-q-green/10'
          }`}>
            {(extreme * 100).toFixed(0)}% IN 0/1 BINS
            {overconfident ? ' · OVERCONFIDENT' : ' · CALIBRATED'}
          </span>
        )}
      </div>

      <p className="text-sm text-q-muted leading-relaxed border-l-2 border-q-accent/40 pl-3">
        A leaking model piles probabilities at 0 and 1 and the reliability dots
        leave the diagonal. An honest model spreads its mass and the dots track
        the dashed identity line — predicted probability ≈ actual reversion rate.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionLabel>Predicted-probability histogram</SectionLabel>
          <CalibrationHistogram bins={calibration.bins} />
        </div>
        <div>
          <SectionLabel>Reliability curve</SectionLabel>
          <ReliabilityCurve bins={calibration.bins} />
        </div>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-5 text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-q-surface border border-q-border flex items-center justify-center">
        <Brain size={28} className="text-q-violet opacity-60" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-q-text mb-2">ML Signals</h3>
        <p className="text-q-muted text-sm max-w-md leading-relaxed">
          Train a classifier on engineered spread features to predict mean
          reversion, then compare its trade signals against the rule-based
          z-score baseline.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-q-faint">
        {['Logistic', 'GBM', 'Random Forest'].map((t) => (
          <div key={t} className="px-3 py-2 rounded-lg border border-q-border bg-q-surface">{t}</div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────

export default function MLSignals({ initialPair }) {
  const [form, setForm] = useState({
    ...DEFAULT_FORM,
    ticker_a: initialPair?.ticker_a ?? DEFAULT_FORM.ticker_a,
    ticker_b: initialPair?.ticker_b ?? DEFAULT_FORM.ticker_b,
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  const handleRun = useCallback(async (e) => {
    e?.preventDefault?.()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.runMLSignals(form)
      setResult(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [form, loading])

  const pair = result ? `${result.ticker_a} / ${result.ticker_b}` : `${form.ticker_a} / ${form.ticker_b}`

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-q-violet" />
            <h2 className="text-xl font-bold text-q-text font-mono">
              ML Signals
              <span className="text-q-faint font-normal ml-2 text-base">— {pair}</span>
            </h2>
          </div>
          <p className="text-q-faint text-xs mt-0.5">
            Sklearn classifier · engineered spread features · vs. baseline z-score strategy
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-q-border bg-q-surface text-q-muted text-xs hover:border-q-border-bright hover:text-q-text transition-colors"
          >
            Advanced
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            onClick={handleRun}
            disabled={loading}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg font-semibold text-sm transition-all ${
              loading
                ? 'bg-q-violet/20 text-q-violet/50 cursor-not-allowed border border-q-violet/20'
                : 'bg-q-violet text-white hover:bg-violet-400 active:scale-[0.98] shadow-lg shadow-q-violet/20'
            }`}
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-q-violet/40 border-t-white rounded-full animate-spin" />
                Training…
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" />
                Train & Compare
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Form ── */}
      <form
        onSubmit={handleRun}
        className="rounded-xl border border-q-border bg-q-surface p-4 space-y-4"
      >
        {/* Pair + dates */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Ticker A">
            <input
              type="text"
              value={form.ticker_a}
              onChange={(e) => set('ticker_a', e.target.value.toUpperCase())}
              required
            />
          </Field>
          <Field label="Ticker B">
            <input
              type="text"
              value={form.ticker_b}
              onChange={(e) => set('ticker_b', e.target.value.toUpperCase())}
              required
            />
          </Field>
          <Field label="Start">
            <input type="date" value={form.start} onChange={(e) => set('start', e.target.value)} required />
          </Field>
          <Field label="End">
            <input type="date" value={form.end} onChange={(e) => set('end', e.target.value)} required />
          </Field>
        </div>

        {/* Model picker */}
        <div>
          <p className="text-xs font-medium text-q-muted mb-2">Model</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MODEL_OPTIONS.map((m) => {
              const active = form.model_type === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => set('model_type', m.id)}
                  className={`flex flex-col items-start text-left px-3 py-2 rounded-lg border transition-all ${
                    active
                      ? 'border-q-violet/50 bg-q-violet/10 text-q-violet'
                      : 'border-q-border bg-q-elevated text-q-muted hover:border-q-border-bright hover:text-q-text'
                  }`}
                >
                  <span className="text-sm font-semibold">{m.label}</span>
                  <span className="text-[11px] text-q-faint">{m.desc}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Core params */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Z Lookback" hint="bars">
            <NumInput value={form.zscore_lookback} onChange={(v) => set('zscore_lookback', v)} min={5} max={252} />
          </Field>
          <Field label="Entry Z" hint="σ">
            <NumInput value={form.entry_z} onChange={(v) => set('entry_z', v)} step={0.1} min={0.5} max={5} />
          </Field>
          <Field label="Exit Z (target)" hint="σ">
            <NumInput value={form.exit_z} onChange={(v) => set('exit_z', v)} step={0.1} min={0.1} max={4} />
          </Field>
          <Field label="Target horizon" hint="bars">
            <NumInput value={form.n_bars_target} onChange={(v) => set('n_bars_target', v)} min={1} max={30} />
          </Field>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-q-border bg-q-elevated p-3">
            <Field label="Train fraction">
              <NumInput value={form.train_fraction} onChange={(v) => set('train_fraction', v)} step={0.05} min={0.3} max={0.9} />
            </Field>
            <Field label="Long threshold" hint="p >">
              <NumInput value={form.long_threshold} onChange={(v) => set('long_threshold', v)} step={0.05} min={0.5} max={0.95} />
            </Field>
            <Field label="Short threshold" hint="p <">
              <NumInput value={form.short_threshold} onChange={(v) => set('short_threshold', v)} step={0.05} min={0.05} max={0.5} />
            </Field>
            <Field label="Capital" hint="$">
              <NumInput value={form.initial_capital} onChange={(v) => set('initial_capital', v)} step={10000} min={1000} />
            </Field>
            <Field label="Cost" hint="frac/leg">
              <NumInput value={form.transaction_cost} onChange={(v) => set('transaction_cost', v)} step={0.0005} min={0} max={0.01} />
            </Field>
            <Field label="Beta Lookback" hint="bars">
              <NumInput value={form.beta_lookback} onChange={(v) => set('beta_lookback', v)} min={10} max={252} />
            </Field>
          </div>
        )}
      </form>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-q-red/10 border border-q-red/30 text-q-red text-sm">
          <strong>Error: </strong>{error}
        </div>
      )}

      {/* ── Results ── */}
      {!result ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {/* Test-set classifier metrics */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Target size={14} className="text-q-accent" />
              <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">
                Test-Set Classification
              </p>
              {result.test_window?.start && (
                <span className="text-[10px] font-mono text-q-faint">
                  {result.test_window.start} → {result.test_window.end}
                </span>
              )}
              <span className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded bg-q-violet/15 text-q-violet border border-q-violet/30">
                {result.model_label}
              </span>
            </div>
            <ClassifierMetricsRow metrics={result.classification_metrics} />
          </div>

          {/* Feature importance + ROC curve */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-q-border bg-q-surface p-4">
              <SectionLabel>Feature Importance</SectionLabel>
              <FeatureImportanceChart data={result.feature_importance} />
            </div>
            <div className="rounded-xl border border-q-border bg-q-surface p-4">
              <SectionLabel>ROC Curve</SectionLabel>
              <ROCCurveChart
                data={result.roc_curve}
                auc={result.classification_metrics?.auc_roc}
              />
            </div>
          </div>

          {/* Probability calibration */}
          <CalibrationPanel calibration={result.calibration} />

          {/* KPI comparison */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-q-violet" />
              <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">
                ML vs. Baseline — 12 KPIs
              </p>
            </div>
            <KpiComparison baseline={result.baseline_metrics} ml={result.ml_metrics} />
          </div>

          {/* Equity overlay */}
          <div className="rounded-xl border border-q-border bg-q-surface p-4">
            <SectionLabel>Equity Curves — Baseline vs ML</SectionLabel>
            <EquityOverlay
              baseline={result.timeseries.baseline_equity}
              ml={result.timeseries.ml_equity}
              initialCapital={form.initial_capital}
            />
          </div>

          {/* Feature time series */}
          <div className="rounded-xl border border-q-border bg-q-surface p-4">
            <SectionLabel>
              Z-Score &amp; ML Reversion Probability
            </SectionLabel>
            <FeatureTimeSeriesChart
              data={result.timeseries.features}
              entryZ={form.entry_z}
              longThr={form.long_threshold}
              shortThr={form.short_threshold}
            />
          </div>

          {/* Threshold sweep */}
          <ThresholdSweepPanel sweep={result.threshold_sweep} />
        </div>
      )}
    </div>
  )
}
