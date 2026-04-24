"""Pairs trading strategy: hedge ratio, spread, z-score, and signals.

The strategy assumes two cointegrated assets A and B. We model the spread

    S_t = P^A_t - β · P^B_t

and trade it as a mean-reverting series. β (the hedge ratio) is estimated via
OLS — either statically over a training window or rolling. The signal is a
state machine over the z-score of the spread:

    enter long spread  when z_t crosses below -entry_z
    enter short spread when z_t crosses above +entry_z
    exit               when |z_t| crosses below exit_z

All signals at time t are generated using only information available at t,
and are shifted by one bar inside the backtester to prevent lookahead.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class PairsParams:
    """Strategy hyperparameters.

    Attributes:
        zscore_lookback: Window (in bars) for spread mean & std used in z-score.
        entry_z: Absolute z-score required to open a position.
        exit_z: Absolute z-score required to close a position (mean reversion).
        rolling_beta: If True, β is re-estimated over `beta_lookback` bars each day;
            otherwise β is fit once over `train_fraction` of the sample.
        beta_lookback: Window for rolling-β estimation (ignored if rolling_beta=False).
        train_fraction: Fraction of the sample used to fit static β
            (ignored if rolling_beta=True). Must lie in (0, 1].
    """

    zscore_lookback: int = 60
    entry_z: float = 2.0
    exit_z: float = 0.0
    rolling_beta: bool = False
    beta_lookback: int = 60
    train_fraction: float = 0.5

    def __post_init__(self) -> None:
        if self.zscore_lookback < 5:
            raise ValueError("zscore_lookback must be >= 5")
        if self.entry_z <= 0:
            raise ValueError("entry_z must be positive")
        if self.exit_z < 0:
            raise ValueError("exit_z must be non-negative")
        if self.entry_z <= self.exit_z:
            raise ValueError("entry_z must exceed exit_z")
        if not (0 < self.train_fraction <= 1):
            raise ValueError("train_fraction must lie in (0, 1]")
        if self.beta_lookback < 10:
            raise ValueError("beta_lookback must be >= 10")


@dataclass(frozen=True)
class PairsSignals:
    """Outputs of signal construction for a single pair.

    Attributes:
        beta: Hedge ratio per bar (constant series if static β).
        spread: Spread series, S = A - β·B.
        zscore: Rolling z-score of the spread.
        position: Desired position in the spread, in {-1, 0, +1}.
            +1 = long spread (long A, short β·B).
            -1 = short spread (short A, long β·B).
    """

    beta: pd.Series
    spread: pd.Series
    zscore: pd.Series
    position: pd.Series


def compute_hedge_ratio(price_a: pd.Series, price_b: pd.Series) -> float:
    """Estimate the OLS hedge ratio β in P^A = α + β·P^B + ε.

    Uses the closed-form OLS estimator on the full input window. Intercept is
    fit to absorb level differences but is not returned.
    """
    if len(price_a) != len(price_b):
        raise ValueError("price_a and price_b must be the same length")
    if len(price_a) < 2:
        raise ValueError("Need at least 2 observations to fit hedge ratio")

    a = price_a.to_numpy(dtype=float)
    b = price_b.to_numpy(dtype=float)

    b_mean = b.mean()
    a_mean = a.mean()
    cov = ((b - b_mean) * (a - a_mean)).sum()
    var = ((b - b_mean) ** 2).sum()
    if var == 0.0:
        raise ValueError("price_b has zero variance; cannot fit hedge ratio")
    return float(cov / var)


def compute_rolling_hedge_ratio(
    price_a: pd.Series, price_b: pd.Series, window: int
) -> pd.Series:
    """Rolling OLS β over a trailing window.

    For each date t, β_t is the OLS slope of A on B over (t-window+1 .. t].
    Bars before `window` are NaN.
    """
    if len(price_a) != len(price_b):
        raise ValueError("price_a and price_b must be the same length")
    if window < 2:
        raise ValueError("window must be >= 2")

    # Rolling cov / rolling var via pandas. ddof=0 keeps it consistent with the
    # closed-form OLS estimator (the ddof terms cancel anyway).
    cov = price_a.rolling(window).cov(price_b, ddof=0)
    var = price_b.rolling(window).var(ddof=0)
    beta = cov / var.replace(0.0, np.nan)
    return beta.rename("beta")


def compute_spread(price_a: pd.Series, price_b: pd.Series, beta: pd.Series | float) -> pd.Series:
    """Compute the pair spread S = A - β·B.

    `beta` may be a scalar (static β) or a Series aligned to the prices.
    """
    if isinstance(beta, pd.Series):
        beta = beta.reindex(price_a.index)
    return (price_a - beta * price_b).rename("spread")


def compute_zscore(spread: pd.Series, lookback: int) -> pd.Series:
    """Rolling z-score: (S_t - μ_t) / σ_t over a trailing window."""
    if lookback < 2:
        raise ValueError("lookback must be >= 2")
    mean = spread.rolling(lookback).mean()
    std = spread.rolling(lookback).std(ddof=0)
    z = (spread - mean) / std.replace(0.0, np.nan)
    return z.rename("zscore")


def generate_signals(
    zscore: pd.Series, entry_z: float = 2.0, exit_z: float = 0.0
) -> pd.Series:
    """Convert a z-score series into a {-1, 0, +1} position state machine.

    Rules:
        - Flat (0) → enter long  (+1) when z < -entry_z
        - Flat (0) → enter short (-1) when z >  entry_z
        - Long  (+1) → exit (0) when z >= -exit_z
        - Short (-1) → exit (0) when z <=  exit_z

    The state at bar t is the position we *desire* to hold over (t → t+1).
    The backtester is responsible for shifting by one bar to avoid lookahead.
    """
    z = zscore.to_numpy(dtype=float)
    position = np.zeros_like(z, dtype=np.int8)
    state = 0

    for i, zi in enumerate(z):
        if np.isnan(zi):
            position[i] = 0
            state = 0
            continue
        if state == 0:
            if zi < -entry_z:
                state = 1
            elif zi > entry_z:
                state = -1
        elif state == 1:
            if zi >= -exit_z:
                state = 0
        elif state == -1:
            if zi <= exit_z:
                state = 0
        position[i] = state

    return pd.Series(position, index=zscore.index, name="position", dtype=np.int8)


def build_pairs_signals(
    price_a: pd.Series, price_b: pd.Series, params: PairsParams
) -> PairsSignals:
    """End-to-end signal construction for one pair.

    1. Estimate β (static on a training slice, or rolling).
    2. Compute spread, z-score, and position state.
    """
    if not price_a.index.equals(price_b.index):
        raise ValueError("price_a and price_b must share the same index (call align_pair first)")

    if params.rolling_beta:
        beta = compute_rolling_hedge_ratio(price_a, price_b, params.beta_lookback)
    else:
        n_train = max(int(len(price_a) * params.train_fraction), 30)
        n_train = min(n_train, len(price_a))
        beta_value = compute_hedge_ratio(price_a.iloc[:n_train], price_b.iloc[:n_train])
        beta = pd.Series(beta_value, index=price_a.index, name="beta")

    spread = compute_spread(price_a, price_b, beta)
    zscore = compute_zscore(spread, params.zscore_lookback)
    position = generate_signals(zscore, params.entry_z, params.exit_z)

    return PairsSignals(beta=beta, spread=spread, zscore=zscore, position=position)
