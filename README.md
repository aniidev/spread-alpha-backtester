# spread-alpha-backtester

Production-style **statistical arbitrage** (pairs trading) backtesting framework with a full-stack interactive web dashboard. Computes a hedge ratio via OLS, models the spread as a mean-reverting process, and simulates a dollar-neutral β-hedged portfolio bar-by-bar with realistic transaction costs and no lookahead bias.

---

## Dashboard

An interactive quantitative research dashboard built on top of the backtesting engine.

![Dashboard preview — dark quant terminal UI with KPI cards and interactive charts]

**Features:**
- Pair selection with preset pairs (MA/V, XOM/CVX, GLD/SLV, EWA/EWC, KO/PEP, HD/LOW) or custom tickers
- Configurable strategy parameters (z-score lookback, entry/exit thresholds, capital, transaction costs)
- 12 KPI performance cards with colour-coded thresholds
- Interactive equity curve, z-score with position shading, drawdown, and trade return histogram
- Auto-generated quantitative insight paragraph
- Run history sidebar with one-click reload
- CSV export for trade logs

### Running the dashboard

**Prerequisites**

```bash
pip install -r requirements.txt   # Python backend
cd frontend && npm install        # Node frontend
```

**Start both servers (Windows)**

```bat
start_dashboard.bat
```

**Start both servers (Mac / Linux)**

```bash
bash start_dashboard.sh
```

**Or manually in two terminals:**

```bash
# Terminal 1 — API (project root)
uvicorn api.main:app --reload --port 8000

# Terminal 2 — UI
cd frontend && npm run dev
```

Open **http://localhost:5173** in your browser. The backend API is at **http://localhost:8000**.

> **First run** downloads price data from Yahoo Finance (~10–20 s). Subsequent runs for the same pair and date range are fast because prices are cached under `results/cache/`.

---

## Project layout

```
statarb/
├── api/
│   └── main.py                   # FastAPI backend — wraps the backtesting engine
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Root layout + state management
│   │   ├── api/client.js         # Fetch wrapper for the backend
│   │   ├── utils/format.js       # Number / date formatting utilities
│   │   └── components/
│   │       ├── PairSelector.jsx  # Strategy config form
│   │       ├── KPICards.jsx      # Performance metric cards
│   │       ├── InsightPanel.jsx  # Auto-generated quant analysis
│   │       ├── EquityCurveChart.jsx
│   │       ├── ZScoreChart.jsx   # Z-score with position shading
│   │       ├── DrawdownChart.jsx
│   │       ├── TradeHistogramChart.jsx
│   │       ├── RunHistory.jsx    # Sidebar of past runs
│   │       └── LoadingOverlay.jsx
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.js            # Dev proxy → localhost:8000
├── main.py                       # CLI entry point (standalone, no server needed)
├── requirements.txt
├── start_dashboard.bat           # Windows one-click launcher
├── start_dashboard.sh            # Mac/Linux one-click launcher
└── src/
    ├── data/loader.py            # yfinance fetch, caching, alignment
    ├── strategies/pairs_trading.py  # β estimation, spread, z-score, signals
    ├── backtester/engine.py      # bar-by-bar simulator with txn costs
    ├── metrics/performance.py    # Sharpe, drawdown, win rate, profit factor, ...
    ├── utils/cointegration.py    # Engle–Granger test
    ├── utils/visualization.py    # diagnostic & equity-curve plots (CLI only)
    └── runner.py                 # end-to-end orchestration + grid search
```

---

## CLI (no server required)

The original command-line interface still works independently.

```bash
pip install -r requirements.txt

# Single pair, default parameters
python main.py --pairs KO,PEP --start 2018-01-01 --end 2024-12-31

# Multiple pairs with rolling β
python main.py --pairs KO,PEP GLD,SLV XOM,CVX --rolling-beta

# Grid search — sweep z-score lookback × entry threshold
python main.py --pairs KO,PEP --grid \
  --grid-lookbacks 30,60,90 --grid-entries 1.5,2.0,2.5 --grid-exits 0.0,0.5
```

CLI outputs land in `results/<TICKER_A>_<TICKER_B>/`:

| File | Contents |
|---|---|
| `portfolio.csv` | Per-bar cash, positions, equity, costs, returns |
| `trades.csv` | Round-trip trade log with entry/exit prices and PnL |
| `summary.csv` | Headline performance metrics |
| `diagnostics.png` | Prices, spread, z-score with entry/exit bands |
| `equity.png` | Equity curve and rolling drawdown |

A combined `results/summary.csv` aggregates all pairs.

---

## Strategy

For two cointegrated assets A and B:

1. **Hedge ratio.** Static OLS β over the first `--train-fraction` of the sample, *or* rolling OLS over `--beta-lookback` bars (`--rolling-beta`).
2. **Spread.** `S_t = P^A_t − β · P^B_t`
3. **Z-score.** `(S_t − μ_t) / σ_t` over a trailing `--zscore-lookback` window.
4. **Signal state machine.**
   - Flat → **long spread** when `z < −entry_z`
   - Flat → **short spread** when `z > +entry_z`
   - Open → **flat** when `|z| ≤ exit_z`
5. **Sizing.** Long leg sized to `--exposure` dollars; short leg is β-neutral.
6. **Execution.** Signals are shifted one bar before entering the simulator (no lookahead). Transaction costs are charged on the absolute notional traded per leg.

---

## Performance metrics

Total return · annualized return · annualized vol · annualized Sharpe · max drawdown · Calmar ratio · exposure fraction · trade count · win rate · avg trade return · avg winner/loser · profit factor · total transaction costs · cointegration p-value.

---

## Cointegration filter

Each pair is tested with **Engle–Granger** (`statsmodels.tsa.stattools.coint`). The t-statistic, p-value, and pass/fail at `--cointegration-alpha` are displayed in the dashboard insight panel and CLI summary. Disable in the CLI with `--no-cointegration`.

---

## Sample results

| Pair    | Cointegrated | Return | Sharpe |
|---------|-------------|--------|--------|
| GLD/SLV | No          | −20%   | −0.22  |
| XOM/CVX | No          | +67%   | 0.52   |
| MA/V    | Yes         | +22%   | 0.37   |
| EWA/EWC | Yes         | +5%    | 0.12   |

---

## Insights

- Cointegration is a strong but not sufficient condition for profitability. MA/V showed stable performance under cointegration; EWA/EWC confirmed that statistical linkage alone does not guarantee strong returns.
- Non-cointegrated pairs (GLD/SLV) consistently underperformed, validating the importance of testing mean-reversion assumptions before trading.
- Some non-cointegrated pairs (XOM/CVX) still generated positive returns, suggesting short-term correlation and sector dynamics can temporarily support mean reversion.
- Transaction costs had a material impact across all pairs — realistic execution modeling is essential.
- Strategy performance is highly sensitive to pair selection; asset selection is as important as signal design.

---

## Realism notes

- Prices are auto-adjusted (splits + dividends) via `yfinance(auto_adjust=True)`.
- Inner-joined on dates so both legs always trade on the same bars.
- All signals are computed at bar `t` and acted on at `t+1`'s close (one-bar shift).
- Rolling-β bars before the warm-up window do not trade.
- Transaction costs apply on every share that changes hands, both legs.
- Open positions are marked-to-market and force-closed at the end of the sample.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backtesting engine | Python · pandas · NumPy · statsmodels · yfinance |
| API server | FastAPI · uvicorn · pydantic |
| UI framework | React 18 · Vite |
| Styling | Tailwind CSS 3 |
| Charts | Recharts |
| Icons | Lucide React |
