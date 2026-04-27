import { fmt } from '../utils/format.js'

function ScoreBadge({ score }) {
  if (score == null) return <span className="text-q-faint">—</span>
  const color =
    score >= 70 ? 'text-q-green bg-q-green/10 border-q-green/25' :
    score >= 45 ? 'text-q-amber bg-q-amber/10 border-q-amber/25' :
                  'text-q-red   bg-q-red/10   border-q-red/25'
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-bold font-mono ${color}`}>
      {score.toFixed(1)}
    </span>
  )
}

function PValue({ v }) {
  if (v == null) return <span className="text-q-faint">—</span>
  const color = v < 0.01 ? 'text-q-green' : v < 0.05 ? 'text-q-amber' : 'text-q-red'
  return <span className={`font-mono text-xs ${color}`}>{v.toFixed(4)}</span>
}

function Num({ v, pct = false, decimals = 2 }) {
  if (v == null) return <span className="text-q-faint font-mono text-xs">—</span>
  const val = pct ? fmt.pct(v, decimals) : fmt.decimal(v, decimals)
  const color = v >= 0 ? 'text-q-green' : 'text-q-red'
  return <span className={`font-mono text-xs ${color}`}>{val}</span>
}

function CointBadge({ yes }) {
  if (yes == null) return <span className="text-q-faint text-xs">—</span>
  return yes
    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-q-green/10 text-q-green border border-q-green/20">YES</span>
    : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-q-red/10   text-q-red   border border-q-red/20">NO</span>
}

const TH = ({ children, className = '' }) => (
  <th className={`px-3 py-2 text-left text-[10px] font-semibold tracking-widest uppercase text-q-faint whitespace-nowrap ${className}`}>
    {children}
  </th>
)

const TD = ({ children, className = '' }) => (
  <td className={`px-3 py-2 whitespace-nowrap ${className}`}>
    {children}
  </td>
)

export default function ScreenerTable({ results, onRunBacktest }) {
  if (!results?.length) return null

  return (
    <div className="overflow-x-auto rounded-xl border border-q-border">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-q-elevated border-b border-q-border">
          <tr>
            <TH>#</TH>
            <TH>Pair</TH>
            <TH>Score</TH>
            <TH>p-value</TH>
            <TH>Coint.</TH>
            <TH>Sharpe</TH>
            <TH>Return</TH>
            <TH>Max DD</TH>
            <TH>Half-life</TH>
            <TH>Stability</TH>
            <TH>Trades</TH>
            <TH></TH>
          </tr>
        </thead>
        <tbody>
          {results.map((row, i) => (
            <tr
              key={`${row.ticker_a}-${row.ticker_b}`}
              className="border-b border-q-border/60 hover:bg-q-elevated/60 transition-colors"
            >
              <TD>
                <span className="text-xs font-mono text-q-faint">{row.rank ?? i + 1}</span>
              </TD>
              <TD>
                <span className="font-mono font-semibold text-q-text text-sm">
                  {row.ticker_a}
                  <span className="text-q-faint mx-1">/</span>
                  {row.ticker_b}
                </span>
              </TD>
              <TD><ScoreBadge score={row.score} /></TD>
              <TD><PValue v={row.p_value} /></TD>
              <TD><CointBadge yes={row.is_cointegrated} /></TD>
              <TD><Num v={row.sharpe} /></TD>
              <TD><Num v={row.total_return} pct /></TD>
              <TD><Num v={row.max_drawdown} pct /></TD>
              <TD>
                <span className="font-mono text-xs text-q-muted">
                  {row.halflife != null ? `${row.halflife}d` : '—'}
                </span>
              </TD>
              <TD>
                <div className="flex items-center gap-1.5">
                  <div className="w-16 h-1.5 rounded-full bg-q-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-q-accent"
                      style={{ width: `${((row.stability_score ?? 0) * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-q-faint">
                    {row.stability_score != null ? row.stability_score.toFixed(2) : '—'}
                  </span>
                </div>
              </TD>
              <TD>
                <span className="font-mono text-xs text-q-muted">{row.n_trades ?? '—'}</span>
              </TD>
              <TD>
                <button
                  onClick={() => onRunBacktest(row.ticker_a, row.ticker_b)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-q-accent/10 border border-q-accent/25 text-q-accent text-[11px] font-semibold hover:bg-q-accent/20 transition-colors whitespace-nowrap"
                >
                  ▶ Backtest
                </button>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
