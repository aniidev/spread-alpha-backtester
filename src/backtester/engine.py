"""Pairs-trading backtest engine.

Simulates a dollar-neutral pairs portfolio bar by bar:

    long  spread  →  long $X of A,  short β · $X · (P_A / P_B) of B
    short spread  →  short $X of A, long  β · $X · (P_A / P_B) of B

For each bar we mark to market on close and apply transaction costs whenever
the position changes. Signals from the strategy are shifted by one bar so that
the position established on day t can only be entered using day-(t+1) prices,
which is the standard guard against lookahead bias when using close-to-close
data.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..strategies import PairsSignals

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BacktestConfig:
    """Backtest configuration.

    Attributes:
        initial_capital: Starting cash, in dollars.
        transaction_cost: Proportional cost per dollar traded *per leg*
            (e.g. 0.001 = 10 bps). Charged on the notional value of every
            share that changes hands.
        target_dollar_exposure: Gross dollar exposure on the long leg when
            a position is open. Defaults to `initial_capital`. The short leg
            is sized to be β-neutral.
        annualization_factor: Trading periods per year, used by metrics.
    """

    initial_capital: float = 100_000.0
    transaction_cost: float = 0.001
    target_dollar_exposure: float | None = None
    annualization_factor: int = 252

    def exposure(self) -> float:
        return float(self.target_dollar_exposure or self.initial_capital)


@dataclass
class BacktestResult:
    """Outputs of a single backtest run.

    Attributes:
        portfolio: Per-bar DataFrame with columns:
            cash, shares_a, shares_b, position, equity, returns, costs.
        trades: One row per round-trip trade with entry/exit info & PnL.
        config: BacktestConfig used.
        signals: PairsSignals used.
    """

    portfolio: pd.DataFrame
    trades: pd.DataFrame
    config: BacktestConfig
    signals: PairsSignals = field(repr=False)


class Backtester:
    """Bar-by-bar simulator for a single pair.

    The simulator keeps explicit cash, share-A, and share-B state and
    re-prices the portfolio at every bar using close prices. Trading happens
    at the same close prices the signal observed (with a one-bar shift),
    which is a slightly conservative approximation of next-open execution.
    """

    def __init__(self, config: BacktestConfig | None = None) -> None:
        self.config = config or BacktestConfig()

    def run(
        self,
        price_a: pd.Series,
        price_b: pd.Series,
        signals: PairsSignals,
    ) -> BacktestResult:
        """Run the backtest and return per-bar state plus a trade log."""
        if not price_a.index.equals(price_b.index):
            raise ValueError("price_a and price_b must share the same index")
        if not price_a.index.equals(signals.position.index):
            raise ValueError("signals must be aligned to the price index")

        cfg = self.config
        exposure = cfg.exposure()

        # Shift desired position by one bar: the state computed from z[t]
        # can only be acted on at bar t+1.
        target_position = signals.position.shift(1).fillna(0).astype(np.int8).to_numpy()
        beta = signals.beta.to_numpy(dtype=float)
        pa = price_a.to_numpy(dtype=float)
        pb = price_b.to_numpy(dtype=float)
        n = len(pa)

        cash = np.full(n, cfg.initial_capital, dtype=float)
        shares_a = np.zeros(n, dtype=float)
        shares_b = np.zeros(n, dtype=float)
        equity = np.full(n, cfg.initial_capital, dtype=float)
        costs = np.zeros(n, dtype=float)

        prev_shares_a = 0.0
        prev_shares_b = 0.0
        prev_cash = cfg.initial_capital
        prev_position = 0

        trade_log: list[dict] = []
        open_trade: dict | None = None

        for t in range(n):
            desired = int(target_position[t])
            beta_t = beta[t]
            price_a_t = pa[t]
            price_b_t = pb[t]

            # If β is undefined (rolling β still warming up), don't trade.
            if not np.isfinite(beta_t):
                desired = prev_position

            # Compute target shares for the desired position. We size the long
            # leg of A to `exposure` dollars and the B leg to be β-neutral.
            if desired == 0:
                target_shares_a = 0.0
                target_shares_b = 0.0
            else:
                if price_a_t <= 0 or price_b_t <= 0:
                    target_shares_a = 0.0
                    target_shares_b = 0.0
                else:
                    units = exposure / price_a_t  # # of A-shares per spread unit
                    target_shares_a = desired * units
                    target_shares_b = -desired * beta_t * units

            # Trade only if the share targets actually moved.
            delta_a = target_shares_a - prev_shares_a
            delta_b = target_shares_b - prev_shares_b
            traded_today = (delta_a != 0.0) or (delta_b != 0.0)

            trade_cost = 0.0
            new_cash = prev_cash
            if traded_today:
                # Cash impact of buying / selling shares.
                new_cash -= delta_a * price_a_t
                new_cash -= delta_b * price_b_t
                # Transaction costs on absolute notional traded.
                trade_cost = cfg.transaction_cost * (
                    abs(delta_a) * price_a_t + abs(delta_b) * price_b_t
                )
                new_cash -= trade_cost

            cash[t] = new_cash
            shares_a[t] = target_shares_a
            shares_b[t] = target_shares_b
            costs[t] = trade_cost
            equity[t] = new_cash + target_shares_a * price_a_t + target_shares_b * price_b_t

            # Trade log: open / close bookkeeping.
            if desired != prev_position:
                if open_trade is not None:
                    open_trade["exit_date"] = price_a.index[t]
                    open_trade["exit_price_a"] = price_a_t
                    open_trade["exit_price_b"] = price_b_t
                    open_trade["exit_equity"] = equity[t]
                    open_trade["pnl"] = equity[t] - open_trade["entry_equity"]
                    open_trade["return"] = (
                        open_trade["pnl"] / open_trade["entry_equity"]
                        if open_trade["entry_equity"] > 0
                        else np.nan
                    )
                    trade_log.append(open_trade)
                    open_trade = None

                if desired != 0:
                    open_trade = {
                        "side": "long_spread" if desired == 1 else "short_spread",
                        "entry_date": price_a.index[t],
                        "entry_price_a": price_a_t,
                        "entry_price_b": price_b_t,
                        "beta": beta_t,
                        "entry_equity": equity[t],
                    }

            prev_shares_a = target_shares_a
            prev_shares_b = target_shares_b
            prev_cash = new_cash
            prev_position = desired

        # Close any open trade at the end of the sample (mark-to-market exit).
        if open_trade is not None:
            open_trade["exit_date"] = price_a.index[-1]
            open_trade["exit_price_a"] = pa[-1]
            open_trade["exit_price_b"] = pb[-1]
            open_trade["exit_equity"] = equity[-1]
            open_trade["pnl"] = equity[-1] - open_trade["entry_equity"]
            open_trade["return"] = (
                open_trade["pnl"] / open_trade["entry_equity"]
                if open_trade["entry_equity"] > 0
                else np.nan
            )
            open_trade["forced_close"] = True
            trade_log.append(open_trade)

        portfolio = pd.DataFrame(
            {
                "cash": cash,
                "shares_a": shares_a,
                "shares_b": shares_b,
                "position": target_position,
                "equity": equity,
                "costs": costs,
                "price_a": pa,
                "price_b": pb,
            },
            index=price_a.index,
        )
        portfolio["returns"] = portfolio["equity"].pct_change().fillna(0.0)

        trades = pd.DataFrame(trade_log)
        if not trades.empty and "forced_close" not in trades.columns:
            trades["forced_close"] = False

        logger.info(
            "Backtest complete: %d bars, %d trades, final equity %.2f",
            len(portfolio),
            len(trades),
            equity[-1],
        )

        return BacktestResult(portfolio=portfolio, trades=trades, config=cfg, signals=signals)
