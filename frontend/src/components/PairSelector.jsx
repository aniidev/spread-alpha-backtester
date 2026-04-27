import { useState, useEffect } from 'react'
import { Play, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'

const PRESET_PAIRS = [
  { label: 'MA / V',     a: 'MA',  b: 'V'   },
  { label: 'XOM / CVX',  a: 'XOM', b: 'CVX' },
  { label: 'GLD / SLV',  a: 'GLD', b: 'SLV' },
  { label: 'EWA / EWC',  a: 'EWA', b: 'EWC' },
  { label: 'KO / PEP',   a: 'KO',  b: 'PEP' },
  { label: 'HD / LOW',   a: 'HD',  b: 'LOW' },
]

const DEFAULT_FORM = {
  ticker_a: 'MA',
  ticker_b: 'V',
  start: '2020-01-01',
  end: '2024-12-31',
  zscore_lookback: 60,
  entry_z: 2.0,
  exit_z: 0.0,
  rolling_beta: false,
  beta_lookback: 60,
  train_fraction: 0.5,
  initial_capital: 100000,
  transaction_cost_bps: 10,
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

export default function PairSelector({ onRun, loading, pendingPair, onPendingConsumed }) {
  const [form, setForm]           = useState(DEFAULT_FORM)
  const [showAdvanced, setShowAdv] = useState(false)

  // When the discovery tab fires a pair, auto-fill and immediately run
  useEffect(() => {
    if (!pendingPair || loading) return
    setForm(f => ({ ...f, ticker_a: pendingPair.ticker_a, ticker_b: pendingPair.ticker_b }))
    onRun({ ...DEFAULT_FORM, ticker_a: pendingPair.ticker_a, ticker_b: pendingPair.ticker_b })
    onPendingConsumed?.()
  }, [pendingPair]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  const applyPreset = (pair) => {
    setForm((f) => ({ ...f, ticker_a: pair.a, ticker_b: pair.b }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!loading) onRun(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Section title */}
      <div className="flex items-center gap-2">
        <Settings2 size={13} className="text-q-accent" />
        <span className="text-xs font-semibold tracking-widest uppercase text-q-muted">
          Strategy Setup
        </span>
      </div>

      {/* Preset pair buttons */}
      <div>
        <p className="text-xs text-q-faint mb-2">Quick pairs</p>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_PAIRS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className={`px-2 py-1.5 rounded-md text-xs font-mono transition-all border ${
                form.ticker_a === p.a && form.ticker_b === p.b
                  ? 'bg-q-accent/15 border-q-accent/40 text-q-accent'
                  : 'bg-q-elevated border-q-border text-q-muted hover:border-q-border-bright hover:text-q-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom tickers */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Ticker A">
          <input
            type="text"
            value={form.ticker_a}
            onChange={(e) => set('ticker_a', e.target.value.toUpperCase())}
            placeholder="e.g. MA"
            required
          />
        </Field>
        <Field label="Ticker B">
          <input
            type="text"
            value={form.ticker_b}
            onChange={(e) => set('ticker_b', e.target.value.toUpperCase())}
            placeholder="e.g. V"
            required
          />
        </Field>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start">
          <input
            type="date"
            value={form.start}
            onChange={(e) => set('start', e.target.value)}
            required
          />
        </Field>
        <Field label="End">
          <input
            type="date"
            value={form.end}
            onChange={(e) => set('end', e.target.value)}
            required
          />
        </Field>
      </div>

      {/* Advanced params toggle */}
      <button
        type="button"
        onClick={() => setShowAdv((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-q-elevated border border-q-border text-xs text-q-muted hover:text-q-text transition-colors"
      >
        <span>Advanced Parameters</span>
        {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {showAdvanced && (
        <div className="space-y-3 rounded-lg border border-q-border bg-q-elevated p-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Z Lookback" hint="bars">
              <NumInput value={form.zscore_lookback} onChange={(v) => set('zscore_lookback', v)} min={5} max={252} />
            </Field>
            <Field label="Entry Z" hint="σ">
              <NumInput value={form.entry_z} onChange={(v) => set('entry_z', v)} step={0.1} min={0.5} max={5} />
            </Field>
            <Field label="Exit Z" hint="σ">
              <NumInput value={form.exit_z} onChange={(v) => set('exit_z', v)} step={0.1} min={0} max={4} />
            </Field>
            <Field label="Beta Lookback" hint="bars">
              <NumInput value={form.beta_lookback} onChange={(v) => set('beta_lookback', v)} min={10} max={252} />
            </Field>
            <Field label="Initial Capital" hint="$">
              <NumInput value={form.initial_capital} onChange={(v) => set('initial_capital', v)} min={1000} step={10000} />
            </Field>
            <Field label="Cost" hint="bps">
              <NumInput value={form.transaction_cost_bps} onChange={(v) => set('transaction_cost_bps', v)} step={1} min={0} max={100} />
            </Field>
          </div>

          {/* Rolling beta toggle */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <div
              onClick={() => set('rolling_beta', !form.rolling_beta)}
              className={`relative w-8 h-4 rounded-full transition-colors border ${
                form.rolling_beta
                  ? 'bg-q-accent/30 border-q-accent/50'
                  : 'bg-q-surface border-q-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                  form.rolling_beta
                    ? 'left-4 bg-q-accent'
                    : 'left-0.5 bg-q-faint'
                }`}
              />
            </div>
            <span className="text-xs text-q-muted group-hover:text-q-text transition-colors">
              Rolling beta estimation
            </span>
          </label>
        </div>
      )}

      {/* Run button */}
      <button
        type="submit"
        disabled={loading}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all ${
          loading
            ? 'bg-q-accent/20 text-q-accent/50 cursor-not-allowed border border-q-accent/20'
            : 'bg-q-accent text-q-bg hover:bg-sky-400 active:scale-[0.98] shadow-lg shadow-q-accent/20'
        }`}
      >
        {loading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-q-accent/50 border-t-q-accent rounded-full animate-spin" />
            Running…
          </>
        ) : (
          <>
            <Play size={14} fill="currentColor" />
            Run Backtest
          </>
        )}
      </button>
    </form>
  )
}
