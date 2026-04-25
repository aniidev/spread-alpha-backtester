import { Activity } from 'lucide-react'

export default function LoadingOverlay() {
  return (
    <div className="fixed inset-0 z-50 bg-q-bg/80 backdrop-blur-sm flex items-center justify-center">
      <div className="flex flex-col items-center gap-5 p-8 rounded-2xl border border-q-border bg-q-surface shadow-2xl">
        {/* Animated ring */}
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-q-border" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-q-accent animate-spin" />
          <div className="absolute inset-2 rounded-full border border-transparent border-t-q-violet animate-spin-slow" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Activity size={18} className="text-q-accent animate-pulse" />
          </div>
        </div>

        <div className="text-center">
          <p className="text-q-text font-semibold text-sm mb-1">Running Backtest</p>
          <p className="text-q-muted text-xs leading-relaxed max-w-[200px]">
            Fetching prices, computing signals, and simulating the strategy…
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-q-accent/60 animate-bounce"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
