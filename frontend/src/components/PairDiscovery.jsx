import { useState, useCallback } from 'react'
import { Search, ChevronDown, ChevronUp, Database } from 'lucide-react'
import ScreenerTable from './ScreenerTable.jsx'

const UNIVERSES = ['SP500', 'TECH', 'ENERGY', 'FINANCE', 'CONSUMER', 'HEALTHCARE']

const UNIVERSE_META = {
  SP500:      { desc: '~60 liquid large-caps across all sectors',  count: 60 },
  TECH:       { desc: 'Technology & software growth stocks',       count: 25 },
  ENERGY:     { desc: 'Oil, gas, energy, and commodity ETFs',      count: 19 },
  FINANCE:    { desc: 'Banks, asset managers, and payments',       count: 20 },
  CONSUMER:   { desc: 'Staples & discretionary consumer brands',   count: 20 },
  HEALTHCARE: { desc: 'Pharma, biotech, and med-devices',          count: 18 },
}

const DEFAULT_CONFIG = {
  start: '2020-01-01',
  end:   '2024-12-31',
  min_correlation: 0.6,
  max_pairs: 300,
  top_k: 20,
  run_backtest: true,
  n_workers: 4,
  zscore_lookback: 60,
  entry_z: 2.0,
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-q-muted">{label}</label>
        {hint && <span className="text-[10px] text-q-faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function EmptyPrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="w-14 h-14 rounded-xl bg-q-surface border border-q-border flex items-center justify-center">
        <Search size={22} className="text-q-accent opacity-50" />
      </div>
      <div>
        <p className="text-q-text font-medium mb-1">No scan results yet</p>
        <p className="text-q-muted text-xs max-w-xs leading-relaxed">
          Select a universe above and click{' '}
          <span className="text-q-accent font-medium">Scan Universe</span> to discover
          statistically robust pair candidates.
        </p>
      </div>
    </div>
  )
}

export default function PairDiscovery({ onRunBacktest, loading }) {
  const [universe, setUniverse]       = useState('SP500')
  const [customTickers, setCustom]    = useState('')
  const [useCustom, setUseCustom]     = useState(false)
  const [showAdvanced, setShowAdv]    = useState(false)
  const [config, setConfig]           = useState(DEFAULT_CONFIG)
  const [screenerResult, setResult]   = useState(null)
  const [error, setError]             = useState(null)

  const setConf = (key, val) => setConfig(c => ({ ...c, [key]: val }))

  const handleScan = useCallback(async () => {
    if (loading) return
    setError(null)

    const payload = {
      ...config,
      ...(useCustom
        ? { tickers: customTickers.split(',').map(t => t.trim()).filter(Boolean) }
        : { universe }
      ),
    }

    // Delegate to parent via onRunBacktest=null; screener has its own handler
    // We call the screener API directly here since it's separate from backtest
    try {
      const res = await fetch('/api/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(body.detail || `HTTP ${res.status}`)
      }
      setResult(await res.json())
    } catch (err) {
      setError(err.message)
    }
  }, [config, universe, customTickers, useCustom, loading])

  // Expose a loading-aware version to parent
  // The parent passes its global loading; we also track local scanning
  const [scanning, setScanning] = useState(false)

  const handleScanClick = useCallback(async () => {
    setScanning(true)
    setError(null)
    setResult(null)
    await handleScan()
    setScanning(false)
  }, [handleScan])

  const isLoading = scanning || loading

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Database size={16} className="text-q-accent" />
          <h2 className="text-xl font-bold text-q-text font-mono">Pair Discovery</h2>
        </div>
        <p className="text-q-faint text-xs">
          Scan a universe of assets, rank all candidate pairs by cointegration strength,
          mean-reversion speed, and backtest performance.
        </p>
      </div>

      {/* ── Universe selector ── */}
      <div className="rounded-xl border border-q-border bg-q-surface p-4 space-y-4">
        <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">
          Select Universe
        </p>

        {/* Tab: preset vs custom */}
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setUseCustom(false)}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              !useCustom
                ? 'bg-q-accent/15 border-q-accent/40 text-q-accent'
                : 'border-q-border text-q-faint hover:text-q-muted'
            }`}
          >
            Named Universe
          </button>
          <button
            onClick={() => setUseCustom(true)}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              useCustom
                ? 'bg-q-accent/15 border-q-accent/40 text-q-accent'
                : 'border-q-border text-q-faint hover:text-q-muted'
            }`}
          >
            Custom Tickers
          </button>
        </div>

        {!useCustom ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {UNIVERSES.map(u => (
              <button
                key={u}
                onClick={() => setUniverse(u)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  universe === u
                    ? 'bg-q-accent/10 border-q-accent/35 text-q-accent'
                    : 'border-q-border bg-q-elevated text-q-muted hover:border-q-border-bright hover:text-q-text'
                }`}
              >
                <p className="font-semibold text-xs font-mono mb-0.5">{u}</p>
                <p className="text-[10px] opacity-70 leading-snug">
                  {UNIVERSE_META[u]?.desc}
                </p>
                <p className="text-[10px] mt-1 opacity-50">
                  ~{UNIVERSE_META[u]?.count} tickers
                </p>
              </button>
            ))}
          </div>
        ) : (
          <Field label="Tickers" hint="comma-separated">
            <textarea
              value={customTickers}
              onChange={e => setCustom(e.target.value)}
              placeholder="AAPL, MSFT, GOOGL, META, AMZN, TSLA, NVDA, AMD …"
              rows={3}
              className="w-full bg-q-elevated border border-q-border rounded-lg px-3 py-2 text-xs font-mono text-q-text placeholder:text-q-faint resize-none outline-none focus:border-q-accent focus:ring-1 focus:ring-q-accent/20"
            />
          </Field>
        )}
      </div>

      {/* ── Date range ── */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <input type="date" value={config.start} onChange={e => setConf('start', e.target.value)} />
        </Field>
        <Field label="End date">
          <input type="date" value={config.end} onChange={e => setConf('end', e.target.value)} />
        </Field>
      </div>

      {/* ── Advanced toggle ── */}
      <button
        onClick={() => setShowAdv(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-q-surface border border-q-border text-xs text-q-muted hover:text-q-text transition-colors"
      >
        <span>Advanced Filters</span>
        {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {showAdvanced && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg border border-q-border bg-q-elevated text-xs">
          {[
            { key: 'min_correlation', label: 'Min |correlation|', step: 0.05, min: 0.3, max: 0.99 },
            { key: 'top_k',           label: 'Top-K results',     step: 5,    min: 5,   max: 100  },
            { key: 'max_pairs',       label: 'Max pairs tested',  step: 50,   min: 50,  max: 2000 },
            { key: 'zscore_lookback', label: 'Z Lookback',        step: 10,   min: 20,  max: 252  },
            { key: 'entry_z',         label: 'Entry Z',           step: 0.1,  min: 0.5, max: 5    },
            { key: 'n_workers',       label: 'Worker threads',    step: 1,    min: 1,   max: 8    },
          ].map(({ key, label, step, min, max }) => (
            <div key={key} className="space-y-1">
              <label className="text-q-faint font-medium">{label}</label>
              <input
                type="number"
                value={config[key]}
                step={step}
                min={min}
                max={max}
                onChange={e => setConf(key, Number(e.target.value))}
              />
            </div>
          ))}

          {/* Run backtest toggle */}
          <div className="space-y-1 col-span-full sm:col-span-1">
            <label className="text-q-faint font-medium">Mini-backtest</label>
            <button
              onClick={() => setConf('run_backtest', !config.run_backtest)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors w-full ${
                config.run_backtest
                  ? 'bg-q-green/10 border-q-green/30 text-q-green'
                  : 'bg-q-elevated border-q-border text-q-faint'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${config.run_backtest ? 'bg-q-green' : 'bg-q-faint'}`} />
              {config.run_backtest ? 'Enabled (slower)' : 'Disabled (fast)'}
            </button>
          </div>
        </div>
      )}

      {/* ── Scan button ── */}
      <button
        onClick={handleScanClick}
        disabled={isLoading}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all ${
          isLoading
            ? 'bg-q-accent/20 text-q-accent/50 cursor-not-allowed border border-q-accent/20'
            : 'bg-q-accent text-q-bg hover:bg-sky-400 active:scale-[0.98] shadow-lg shadow-q-accent/20'
        }`}
      >
        {isLoading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-q-accent/40 border-t-q-accent rounded-full animate-spin" />
            Scanning…
          </>
        ) : (
          <>
            <Search size={14} />
            Scan Universe
          </>
        )}
      </button>

      {/* ── Error ── */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-q-red/10 border border-q-red/30 text-q-red text-sm">
          <strong>Error: </strong>{error}
        </div>
      )}

      {/* ── Results ── */}
      {!screenerResult ? (
        <EmptyPrompt />
      ) : (
        <div className="space-y-4">
          {/* Summary line */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-q-text font-semibold text-sm">
                {screenerResult.pairs_found} pairs found
                <span className="text-q-faint font-normal ml-2 text-xs">
                  from {screenerResult.tickers_screened} tickers ·{' '}
                  {screenerResult.universe} universe
                </span>
              </p>
              <p className="text-q-faint text-xs mt-0.5">
                Sorted by composite score · click{' '}
                <span className="text-q-accent">▶ Backtest</span> on any row to run a full analysis
              </p>
            </div>
            <button
              onClick={() => {
                const csv = [
                  Object.keys(screenerResult.results[0]).join(','),
                  ...screenerResult.results.map(r => Object.values(r).join(',')),
                ].join('\n')
                const blob = new Blob([csv], { type: 'text/csv' })
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `screener_${screenerResult.universe}.csv`
                a.click()
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-q-border bg-q-surface text-q-muted text-xs hover:border-q-accent hover:text-q-accent transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export CSV
            </button>
          </div>

          <ScreenerTable
            results={screenerResult.results}
            onRunBacktest={onRunBacktest}
          />
        </div>
      )}
    </div>
  )
}
