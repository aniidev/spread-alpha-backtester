import { useState, useEffect, useCallback } from 'react'
import { Activity, BarChart2, FlaskConical } from 'lucide-react'
import { api } from './api/client.js'
import PairSelector from './components/PairSelector.jsx'
import RunHistory from './components/RunHistory.jsx'
import KPICards from './components/KPICards.jsx'
import InsightPanel from './components/InsightPanel.jsx'
import EquityCurveChart from './components/EquityCurveChart.jsx'
import ZScoreChart from './components/ZScoreChart.jsx'
import DrawdownChart from './components/DrawdownChart.jsx'
import TradeHistogramChart from './components/TradeHistogramChart.jsx'
import LoadingOverlay from './components/LoadingOverlay.jsx'
import RobustnessLab from './components/RobustnessLab.jsx'

// ── Empty state ───────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 text-center px-8">
      <div className="w-20 h-20 rounded-2xl bg-q-surface border border-q-border flex items-center justify-center">
        <Activity size={36} className="text-q-accent opacity-60" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-q-text mb-2">No backtest results yet</h2>
        <p className="text-q-muted text-sm max-w-sm leading-relaxed">
          Select a ticker pair in the panel on the left, configure your strategy parameters,
          and click <span className="text-q-accent font-medium">Run Backtest</span> to begin.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-2">
        {['MA / V', 'XOM / CVX', 'GLD / SLV'].map((p) => (
          <div
            key={p}
            className="px-4 py-2 rounded-lg bg-q-surface border border-q-border text-xs font-mono text-q-muted"
          >
            {p}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Results header ────────────────────────────────────────────

function ResultsHeader({ result, onExport }) {
  const ts = result.timestamp
    ? new Date(result.timestamp).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-q-text font-mono tracking-tight">
            {result.ticker_a}
            <span className="text-q-faint mx-1">/</span>
            {result.ticker_b}
          </h2>
          {result.cointegration && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-semibold tracking-wide ${
                result.cointegration.is_cointegrated
                  ? 'bg-q-green/10 text-q-green border border-q-green/20'
                  : 'bg-q-red/10 text-q-red border border-q-red/20'
              }`}
            >
              {result.cointegration.is_cointegrated ? 'COINTEGRATED' : 'NOT COINTEGRATED'}
            </span>
          )}
        </div>
        {ts && <p className="text-q-faint text-xs mt-1">Run at {ts}</p>}
      </div>
      <button
        onClick={onExport}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-q-surface border border-q-border text-q-muted text-xs hover:border-q-accent hover:text-q-accent transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export CSV
      </button>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold tracking-widest uppercase text-q-faint mb-3">
      {children}
    </p>
  )
}

function exportTradesToCsv(result) {
  if (!result?.trades?.length) return
  const cols = ['side', 'entry_date', 'exit_date', 'pnl', 'return', 'beta', 'forced_close']
  const header = cols.join(',')
  const rows = result.trades.map((t) =>
    cols.map((c) => (t[c] == null ? '' : t[c])).join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${result.ticker_a}_${result.ticker_b}_trades.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Tab nav ───────────────────────────────────────────────────

const TABS = [
  { id: 'backtest',   label: 'Backtest',      Icon: BarChart2    },
  { id: 'robustness', label: 'Robustness Lab', Icon: FlaskConical },
]

function TabNav({ active, onChange }) {
  return (
    <div className="flex gap-1 px-6 border-b border-q-border bg-q-surface/40">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-all border-b-2 -mb-px ${
            active === id
              ? 'border-q-accent text-q-accent'
              : 'border-transparent text-q-faint hover:text-q-muted'
          }`}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Backtest results view ─────────────────────────────────────

function BacktestView({ result, onExport }) {
  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <ResultsHeader result={result} onExport={onExport} />
      <KPICards metrics={result.metrics} cointegration={result.cointegration} />
      <InsightPanel insight={result.insight} cointegration={result.cointegration} />

      <div className="rounded-xl border border-q-border bg-q-surface p-4">
        <SectionLabel>Equity Curve</SectionLabel>
        <EquityCurveChart
          data={result.timeseries.equity}
          initialCapital={result.config?.initial_capital ?? 100000}
        />
      </div>

      <div className="rounded-xl border border-q-border bg-q-surface p-4">
        <SectionLabel>Z-Score · Entry bands ±{result.params?.entry_z ?? 2.0}</SectionLabel>
        <ZScoreChart
          data={result.timeseries.zscore}
          entryZ={result.params?.entry_z ?? 2.0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-q-border bg-q-surface p-4">
          <SectionLabel>Drawdown</SectionLabel>
          <DrawdownChart data={result.timeseries.drawdown} />
        </div>
        <div className="rounded-xl border border-q-border bg-q-surface p-4">
          <SectionLabel>Trade Return Distribution</SectionLabel>
          <TradeHistogramChart trades={result.trades} />
        </div>
      </div>
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────

export default function App() {
  // backtest state
  const [result, setResult]       = useState(null)
  // robustness state — lives here so it survives tab switches
  const [robResult, setRobResult] = useState(null)
  const [robError, setRobError]   = useState(null)

  const [loading, setLoading]     = useState(false)
  const [loadingMsg, setLoadingMsg] = useState(null)
  const [error, setError]         = useState(null)
  const [history, setHistory]     = useState([])
  const [activeTab, setActiveTab] = useState('backtest')

  const refreshHistory = useCallback(async () => {
    try { setHistory(await api.getHistory()) } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { refreshHistory() }, [refreshHistory])

  // ── Backtest handler ──────────────────────────────────────
  const handleRun = useCallback(async (params) => {
    setLoading(true)
    setLoadingMsg(null)
    setError(null)
    try {
      const res = await api.runBacktest(params)
      setResult(res)
      setRobResult(null)   // clear stale robustness result for the new pair
      setRobError(null)
      setActiveTab('backtest')
      refreshHistory()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [refreshHistory])

  // ── Robustness handler ────────────────────────────────────
  const handleRunRobustness = useCallback(async (payload) => {
    setLoading(true)
    setLoadingMsg('Running Monte Carlo simulations…')
    setRobError(null)
    try {
      const res = await api.runRobustness(payload)
      setRobResult(res)
    } catch (err) {
      setRobError(err.message)
    } finally {
      setLoading(false)
      setLoadingMsg(null)
    }
  }, [])

  const handleLoadRun = useCallback(async (runId) => {
    setLoading(true)
    setLoadingMsg(null)
    setError(null)
    try {
      setResult(await api.getRun(runId))
      setRobResult(null)
      setRobError(null)
      setActiveTab('backtest')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleClearHistory = useCallback(async () => {
    try { await api.clearHistory(); setHistory([]) } catch { /* non-fatal */ }
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-q-bg">
      {/* ── Header ── */}
      <header className="flex-none border-b border-q-border bg-q-surface/60 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-q-accent/10 border border-q-accent/30 flex items-center justify-center">
              <Activity size={14} className="text-q-accent" />
            </div>
            <div>
              <span className="font-semibold text-q-text text-sm tracking-wide">SPREAD ALPHA</span>
              <span className="ml-2 text-q-faint text-xs">Statistical Arbitrage Backtester</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-q-faint font-mono">
            <span className="hidden md:block">pairs-trading · mean-reversion · monte-carlo</span>
            <span className="w-2 h-2 rounded-full bg-q-green animate-pulse-slow" title="API online" />
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="flex-none w-72 xl:w-80 border-r border-q-border bg-q-surface/30 flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-q-border">
            <PairSelector onRun={handleRun} loading={loading} />
          </div>
          <div className="flex-1 p-4 overflow-y-auto">
            <RunHistory
              history={history}
              activeRunId={result?.run_id}
              onLoad={handleLoadRun}
              onClear={handleClearHistory}
            />
          </div>
        </aside>

        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {error && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-q-red/10 border border-q-red/30 text-q-red text-sm flex-none">
              <strong>Error: </strong>{error}
            </div>
          )}

          {result && <TabNav active={activeTab} onChange={setActiveTab} />}

          <main className="flex-1 overflow-y-auto">
            {!result ? (
              <EmptyState />
            ) : activeTab === 'backtest' ? (
              <BacktestView
                result={result}
                onExport={() => exportTradesToCsv(result)}
              />
            ) : (
              <RobustnessLab
                backtestResult={result}
                robResult={robResult}
                robError={robError}
                onRun={handleRunRobustness}
                loading={loading}
              />
            )}
          </main>
        </div>
      </div>

      {loading && <LoadingOverlay message={loadingMsg} />}
    </div>
  )
}
