import { Lightbulb, TrendingUp, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'

function splitSentences(text) {
  if (!text) return []
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function SentenceIcon({ text }) {
  const lower = text.toLowerCase()
  if (lower.includes('pass') || lower.includes('cointegrat') || lower.includes('strong') || lower.includes('reliable'))
    return <CheckCircle size={14} className="text-q-green flex-none mt-0.5" />
  if (lower.includes('fail') || lower.includes('not cointegrat') || lower.includes('below') || lower.includes('weak') || lower.includes('below 50') || lower.includes('below 1.0'))
    return <XCircle size={14} className="text-q-red flex-none mt-0.5" />
  if (lower.includes('drawdown') || lower.includes('caution') || lower.includes('drag') || lower.includes('warrant'))
    return <AlertTriangle size={14} className="text-q-amber flex-none mt-0.5" />
  return <TrendingUp size={14} className="text-q-accent flex-none mt-0.5" />
}

export default function InsightPanel({ insight, cointegration }) {
  const sentences = splitSentences(insight)

  return (
    <div className="rounded-xl border border-q-border bg-q-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb size={14} className="text-q-amber" />
        <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">
          Quantitative Insight
        </p>
        {cointegration && (
          <span
            className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded border ${
              cointegration.is_cointegrated
                ? 'text-q-green border-q-green/30 bg-q-green/10'
                : 'text-q-red border-q-red/30 bg-q-red/10'
            }`}
          >
            Engle–Granger p = {cointegration.p_value?.toFixed(4) ?? '—'}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {sentences.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <SentenceIcon text={s} />
            <p className="text-sm text-q-muted leading-relaxed">{s}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
