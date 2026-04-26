import { useState, useCallback } from 'react'
import { FlaskConical, Play, ChevronDown, ChevronUp } from 'lucide-react'
import RobustnessSummaryCards from './RobustnessSummaryCards.jsx'
import RobustnessInsightPanel from './RobustnessInsightPanel.jsx'
import SharpeHistChart from './SharpeHistChart.jsx'
import BootstrapReturnChart from './BootstrapReturnChart.jsx'
import CostSensitivityChart from './CostSensitivityChart.jsx'

function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold tracking-widest uppercase text-q-faint mb-3">
      {children}
    </p>
  )
}

function ConfigPanel({ config, onChange }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg border border-q-border bg-q-elevated text-xs">
      {[
        { key: 'n_window_sims',    label: 'Window Sims',     min: 50,  max: 500,  step: 50  },
        { key: 'window_years',     label: 'Window Size (yr)', min: 0.5, max: 5,    step: 0.5 },
        { key: 'n_bootstrap_sims', label: 'Bootstrap Sims',  min: 100, max: 2000, step: 100 },
      ].map(({ key, label, min, max, step }) => (
        <div key={key} className="space-y-1">
          <label className="text-q-faint font-medium">{label}</label>
          <input
            type="number"
            value={config[key]}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(key, Number(e.target.value))}
          />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-5 text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-q-surface border border-q-border flex items-center justify-center">
        <FlaskConical size={28} className="text-q-violet opacity-60" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-q-text mb-2">Robustness Lab</h3>
        <p className="text-q-muted text-sm max-w-md leading-relaxed">
          First run a backtest on the{' '}
          <span className="text-q-accent font-medium">Backtest</span> tab, then return here
          to stress-test the strategy across hundreds of randomised scenarios.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-q-faint">
        {['Random Windows', 'Bootstrap Trades', 'Cost Sweep'].map((t) => (
          <div key={t} className="px-3 py-2 rounded-lg border border-q-border bg-q-surface">{t}</div>
        ))}
      </div>
    </div>
  )
}

const DEFAULT_CONFIG = {
  n_window_sims: 200,
  window_years: 2.0,
  n_bootstrap_sims: 500,
}

// robResult and loading are owned by App — passed in as props
export default function RobustnessLab({ backtestResult, robResult, robError, onRun, loading }) {
  const [config, setConfig]         = useState(DEFAULT_CONFIG)
  const [showConfig, setShowConfig] = useState(false)

  const updateConfig = useCallback((key, val) => {
    setConfig((c) => ({ ...c, [key]: val }))
  }, [])

  const handleRun = useCallback(() => {
    if (!backtestResult || loading) return
    onRun({
      ticker_a: backtestResult.ticker_a,
      ticker_b: backtestResult.ticker_b,
      start: backtestResult.metrics?.start ?? '2020-01-01',
      end:   backtestResult.metrics?.end   ?? '2024-12-31',
      ...backtestResult.params,
      initial_capital:        backtestResult.config?.initial_capital ?? 100_000,
      transaction_cost_bps:   backtestResult.config?.transaction_cost_bps ?? 10,
      target_dollar_exposure: backtestResult.config?.target_dollar_exposure ?? null,
      ...config,
    })
  }, [backtestResult, config, loading, onRun])

  if (!backtestResult) return <EmptyState />

  const pair = `${backtestResult.ticker_a} / ${backtestResult.ticker_b}`

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-q-violet" />
            <h2 className="text-xl font-bold text-q-text font-mono">
              Robustness Lab
              <span className="text-q-faint font-normal ml-2 text-base">— {pair}</span>
            </h2>
          </div>
          <p className="text-q-faint text-xs mt-0.5">
            Monte Carlo analysis · Bootstrap resampling · Cost sensitivity
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-q-border bg-q-surface text-q-muted text-xs hover:border-q-border-bright hover:text-q-text transition-colors"
          >
            Config
            {showConfig ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
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
                Running…
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" />
                Run Robustness Test
              </>
            )}
          </button>
        </div>
      </div>

      {showConfig && <ConfigPanel config={config} onChange={updateConfig} />}

      {robError && (
        <div className="px-4 py-3 rounded-lg bg-q-red/10 border border-q-red/30 text-q-red text-sm">
          <strong>Error: </strong>{robError}
        </div>
      )}

      {/* ── Results ── */}
      {!robResult ? (
        <div className="rounded-xl border border-q-border bg-q-surface p-8 text-center text-q-faint text-sm">
          Configure and click{' '}
          <span className="text-q-violet font-medium">Run Robustness Test</span> to begin.
          <br />
          <span className="text-xs mt-1 block">
            Default: {DEFAULT_CONFIG.n_window_sims} random {DEFAULT_CONFIG.window_years}-year windows
            · {DEFAULT_CONFIG.n_bootstrap_sims} bootstrap iterations · 9 cost levels
          </span>
        </div>
      ) : (
        <div className="space-y-6">
          <RobustnessSummaryCards
            score={robResult.robustness_score}
            summary={robResult.summary}
            params={robResult.params}
          />

          <RobustnessInsightPanel
            insight={robResult.insight}
            score={robResult.robustness_score}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-q-border bg-q-surface p-4">
              <SectionLabel>
                Sharpe Distribution — {robResult.params?.n_window_sims} Random Windows
                ({robResult.params?.window_years}yr each)
              </SectionLabel>
              <SharpeHistChart
                windowRuns={robResult.window_runs}
                meanSharpe={robResult.summary?.mean_sharpe}
              />
            </div>
            <div className="rounded-xl border border-q-border bg-q-surface p-4">
              <SectionLabel>
                Return Distribution — {robResult.params?.n_bootstrap_sims} Bootstrap Simulations
              </SectionLabel>
              <BootstrapReturnChart
                bootstrapRuns={robResult.bootstrap_runs}
                meanReturn={robResult.summary?.bootstrap_mean_return}
              />
            </div>
          </div>

          <div className="rounded-xl border border-q-border bg-q-surface p-4">
            <SectionLabel>Transaction Cost Sensitivity</SectionLabel>
            <p className="text-xs text-q-faint mb-3">
              Return and Sharpe as a function of cost in basis points.
              Amber marker = strategy base cost (
              {backtestResult.config?.transaction_cost_bps ?? 10} bps).
            </p>
            <CostSensitivityChart
              costRuns={robResult.cost_sensitivity}
              baseCostBps={backtestResult.config?.transaction_cost_bps ?? 10}
            />
          </div>
        </div>
      )}
    </div>
  )
}
