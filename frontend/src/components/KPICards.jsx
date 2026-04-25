import { fmt } from '../utils/format.js'

const CARD_CONFIG = [
  {
    key: 'final_equity',
    label: 'Final Equity',
    format: (v) => fmt.currency(v),
    desc: 'Portfolio value at period end',
    colorFn: () => 'text-q-accent',
  },
  {
    key: 'total_return',
    label: 'Total Return',
    format: (v) => fmt.pct(v),
    desc: '(End − Start) / Start',
    colorFn: (v) => v >= 0 ? 'text-q-green' : 'text-q-red',
  },
  {
    key: 'annualized_return',
    label: 'Ann. Return',
    format: (v) => fmt.pct(v),
    desc: 'CAGR over the backtest period',
    colorFn: (v) => v >= 0 ? 'text-q-green' : 'text-q-red',
  },
  {
    key: 'sharpe_ratio',
    label: 'Sharpe Ratio',
    format: (v) => fmt.decimal(v),
    desc: 'Ann. excess return / ann. vol',
    colorFn: (v) => v >= 1.5 ? 'text-q-green' : v >= 0.5 ? 'text-q-amber' : 'text-q-red',
  },
  {
    key: 'max_drawdown',
    label: 'Max Drawdown',
    format: (v) => fmt.pct(v),
    desc: 'Largest peak-to-trough decline',
    colorFn: (v) => v > -0.1 ? 'text-q-amber' : 'text-q-red',
  },
  {
    key: 'win_rate',
    label: 'Win Rate',
    format: (v) => fmt.pct(v),
    desc: 'Fraction of profitable trades',
    colorFn: (v) => v >= 0.55 ? 'text-q-green' : v >= 0.45 ? 'text-q-amber' : 'text-q-red',
  },
  {
    key: 'profit_factor',
    label: 'Profit Factor',
    format: (v) => fmt.decimal(v),
    desc: 'Gross profits ÷ gross losses',
    colorFn: (v) => v >= 1.5 ? 'text-q-green' : v >= 1.0 ? 'text-q-amber' : 'text-q-red',
  },
  {
    key: 'n_trades',
    label: 'Total Trades',
    format: (v) => fmt.int(v),
    desc: 'Round-trip trade count',
    colorFn: () => 'text-q-text',
  },
]

const EXTRA_CARDS = [
  {
    key: 'calmar_ratio',
    label: 'Calmar Ratio',
    format: (v) => fmt.decimal(v),
    desc: 'Ann. return / |max drawdown|',
    colorFn: (v) => v >= 0.5 ? 'text-q-green' : v >= 0.2 ? 'text-q-amber' : 'text-q-red',
  },
  {
    key: 'annualized_volatility',
    label: 'Ann. Volatility',
    format: (v) => fmt.pct(v),
    desc: 'Annualised daily return std dev',
    colorFn: () => 'text-q-muted',
  },
  {
    key: 'exposure_fraction',
    label: 'Exposure',
    format: (v) => fmt.pct(v),
    desc: 'Fraction of bars in-position',
    colorFn: () => 'text-q-muted',
  },
  {
    key: 'total_costs',
    label: 'Total Costs',
    format: (v) => fmt.currency(v),
    desc: 'Cumulative transaction costs',
    colorFn: () => 'text-q-red',
  },
]

function KPICard({ label, value, desc, colorClass, badge }) {
  return (
    <div className="rounded-xl border border-q-border bg-q-surface hover:border-q-border-bright transition-colors p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">{label}</p>
        {badge}
      </div>
      <p className={`text-2xl font-bold font-mono tracking-tight ${colorClass}`}>
        {value}
      </p>
      <p className="text-xs text-q-faint leading-snug">{desc}</p>
    </div>
  )
}

function CointegrationCard({ cointegration }) {
  if (!cointegration) return null
  const { is_cointegrated, p_value, t_statistic, critical_values } = cointegration
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 col-span-1 ${
      is_cointegrated
        ? 'border-q-green/30 bg-q-green/5'
        : 'border-q-red/30 bg-q-red/5'
    }`}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">
          Coint. p-value
        </p>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
          is_cointegrated ? 'bg-q-green/20 text-q-green' : 'bg-q-red/20 text-q-red'
        }`}>
          {is_cointegrated ? '✓ PASS' : '✗ FAIL'}
        </span>
      </div>
      <p className={`text-2xl font-bold font-mono tracking-tight ${
        is_cointegrated ? 'text-q-green' : 'text-q-red'
      }`}>
        {p_value != null ? p_value.toFixed(4) : '—'}
      </p>
      <p className="text-xs text-q-faint">
        EG t-stat: {t_statistic != null ? t_statistic.toFixed(3) : '—'}
        {critical_values && (
          <span className="ml-2">· 5% crit: {critical_values['5%']?.toFixed(2)}</span>
        )}
      </p>
    </div>
  )
}

export default function KPICards({ metrics, cointegration }) {
  if (!metrics) return null

  return (
    <div className="space-y-3">
      {/* Primary 8 + cointegration card */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {CARD_CONFIG.map(({ key, label, format, desc, colorFn }) => {
          const v = metrics[key]
          return (
            <KPICard
              key={key}
              label={label}
              value={v != null ? format(v) : '—'}
              desc={desc}
              colorClass={v != null ? colorFn(v) : 'text-q-muted'}
            />
          )
        })}
        <CointegrationCard cointegration={cointegration} />
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {EXTRA_CARDS.map(({ key, label, format, desc, colorFn }) => {
          const v = metrics[key]
          return (
            <KPICard
              key={key}
              label={label}
              value={v != null ? format(v) : '—'}
              desc={desc}
              colorClass={v != null ? colorFn(v) : 'text-q-muted'}
            />
          )
        })}
      </div>
    </div>
  )
}
