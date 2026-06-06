"""Backtest a pair using ML-generated entry/exit signals.

Reuses the existing Backtester engine end-to-end — only the position series
is replaced with the output of the trained ML classifier. The hedge ratio,
spread, and one-bar execution shift come from the same `build_pairs_signals`
pipeline the rule-based strategy uses, so the two backtests are directly
comparable.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..backtester import BacktestConfig, BacktestResult, Backtester
from ..data import align_pair
from ..data.loader import PricePanel
from ..metrics import PerformanceSummary, compute_summary
from ..strategies import PairsParams, PairsSignals, build_pairs_signals
from .signal_model import MLModelResult, ModelType, train_signal_model


@dataclass
class MLBacktestRun:
    """End-to-end outputs for an ML-driven backtest of a single pair."""

    ticker_a: str
    ticker_b: str
    params: PairsParams
    model: MLModelResult
    baseline_signals: PairsSignals
    baseline_result: BacktestResult
    baseline_summary: PerformanceSummary
    ml_signals: PairsSignals
    ml_result: BacktestResult
    ml_summary: PerformanceSummary


def run_ml_backtest(
    panel: PricePanel,
    ticker_a: str,
    ticker_b: str,
    params: PairsParams,
    config: BacktestConfig,
    *,
    model_type: ModelType = "gbm",
    n_bars_target: int = 5,
    exit_z_target: float | None = None,
    train_fraction: float = 0.7,
    long_threshold: float = 0.6,
    short_threshold: float = 0.4,
    random_state: int = 42,
) -> MLBacktestRun:
    """Build features, train the ML model, and backtest both strategies.

    The baseline backtest uses the rule-based PairsSignals as-is. The ML
    backtest reuses the same `beta`, `spread`, and `zscore` but swaps in the
    ML signal as the desired position.
    """
    price_a, price_b = align_pair(panel, ticker_a, ticker_b)

    baseline_signals = build_pairs_signals(price_a, price_b, params)
    baseline_result = Backtester(config).run(price_a, price_b, baseline_signals)
    baseline_summary = compute_summary(baseline_result)

    target_exit_z = params.exit_z if exit_z_target is None else exit_z_target
    # Use a soft cap so very tight exit thresholds still yield a learnable signal.
    if target_exit_z <= 0:
        target_exit_z = 0.5

    model = train_signal_model(
        baseline_signals.zscore,
        baseline_signals.spread,
        model_type=model_type,
        exit_z_target=target_exit_z,
        n_bars_target=n_bars_target,
        train_fraction=train_fraction,
        long_threshold=long_threshold,
        short_threshold=short_threshold,
        random_state=random_state,
    )

    ml_signals = PairsSignals(
        beta=baseline_signals.beta,
        spread=baseline_signals.spread,
        zscore=baseline_signals.zscore,
        position=model.signal_full,
    )
    ml_result = Backtester(config).run(price_a, price_b, ml_signals)
    ml_summary = compute_summary(ml_result)

    return MLBacktestRun(
        ticker_a=ticker_a,
        ticker_b=ticker_b,
        params=params,
        model=model,
        baseline_signals=baseline_signals,
        baseline_result=baseline_result,
        baseline_summary=baseline_summary,
        ml_signals=ml_signals,
        ml_result=ml_result,
        ml_summary=ml_summary,
    )


# ── Threshold sweep ───────────────────────────────────────────────

# Default grid: symmetric thresholds (t_lo = 1 - t_hi) plus a couple of
# asymmetric pairs that bias toward only trading high-conviction setups.
DEFAULT_THRESHOLD_GRID: list[tuple[float, float]] = [
    (0.55, 0.45),
    (0.60, 0.40),
    (0.65, 0.35),
    (0.70, 0.30),
    (0.75, 0.25),
    (0.80, 0.20),
    (0.65, 0.40),  # asymmetric — wider "dead zone"
    (0.70, 0.40),  # asymmetric — only fade strong reversion signals
]


def signal_from_thresholds(
    prob: pd.Series,
    zscore: pd.Series,
    long_threshold: float,
    short_threshold: float,
) -> pd.Series:
    """Derive a {-1, 0, +1} spread position from ML probability + z-score.

    The probability is the model's estimate of P(spread reverts to |z|<exit_z
    in the next N bars). We take a mean-reverting trade only when the model
    is confident (p > long_threshold). Sign of z-score picks the side:
    z<0 means spread is below its mean → long the spread; z>0 → short.

    When p < short_threshold the model is signalling continuation rather than
    reversion, so we stay flat (taking the opposite side of a mean-reversion
    fade has a very different risk profile and is intentionally out of scope).
    """
    sig = pd.Series(0, index=prob.index, dtype=np.int8)
    take = prob > long_threshold
    sig.loc[take & (zscore < 0)] = 1
    sig.loc[take & (zscore > 0)] = -1
    # short_threshold defines the boundary of the "dead zone" — values
    # between short_threshold and long_threshold are ambiguous → flat.
    _ = short_threshold
    return sig.rename("ml_position")


def threshold_sweep(
    price_a: pd.Series,
    price_b: pd.Series,
    baseline_signals: PairsSignals,
    model: MLModelResult,
    config: BacktestConfig,
    *,
    grid: list[tuple[float, float]] | None = None,
) -> list[dict]:
    """Run the cost-aware backtester for each (long_thr, short_thr) pair.

    Reuses the trained `model.prob_full` so it does not retrain. Reuses the
    existing Backtester engine with the same `config` (transaction-cost model
    included). Returns one record per grid point with the headline KPIs.
    """
    grid = grid or DEFAULT_THRESHOLD_GRID
    zscore = baseline_signals.zscore
    rows: list[dict] = []

    for long_thr, short_thr in grid:
        position = signal_from_thresholds(model.prob_full, zscore, long_thr, short_thr)
        signals = PairsSignals(
            beta=baseline_signals.beta,
            spread=baseline_signals.spread,
            zscore=zscore,
            position=position,
        )
        result = Backtester(config).run(price_a, price_b, signals)
        summary = compute_summary(result)

        rows.append({
            "long_threshold": float(long_thr),
            "short_threshold": float(short_thr),
            "symmetric": abs((long_thr + short_thr) - 1.0) < 1e-9,
            "total_return": float(summary.total_return)
                if summary.total_return is not None and not np.isnan(summary.total_return)
                else None,
            "sharpe_ratio": float(summary.sharpe_ratio)
                if summary.sharpe_ratio is not None and not np.isnan(summary.sharpe_ratio)
                else None,
            "max_drawdown": float(summary.max_drawdown)
                if summary.max_drawdown is not None and not np.isnan(summary.max_drawdown)
                else None,
            "n_trades": int(summary.n_trades),
            "total_costs": float(summary.total_costs),
            "win_rate": float(summary.win_rate)
                if summary.win_rate is not None and not np.isnan(summary.win_rate)
                else None,
            "exposure_fraction": float(summary.exposure_fraction),
        })
    return rows
