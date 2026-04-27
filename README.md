# spread-alpha-backtester

Production-style **statistical arbitrage research platform** for discovering, validating, and stress-testing mean-reversion trading opportunities. Combines a full pairs-trading backtesting engine, Monte Carlo robustness analysis suite, and an automated alpha discovery pipeline inside an interactive quantitative dashboard.

---

## Dashboard

A full-stack interactive quantitative research dashboard built on top of the backtesting engine.

### **Backtest Tab**
- Manual pair selection with preset pairs or custom tickers
- Configurable strategy parameters (z-score lookback, entry/exit thresholds, capital, transaction costs)
- 12 KPI performance cards with color-coded thresholds
- Interactive equity curve, z-score with position shading, drawdown, and trade-return histogram
- Auto-generated quantitative insight paragraph
- Run history sidebar with one-click reload
- CSV export for trade logs

### **Robustness Lab Tab**
- Monte Carlo stress-testing across 3 orthogonal dimensions
- Normalized 0–100 robustness score with semicircular SVG gauge
- Sharpe distribution histogram, bootstrap return distribution, cost sensitivity dual-axis chart
- Auto-generated robustness analysis paragraph with pass/fail indicators

### **Pair Discovery Tab**
- Automated scanning across preset universes or custom ticker lists
- Correlation prefilter + parallel pairwise statistical evaluation
- Cointegration, half-life, hedge-ratio stability, Sharpe, drawdown, and composite alpha score
- Ranked candidate table with one-click transition into full backtest
- CSV export of discovered pair opportunities

---

## Running the Dashboard

### Prerequisites

```bash
pip install -r requirements.txt
cd frontend && npm install
```

### Start both servers (Windows)

```bat
start_dashboard.bat
```

### Start both servers (Mac / Linux)

```bash
bash start_dashboard.sh
```

### Or manually in two terminals

```bash
# Terminal 1 - API
uvicorn api.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev
```

Open **http://localhost:5173** in your browser.

> First run downloads Yahoo Finance data and caches it under `results/cache/`.

---

## Project Layout

```bash
statarb/
├── api/
│   └── main.py                        # FastAPI backend - backtest, robustness, screener endpoints
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api/client.js
│   │   ├── utils/format.js
│   │   └── components/
│   │       ├── PairSelector.jsx
│   │       ├── KPICards.jsx
│   │       ├── InsightPanel.jsx
│   │       ├── EquityCurveChart.jsx
│   │       ├── ZScoreChart.jsx
│   │       ├── DrawdownChart.jsx
│   │       ├── TradeHistogramChart.jsx
│   │       ├── RunHistory.jsx
│   │       ├── RobustnessLab.jsx
│   │       ├── RobustnessScoreGauge.jsx
│   │       ├── RobustnessSummaryCards.jsx
│   │       ├── RobustnessInsightPanel.jsx
│   │       ├── SharpeHistChart.jsx
│   │       ├── BootstrapReturnChart.jsx
│   │       ├── CostSensitivityChart.jsx
│   │       └── PairDiscovery.jsx
├── main.py
├── requirements.txt
├── start_dashboard.bat
├── start_dashboard.sh
└── src/
    ├── data/loader.py
    ├── strategies/pairs_trading.py
    ├── backtester/engine.py
    ├── metrics/performance.py
    ├── robustness.py
    ├── universes.py
    ├── pair_screener.py
    ├── utils/cointegration.py
    ├── utils/visualization.py
    └── runner.py
```

---

## CLI Modes

### Standard Backtest

```bash
python main.py --pairs MA,V --start 2020-01-01 --end 2024-12-31
```

### Rolling Beta Backtest

```bash
python main.py --pairs MA,V --rolling-beta --beta-lookback 60
```

### Parameter Grid Search

```bash
python main.py --pairs MA,V --grid \
  --grid-lookbacks 30,60,90 --grid-entries 1.5,2.0,2.5 --grid-exits 0.0,0.5
```

### Automated Pair Discovery

```bash
python main.py --pair-screener --screen-universe SP500 --top-k 10
python main.py --pair-screener --screen-universe ENERGY --top-k 10 --run-top 3
python main.py --pair-screener --tickers AAPL,MSFT,GOOGL,NVDA,AMD --top-k 5
```

Results save to `results/pair_screener.csv`.

---

## Core Strategy Engine

For two assets A and B:

1. **Hedge Ratio** - static or rolling OLS β estimation
2. **Spread Construction** - `S_t = P^A_t − βP^B_t`
3. **Signal Generation** - rolling z-score mean-reversion thresholds
4. **State Machine Execution**
   - long spread when `z < -entry_z`
   - short spread when `z > entry_z`
   - flatten when `|z| ≤ exit_z`
5. **Dollar-Neutral Sizing** with β-adjusted hedge leg
6. **One-Bar Shifted Execution** to remove lookahead bias
7. **Realistic Transaction Costs** charged on both legs

---

## Robustness Lab

The robustness engine stress-tests every strategy run across three dimensions:

### 1. Random Historical Window Sampling
Runs hundreds of full backtests across random contiguous subperiods to test sample dependence.

### 2. Bootstrap Trade-Return Resampling
Resamples realized trade outcomes with replacement to estimate confidence intervals on cumulative PnL.

### 3. Transaction Cost Sensitivity
Sweeps execution cost from 0 to 100 bps and measures Sharpe/return degradation.

### Robustness Score
Composite 0–100 score based on:
- window positivity
- Sharpe stability
- bootstrap profitability
- cost resilience

---

## Pair Discovery Engine

The Pair Discovery module transforms the platform from a manual tester into an automated alpha search system.

### Pipeline

1. Load and cache historical prices for all tickers in a universe
2. Compute pairwise return correlations
3. Keep only highly correlated candidates above a minimum threshold
4. Evaluate surviving pairs in parallel:
   - Engle–Granger cointegration test
   - Static OLS hedge ratio
   - Ornstein-Uhlenbeck half-life approximation
   - Rolling hedge-ratio stability
   - Optional mini-backtest (Sharpe, return, drawdown)
5. Compute a composite alpha score
6. Rank and export the strongest opportunities

### Composite Alpha Score

The screener ranks pairs by:

- cointegration significance
- backtest Sharpe ratio
- drawdown penalty
- hedge-ratio stability

to prioritize statistically attractive and structurally stable mean-reversion candidates.

---

## Performance Metrics

Total return · annualized return · annualized volatility · Sharpe ratio · max drawdown · Calmar ratio · exposure fraction · win rate · profit factor · trade count · transaction costs · cointegration p-value · half-life · stability score.

---

## Sample Research Findings

| Pair    | Cointegrated | Return | Sharpe | Robustness |
|---------|-------------|--------|--------|------------|
| GLD/SLV | No          | -15%   | -0.35  | 27/100 |
| XOM/CVX | No          | +14%   | 0.35   | 41/100 |
| MA/V    | Yes         | +1.5%  | 0.08   | 58/100 |
| Top screened candidates | Mixed | Ranked automatically | Ranked automatically | Ranked automatically |

---

## Realism Notes

- Auto-adjusted split/dividend prices via `yfinance(auto_adjust=True)`
- Date inner-join alignment on both legs
- All signals computed at bar `t`, executed at `t+1`
- Rolling β warm-up protection
- Costs charged on every notional turnover
- Open positions force-closed at sample end

---

## Tech Stack

| Layer | Technology |
|---|---|
| Quant Engine | Python, pandas, NumPy, statsmodels, yfinance |
| API Server | FastAPI, uvicorn, pydantic |
| Frontend | React 18, Vite |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Concurrency | ThreadPoolExecutor |
