export const fmt = {
  currency: (v, decimals = 0) => {
    if (v == null) return '—'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(v)
  },

  pct: (v, decimals = 2) => {
    if (v == null) return '—'
    return `${(v * 100).toFixed(decimals)}%`
  },

  decimal: (v, decimals = 2) => {
    if (v == null) return '—'
    return Number(v).toFixed(decimals)
  },

  int: (v) => {
    if (v == null) return '—'
    return Math.round(v).toLocaleString('en-US')
  },

  date: (ts) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  },

  dateShort: (ts) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  },
}

/** Format a date string for chart tick labels: "Jan '22" */
export const chartTick = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const month = d.toLocaleString('en-US', { month: 'short' })
  const year = String(d.getFullYear()).slice(2)
  return `${month} '${year}`
}

/** Format a date string for tooltips: "Jan 5, 2022" */
export const tooltipDate = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

/** Pick only every Nth tick from an array of dates to avoid crowding */
export const thinTicks = (dates, targetCount = 8) => {
  if (!dates || dates.length === 0) return []
  const step = Math.max(1, Math.floor(dates.length / targetCount))
  return dates.filter((_, i) => i % step === 0)
}

/** Return Tailwind colour class for a signed numeric value. */
export const signColour = (v, posIsGood = true) => {
  if (v == null) return 'text-q-muted'
  if (v > 0) return posIsGood ? 'text-q-green' : 'text-q-red'
  if (v < 0) return posIsGood ? 'text-q-red'   : 'text-q-green'
  return 'text-q-muted'
}
