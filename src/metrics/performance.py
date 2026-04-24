"""Performance metrics for backtest equity curves and trade logs."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

import numpy as np
import pandas as pd

from ..backtester import BacktestResult


@dataclass(frozen=True)
class PerformanceSummary:
    """Headline backtest statistics."""

    total_return: float
    annualized_return: float
    annualized_volatility: float
    sharpe_ratio: float
    max_drawdown: float
    calmar_ratio: float
    n_trades: int
    win_rate: float
    avg_trade_return: float
    avg_winner: float
    avg_loser: float
    profit_factor: float
    exposure_fraction: float
    total_costs: float
    final_equity: float
    start: pd.Timestamp
    end: pd.Timestamp

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _annualized_return(equity: pd.Series, periods_per_year: int) -> float:
    """CAGR-style annualized return derived from total return and length."""
    if len(equity) < 2 or equity.iloc[0] <= 0:
        return float("nan")
    total = float(equity.iloc[-1] / equity.iloc[0])
    years = len(equity) / periods_per_year
    if years <= 0 or total <= 0:
        return float("nan")
    return total ** (1.0 / years) - 1.0


def _annualized_sharpe(returns: pd.Series, periods_per_year: int, rf: float = 0.0) -> float:
    """Annualized Sharpe ratio of a return series.

    `rf` is a per-period risk-free rate. Uses sample std (ddof=1).
    """
    excess = returns - rf
    std = excess.std(ddof=1)
    if std == 0 or np.isnan(std):
        return float("nan")
    return float(excess.mean() / std * np.sqrt(periods_per_year))


def _max_drawdown(equity: pd.Series) -> float:
    """Maximum peak-to-trough drawdown as a negative fraction."""
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    drawdown = equity / peak - 1.0
    return float(drawdown.min())


def _trade_stats(trades: pd.DataFrame) -> dict[str, float]:
    """Win rate, average win/loss, profit factor."""
    if trades.empty or "return" not in trades.columns:
        return {
            "win_rate": float("nan"),
            "avg_trade_return": float("nan"),
            "avg_winner": float("nan"),
            "avg_loser": float("nan"),
            "profit_factor": float("nan"),
        }
    rets = trades["return"].dropna()
    if rets.empty:
        return {
            "win_rate": float("nan"),
            "avg_trade_return": float("nan"),
            "avg_winner": float("nan"),
            "avg_loser": float("nan"),
            "profit_factor": float("nan"),
        }
    wins = rets[rets > 0]
    losses = rets[rets < 0]
    pnl = trades["pnl"].dropna()
    gross_profit = pnl[pnl > 0].sum()
    gross_loss = -pnl[pnl < 0].sum()
    profit_factor = (
        float(gross_profit / gross_loss) if gross_loss > 0 else float("inf") if gross_profit > 0 else float("nan")
    )
    return {
        "win_rate": float((rets > 0).mean()),
        "avg_trade_return": float(rets.mean()),
        "avg_winner": float(wins.mean()) if not wins.empty else float("nan"),
        "avg_loser": float(losses.mean()) if not losses.empty else float("nan"),
        "profit_factor": profit_factor,
    }


def compute_summary(
    result: BacktestResult, *, risk_free_rate: float = 0.0
) -> PerformanceSummary:
    """Compute the headline performance summary for a backtest result.

    Args:
        result: Output of Backtester.run().
        risk_free_rate: Annualized risk-free rate (e.g. 0.04 for 4%).
            Converted to per-period for the Sharpe calc.
    """
    portfolio = result.portfolio
    trades = result.trades
    af = result.config.annualization_factor

    equity = portfolio["equity"]
    returns = portfolio["returns"]

    if equity.iloc[0] <= 0:
        total_return = float("nan")
    else:
        total_return = float(equity.iloc[-1] / equity.iloc[0] - 1.0)

    ann_ret = _annualized_return(equity, af)
    ann_vol = float(returns.std(ddof=1) * np.sqrt(af)) if len(returns) > 1 else float("nan")
    sharpe = _annualized_sharpe(returns, af, rf=risk_free_rate / af)
    mdd = _max_drawdown(equity)
    calmar = float(ann_ret / abs(mdd)) if mdd < 0 else float("nan")
    exposure_frac = float((portfolio["position"] != 0).mean())
    total_costs = float(portfolio["costs"].sum())
    n_trades = int(len(trades))
    tstats = _trade_stats(trades)

    return PerformanceSummary(
        total_return=total_return,
        annualized_return=ann_ret,
        annualized_volatility=ann_vol,
        sharpe_ratio=sharpe,
        max_drawdown=mdd,
        calmar_ratio=calmar,
        n_trades=n_trades,
        win_rate=tstats["win_rate"],
        avg_trade_return=tstats["avg_trade_return"],
        avg_winner=tstats["avg_winner"],
        avg_loser=tstats["avg_loser"],
        profit_factor=tstats["profit_factor"],
        exposure_fraction=exposure_frac,
        total_costs=total_costs,
        final_equity=float(equity.iloc[-1]),
        start=portfolio.index[0],
        end=portfolio.index[-1],
    )


def format_summary(summary: PerformanceSummary, title: str = "Performance summary") -> str:
    """Return a human-readable string for a PerformanceSummary."""
    rows = [
        ("Period",            f"{summary.start.date()} → {summary.end.date()}"),
        ("Final equity",      f"${summary.final_equity:,.2f}"),
        ("Total return",      f"{summary.total_return:>8.2%}"),
        ("Annualized return", f"{summary.annualized_return:>8.2%}"),
        ("Annualized vol",    f"{summary.annualized_volatility:>8.2%}"),
        ("Sharpe ratio",      f"{summary.sharpe_ratio:>8.2f}"),
        ("Max drawdown",      f"{summary.max_drawdown:>8.2%}"),
        ("Calmar ratio",      f"{summary.calmar_ratio:>8.2f}"),
        ("Exposure",          f"{summary.exposure_fraction:>8.2%}"),
        ("Total costs",       f"${summary.total_costs:,.2f}"),
        ("Trades",            f"{summary.n_trades:>8d}"),
        ("Win rate",          f"{summary.win_rate:>8.2%}"),
        ("Avg trade return",  f"{summary.avg_trade_return:>8.2%}"),
        ("Avg winner",        f"{summary.avg_winner:>8.2%}"),
        ("Avg loser",         f"{summary.avg_loser:>8.2%}"),
        ("Profit factor",     f"{summary.profit_factor:>8.2f}"),
    ]
    width = max(len(k) for k, _ in rows)
    lines = [title, "=" * len(title)]
    for k, v in rows:
        lines.append(f"  {k:<{width}}  {v}")
    return "\n".join(lines)
