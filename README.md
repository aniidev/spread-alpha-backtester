# spread-alpha-backtester

Production-style **statistical arbitrage research platform** for discovering, validating, and stress-testing mean-reversion trading opportunities. Combines a full pairs-trading backtesting engine, Monte Carlo robustness analysis suite, an automated alpha discovery pipeline, and an ML signal-research layer inside an interactive quantitative dashboard.

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

### **ML Signals Tab**
- sklearn classifiers (Logistic Regression, Gradient Boosting, Random Forest) trained on engineered spread features
- Leak-audited train/test pipeline with strict no-lookahead guards
- Test-set classification metrics (accuracy, precision, recall, F1, AUC-ROC), feature importances, and ROC curve
- Probability calibration panel (predicted-probability histogram + reliability curve) to verify honest, calibrated probabilities
- Naive causal baseline comparison: model AUC vs a zero-parameter `-|z[t]|` score, with the **information-beyond-z-score** delta surfaced as the headline metric
- Side-by-side ML vs z-score baseline backtest across all 12 KPIs
- Probability-threshold sweep showing Sharpe vs long threshold against the baseline reference line

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
│   └── main.py                        # FastAPI backend - backtest, robustness, screener, ML endpoints
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
│   │       ├── PairDiscovery.jsx
│   │       ├── MLSignals.jsx
│   │       ├── FeatureImportanceChart.jsx
│   │       └── ROCCurveChart.jsx
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
    ├── ml/
    │   ├── signal_model.py            # feature engineering, leak-audited training, calibration
    │   └── ml_backtest.py             # ML-vs-baseline backtest, threshold sweep
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

## ML Signal Layer

The ML Signals module trains sklearn classifiers to predict spread mean-reversion and benchmarks them honestly against the rule-based z-score strategy. It is built as a research instrument, not a profit claim: the goal is to measure whether a model adds information beyond the z-score, with the data leakage and transaction-cost traps that sink most ML-in-finance projects explicitly controlled for.

### Features

All computed using only bars up to `t` (no lookahead):
- z-score, z-score lag-1, z-score lag-5
- spread momentum (5-bar, 10-bar)
- rolling volatility ratio
- spread RSI(14)
- expanding-window half-life estimate (past bars only)

### No-Lookahead Guards

- Every feature at bar `t` uses only data `<= t`
- Target uses only forward bars `t+1 … t+N`, with no overlap into the feature window
- Time-ordered train/test split (no shuffle); scaler fit on train only, then applied to test
- Half-life is an expanding estimate, never fit on the full series

### Calibration

A predicted-probability histogram and reliability curve verify the model is honest: a leaking model piles probability mass at 0 and 1 and its reliability dots leave the diagonal, while a calibrated model spreads its mass and tracks the identity line (predicted probability ≈ actual reversion rate).

### Naive Baseline Comparison

Every run reports the AUC of a zero-parameter causal score, `-|z[t]|`, alongside the model AUC. The headline metric is `model_AUC − baseline_AUC`: positive means the model adds information beyond the z-score; near zero or negative means it does not.

### Threshold Sweep

Sweeps the long/short probability thresholds and runs the cost-aware backtester at each, plotting ML Sharpe against the baseline reference line to test whether any operating point beats the rule-based strategy net of transaction costs.

### Key Finding

On MA/V, the classifier reaches a respectable **0.84 test AUC**, but a parameter-free `-|z[t]|` baseline scores **0.92** — higher than the model. The z-score is highly persistent (lag-1 autocorrelation ≈ 0.94), so "will the spread revert within N bars" is mechanically forecastable from today's `|z|`. The model is largely relearning the baseline's own logic while overtrading (≈140 trades vs the baseline's ≈20), and transaction costs drag its Sharpe negative. **High classification accuracy does not translate to PnL.** The genuinely hard problem is predicting the *residual* reversion beyond what `|z|` already implies, which is a target-design problem rather than a modeling one.

---

## Performance Metrics

Total return · annualized return · annualized volatility · Sharpe ratio · max drawdown · Calmar ratio · exposure fraction · win rate · profit factor · trade count · transaction costs · cointegration p-value · half-life · stability score · classification AUC-ROC · model-minus-baseline AUC delta.

---

## Sample Research Findings

| Pair    | Cointegrated | Return | Sharpe | Robustness |
|---------|-------------|--------|--------|------------|
| GLD/SLV | No          | -15%   | -0.35  | 27/100 |
| XOM/CVX | No          | +14%   | 0.35   | 41/100 |
| MA/V    | Yes         | +1.5%  | 0.08   | 58/100 |
| Top screened candidates | Mixed | Ranked automatically | Ranked automatically | Ranked automatically |

### ML vs Baseline (MA/V, Gradient Boosting)

| Strategy | Test AUC | Sharpe | Return | Trades | Costs |
|----------|----------|--------|--------|--------|-------|
| z-score baseline | — | 0.23 | +8.5% | 21 | $9.5k |
| ML signals | 0.84 | -0.63 | -21.2% | 139 | $57.2k |
| `-|z[t]|` naive baseline | 0.92 | — | — | — | — |

The naive baseline out-AUCs the model and the ML strategy loses net of costs — the documented takeaway is that predictive accuracy and execution-aware profitability are different problems.

---

## Realism Notes

- Auto-adjusted split/dividend prices via `yfinance(auto_adjust=True)`
- Date inner-join alignment on both legs
- All signals computed at bar `t`, executed at `t+1`
- Rolling β warm-up protection
- Costs charged on every notional turnover
- Open positions force-closed at sample end
- ML pipeline: train-only scaler fit, forward-only targets, expanding-window half-life

---

## Tech Stack

| Layer | Technology |
|---|---|
| Quant Engine | Python, pandas, NumPy, statsmodels, yfinance |
| ML | scikit-learn |
| API Server | FastAPI, uvicorn, pydantic |
| Frontend | React 18, Vite |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Concurrency | ThreadPoolExecutor |
