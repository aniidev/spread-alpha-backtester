import { fmt } from '../utils/format.js'
import RobustnessScoreGauge from './RobustnessScoreGauge.jsx'

function StatRow({ label, value, colorClass = 'text-q-text' }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-q-border last:border-0">
      <span className="text-xs text-q-faint">{label}</span>
      <span className={`text-xs font-mono font-semibold ${colorClass}`}>{value}</span>
    </div>
  )
}

function MiniCard({ label, value, sub, colorClass }) {
  return (
    <div className="rounded-lg border border-q-border bg-q-elevated p-3">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-q-faint mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${colorClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-q-faint mt-0.5">{sub}</p>}
    </div>
  )
}

export default function RobustnessSummaryCards({ score, summary, params }) {
  const s = summary ?? {}

  const mean_sh  = s.mean_sharpe
  const ci_lo    = s.sharpe_ci_low
  const ci_hi    = s.sharpe_ci_high
  const pct_pos  = s.pct_positive_sharpe
  const worst_dd = s.worst_drawdown
  const b_pos    = s.bootstrap_pct_positive
  const bkeven   = s.breakeven_cost_bps
  const mean_ret = s.mean_return

  return (
    <div className="rounded-xl border border-q-border bg-q-surface p-4">
      <p className="text-xs font-semibold tracking-widest uppercase text-q-faint mb-4">
        Robustness Summary
      </p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Gauge */}
        <div className="flex-none flex flex-col items-center justify-center lg:border-r border-q-border lg:pr-6">
          <RobustnessScoreGauge score={score} />
          {params && (
            <p className="text-[10px] text-q-faint mt-2 text-center leading-relaxed">
              {params.n_window_sims} windows · {params.window_years}yr ·{' '}
              {params.n_bootstrap_sims} bootstrap
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Window stats */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-q-faint mb-2">
              Random Window Stats
            </p>
            <div className="space-y-0">
              <StatRow
                label="Mean Sharpe"
                value={fmt.decimal(mean_sh)}
                colorClass={mean_sh != null && mean_sh >= 0 ? 'text-q-green' : 'text-q-red'}
              />
              <StatRow
                label="95% CI"
                value={ci_lo != null && ci_hi != null ? `[${fmt.decimal(ci_lo)}, ${fmt.decimal(ci_hi)}]` : '—'}
                colorClass="text-q-muted"
              />
              <StatRow
                label="% Positive Windows"
                value={fmt.pct(pct_pos)}
                colorClass={pct_pos != null && pct_pos >= 0.6 ? 'text-q-green' : 'text-q-amber'}
              />
              <StatRow
                label="Mean Return"
                value={fmt.pct(mean_ret)}
                colorClass={mean_ret != null && mean_ret >= 0 ? 'text-q-green' : 'text-q-red'}
              />
              <StatRow
                label="Worst Drawdown"
                value={fmt.pct(worst_dd)}
                colorClass="text-q-red"
              />
            </div>
          </div>

          {/* Bootstrap + cost stats */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-q-faint mb-2">
              Bootstrap &amp; Cost Analysis
            </p>
            <div className="space-y-0">
              <StatRow
                label="Bootstrap % Profitable"
                value={fmt.pct(b_pos)}
                colorClass={b_pos != null && b_pos >= 0.6 ? 'text-q-green' : 'text-q-amber'}
              />
              <StatRow
                label="Bootstrap CI (ret)"
                value={
                  s.bootstrap_ci_low != null && s.bootstrap_ci_high != null
                    ? `[${fmt.pct(s.bootstrap_ci_low)}, ${fmt.pct(s.bootstrap_ci_high)}]`
                    : '—'
                }
                colorClass="text-q-muted"
              />
              <StatRow
                label="Breakeven Cost"
                value={bkeven != null ? `${bkeven.toFixed(0)} bps` : '—'}
                colorClass={bkeven != null && bkeven >= 20 ? 'text-q-green' : 'text-q-amber'}
              />
              <StatRow
                label="Median Sharpe"
                value={fmt.decimal(s.median_sharpe)}
                colorClass="text-q-muted"
              />
              <StatRow
                label="Sharpe IQR"
                value={
                  s.sharpe_p25 != null && s.sharpe_p75 != null
                    ? `[${fmt.decimal(s.sharpe_p25)}, ${fmt.decimal(s.sharpe_p75)}]`
                    : '—'
                }
                colorClass="text-q-muted"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
