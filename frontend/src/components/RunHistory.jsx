import { Clock, Trash2, ChevronRight } from 'lucide-react'
import { fmt } from '../utils/format.js'

function HistoryItem({ run, active, onLoad }) {
  const ts = run.timestamp
    ? new Date(run.timestamp).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null

  const sharpe = run.metrics?.sharpe_ratio
  const ret    = run.metrics?.total_return
  const mdd    = run.metrics?.max_drawdown

  return (
    <button
      onClick={() => onLoad(run.run_id)}
      className={`w-full text-left rounded-lg border p-3 transition-all group ${
        active
          ? 'bg-q-accent/10 border-q-accent/30'
          : 'bg-q-elevated border-q-border hover:border-q-border-bright'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`font-mono font-semibold text-sm ${active ? 'text-q-accent' : 'text-q-text'}`}>
          {run.ticker_a} / {run.ticker_b}
        </span>
        <ChevronRight size={12} className="text-q-faint group-hover:text-q-accent transition-colors" />
      </div>

      {ts && <p className="text-xs text-q-faint mb-2">{ts}</p>}

      <div className="grid grid-cols-3 gap-1 text-xs font-mono">
        <div>
          <p className="text-q-faint text-[10px] mb-0.5">Return</p>
          <p className={ret != null && ret >= 0 ? 'text-q-green' : 'text-q-red'}>
            {fmt.pct(ret)}
          </p>
        </div>
        <div>
          <p className="text-q-faint text-[10px] mb-0.5">Sharpe</p>
          <p className={
            sharpe == null ? 'text-q-muted'
            : sharpe >= 1   ? 'text-q-green'
            : sharpe >= 0   ? 'text-q-amber'
            : 'text-q-red'
          }>
            {fmt.decimal(sharpe)}
          </p>
        </div>
        <div>
          <p className="text-q-faint text-[10px] mb-0.5">MDD</p>
          <p className="text-q-red">{fmt.pct(mdd)}</p>
        </div>
      </div>

      {run.is_cointegrated != null && (
        <div className="mt-2">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
              run.is_cointegrated
                ? 'bg-q-green/10 text-q-green'
                : 'bg-q-red/10 text-q-red'
            }`}
          >
            {run.is_cointegrated ? 'cointegrated' : 'not cointegrated'}
          </span>
        </div>
      )}
    </button>
  )
}

export default function RunHistory({ history, activeRunId, onLoad, onClear }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-q-faint" />
          <span className="text-xs font-semibold tracking-widest uppercase text-q-faint">
            Recent Runs
          </span>
        </div>
        {history.length > 0 && (
          <button
            onClick={onClear}
            className="text-q-faint hover:text-q-red transition-colors"
            title="Clear all history"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <p className="text-xs text-q-faint text-center py-6">
          No runs yet. Results will appear here after your first backtest.
        </p>
      ) : (
        <div className="space-y-2">
          {history.map((run) => (
            <HistoryItem
              key={run.run_id}
              run={run}
              active={run.run_id === activeRunId}
              onLoad={onLoad}
            />
          ))}
        </div>
      )}
    </div>
  )
}
