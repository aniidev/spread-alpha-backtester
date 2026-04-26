import { FlaskConical, CheckCircle, AlertTriangle, XCircle, TrendingUp } from 'lucide-react'

function splitSentences(text) {
  if (!text) return []
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
}

function SentenceIcon({ text }) {
  const t = text.toLowerCase()
  if (t.includes('stable') || t.includes('robust') || t.includes('confirms') || t.includes('genuine') || t.includes('survives') || t.includes('resilience'))
    return <CheckCircle size={14} className="text-q-green flex-none mt-0.5" />
  if (t.includes('fragile') || t.includes('overfitting') || t.includes('only') || t.includes('breaks even') || t.includes('highly sensitive') || t.includes('concerns'))
    return <XCircle size={14} className="text-q-red flex-none mt-0.5" />
  if (t.includes('moderate') || t.includes('marginal') || t.includes('partially') || t.includes('approaching') || t.includes('tail risk'))
    return <AlertTriangle size={14} className="text-q-amber flex-none mt-0.5" />
  return <TrendingUp size={14} className="text-q-accent flex-none mt-0.5" />
}

export default function RobustnessInsightPanel({ insight, score }) {
  const sentences = splitSentences(insight)

  return (
    <div className="rounded-xl border border-q-border bg-q-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical size={14} className="text-q-violet" />
        <p className="text-xs font-semibold tracking-widest uppercase text-q-faint">
          Robustness Analysis
        </p>
        {score != null && (
          <span
            className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded border ${
              score >= 70
                ? 'text-q-green border-q-green/30 bg-q-green/10'
                : score >= 40
                ? 'text-q-amber border-q-amber/30 bg-q-amber/10'
                : 'text-q-red border-q-red/30 bg-q-red/10'
            }`}
          >
            Score: {score?.toFixed(0)} / 100
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
