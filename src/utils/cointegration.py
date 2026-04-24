"""Engle–Granger cointegration test for pair selection.

Two non-stationary series are cointegrated if a linear combination of them is
stationary. The Engle–Granger procedure (statsmodels.tsa.stattools.coint)
returns a t-statistic and p-value testing the null of no cointegration.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from statsmodels.tsa.stattools import coint


@dataclass(frozen=True)
class CointegrationResult:
    """Outcome of an Engle–Granger test on a pair.

    Attributes:
        ticker_a, ticker_b: Asset symbols.
        t_statistic: Engle–Granger test statistic.
        p_value: P-value of the test (smaller = stronger evidence of cointegration).
        critical_values: Critical t-stats at the 1%, 5%, 10% levels.
        is_cointegrated: True if `p_value` < `significance`.
        significance: Significance level used for the boolean flag.
    """

    ticker_a: str
    ticker_b: str
    t_statistic: float
    p_value: float
    critical_values: tuple[float, float, float]
    is_cointegrated: bool
    significance: float


def engle_granger_test(
    price_a: pd.Series,
    price_b: pd.Series,
    *,
    ticker_a: str | None = None,
    ticker_b: str | None = None,
    significance: float = 0.05,
) -> CointegrationResult:
    """Run an Engle–Granger cointegration test on two aligned price series.

    Args:
        price_a, price_b: Aligned price series (same DatetimeIndex).
        ticker_a, ticker_b: Optional symbol labels (defaults to series name or '?').
        significance: Threshold below which `p_value` triggers `is_cointegrated`.
    """
    if not price_a.index.equals(price_b.index):
        raise ValueError("price_a and price_b must share the same index")
    if len(price_a) < 30:
        raise ValueError("Need at least 30 observations for cointegration test")

    t_stat, p_value, crit = coint(price_a.to_numpy(), price_b.to_numpy())
    crit_tuple = (float(crit[0]), float(crit[1]), float(crit[2]))

    return CointegrationResult(
        ticker_a=ticker_a or str(price_a.name) or "A",
        ticker_b=ticker_b or str(price_b.name) or "B",
        t_statistic=float(t_stat),
        p_value=float(p_value),
        critical_values=crit_tuple,
        is_cointegrated=bool(p_value < significance),
        significance=significance,
    )
