const BASE = '/api'

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  runBacktest: (params) => req('/backtest', { method: 'POST', body: JSON.stringify(params) }),
  getHistory:  ()       => req('/history'),
  getRun:      (id)     => req(`/runs/${id}`),
  clearHistory: ()      => req('/history', { method: 'DELETE' }),
  health:      ()       => req('/health'),
}
