# statarb — pairs trading backtester

Production-style backtesting framework for **statistical arbitrage** (pairs trading) on equities. Computes a hedge ratio via OLS, models the spread as a mean-reverting process, and simulates a dollar-neutral, β-hedged portfolio bar-by-bar with realistic transaction costs and no lookahead bias.

## Project layout

```
statarb/
├── main.py                       # CLI entry point
├── requirements.txt
├── README.md
└── src/
    ├── data/loader.py            # yfinance fetch, caching, alignment
    ├── strategies/pairs_trading.py  # β estimation, spread, z-score, signals
    ├── backtester/engine.py      # bar-by-bar simulator with txn costs
    ├── metrics/performance.py    # Sharpe, drawdown, win rate, profit factor, ...
    ├── utils/cointegration.py    # Engle–Granger test
    ├── utils/visualization.py    # diagnostic & equity-curve plots
    └── runner.py                 # end-to-end orchestration + grid search
```

## Quick start

```bash
pip install -r requirements.txt

# Single pair, default parameters
python main.py --pairs KO,PEP --start 2018-01-01 --end 2024-12-31

# Multiple pairs with rolling β
python main.py --pairs KO,PEP GLD,SLV XOM,CVX --rolling-beta

# Tune a single pair
python main.py --pairs KO,PEP --grid \
  --grid-lookbacks 30,60,90 --grid-entries 1.5,2.0,2.5 --grid-exits 0.0,0.5
```

Outputs land in `results/<TICKER_A>_<TICKER_B>/`:

- `portfolio.csv` — per-bar cash, share positions, equity, costs, returns
- `trades.csv` — round-trip trade log with entry/exit prices and PnL
- `summary.csv` — headline performance metrics
- `diagnostics.png` — prices, spread, z-score with entry/exit bands
- `equity.png` — equity curve and rolling drawdown

A combined `results/summary.csv` aggregates all pairs.

## Strategy

For two cointegrated assets A and B:

1. **Hedge ratio.** Static OLS β over the first `--train-fraction` of the sample, *or* rolling OLS over `--beta-lookback` bars (`--rolling-beta`).
2. **Spread.** `S_t = P^A_t − β · P^B_t`.
3. **Z-score.** `(S_t − μ_t) / σ_t` over a trailing `--zscore-lookback`.
4. **Signal state machine.**
   - Flat → **long spread** when `z < −entry_z`
   - Flat → **short spread** when `z > +entry_z`
   - Open → **flat** when `|z| ≤ exit_z`
5. **Sizing.** Long leg sized to `--exposure` dollars; short leg is β-neutral.
6. **Execution.** Signals are shifted by one bar before entering the simulator (no lookahead). Transaction costs are charged on the absolute notional traded per leg.

## Performance metrics

Total return · annualized return · annualized vol · annualized Sharpe · max drawdown · Calmar ratio · exposure · # trades · win rate · avg trade return · avg winner / loser · profit factor · total transaction costs.

## Cointegration filter

Each pair is run through an **Engle–Granger** test (`statsmodels.tsa.stattools.coint`) before backtesting, with the t-statistic, p-value, and pass/fail at `--cointegration-alpha` printed alongside the performance summary. Disable with `--no-cointegration`.

## Notes on realism

- Prices are auto-adjusted (splits + dividends) via `yfinance(auto_adjust=True)`.
- Inner-joined on dates so both legs always trade on the same bars.
- All signals are computed at bar `t` and acted on at `t+1`'s close (one-bar shift).
- Rolling-β bars before the warm-up window do not trade.
- Transaction costs apply on every share that changes hands, both legs.
- Open positions are marked-to-market and force-closed at the end of the sample.
