"""Pair discovery and ranking engine.

Pipeline
--------
1. Load prices for all tickers in the universe (individual fetches, skip failures).
2. Compute pairwise Pearson correlation on log returns → fast O(n²) prefilter.
3. Keep only pairs with |correlation| ≥ min_correlation.
4. If remaining pairs > max_pairs, take top-N by |correlation|.
5. Evaluate each surviving pair in parallel:
      a. Engle–Granger cointegration test
      b. Static OLS hedge ratio
      c. Spread half-life (OU process AR(1) fit)
      d. Hedge-ratio stability score (CV of rolling β)
      e. Optional mini-backtest (Sharpe, return, drawdown)
6. Score each pair with a composite formula.
7. Return a ranked DataFrame.

Scoring formula (max ≈ 90 pts)
-------------------------------
  coint  = (1 – p_value) × 40          [0, 40]  — lower p-value is better
  sharpe = clip(Sharpe, −1, 4) norm × 30 [0, 30]
  dd     = –|max_drawdown| × 10         [−10, 0]
  stab   = stability_score × 20         [0, 20]
  SCORE  = coint + sharpe + dd + stab
"""
from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .backtester import BacktestConfig, Backtester
from .data import PriceLoader
from .metrics import compute_summary
from .strategies import PairsParams, build_pairs_signals
from .strategies.pairs_trading import compute_hedge_ratio, compute_spread
from .utils.cointegration import engle_granger_test

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────

def _safe(v: Any) -> Any:
    if isinstance(v, (float, np.floating)):
        return None if (math.isnan(v) or math.isinf(v)) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    return v


def _halflife(spread: pd.Series) -> float | None:
    """Ornstein-Uhlenbeck mean-reversion half-life (bars).

    Fits AR(1) to the spread differences: ΔS_t = α + β·S_{t-1} + ε
    Half-life = −log(2) / log(1 + β).  Returns None if not mean-reverting.
    """
    s = spread.dropna()
    if len(s) < 20:
        return None
    lagged = s.shift(1).dropna()
    delta  = s.diff().dropna()
    n = min(len(lagged), len(delta))
    lagged, delta = lagged.iloc[-n:], delta.iloc[-n:]
    lm = float(lagged.mean())
    dm = float(delta.mean())
    cov = float(((lagged - lm) * (delta - dm)).sum())
    var = float(((lagged - lm) ** 2).sum())
    if var == 0:
        return None
    beta = cov / var
    if beta >= 0 or (1.0 + beta) <= 0:
        return None
    return round(-math.log(2.0) / math.log(1.0 + beta), 1)


def _stability_score(price_a: pd.Series, price_b: pd.Series, window: int = 60) -> float:
    """Hedge-ratio stability score in [0, 1].

    Computes the rolling OLS β over `window` bars and returns
    1 − min(CV, 2) / 2  where CV = std(β) / |mean(β)|.
    Score 1 = perfectly stable β.  Score 0 = wildly varying β.
    """
    if len(price_a) < window * 2:
        return 0.5
    cov = price_a.rolling(window).cov(price_b, ddof=0)
    var = price_b.rolling(window).var(ddof=0)
    beta = (cov / var.replace(0, np.nan)).dropna()
    if len(beta) < 10 or beta.mean() == 0:
        return 0.5
    cv = float(beta.std(ddof=1) / abs(beta.mean()))
    return float(max(0.0, 1.0 - min(cv, 2.0) / 2.0))


def _compute_score(
    p_value: float,
    sharpe: float | None,
    max_drawdown: float | None,
    stability_score: float,
) -> float:
    """Composite scoring function.  Higher is better.  Max ≈ 90."""
    # Cointegration strength [0, 40]
    coint = max(0.0, 1.0 - p_value) * 40.0

    # Sharpe [0, 30]: clip to [−1, 4], normalize to [0, 1]
    sh = sharpe if (sharpe is not None and math.isfinite(sharpe)) else 0.0
    sharpe_norm = max(0.0, min(sh + 1.0, 5.0)) / 5.0
    sharpe_score = sharpe_norm * 30.0

    # Drawdown penalty [−10, 0]
    dd = abs(max_drawdown) if (max_drawdown is not None and math.isfinite(max_drawdown)) else 0.3
    dd_score = -min(dd, 1.0) * 10.0

    # Stability [0, 20]
    stab = max(0.0, min(stability_score, 1.0)) * 20.0

    return round(coint + sharpe_score + dd_score + stab, 2)


# ── Single-pair evaluation ────────────────────────────────────

def _evaluate_pair(
    price_a: pd.Series,
    price_b: pd.Series,
    ticker_a: str,
    ticker_b: str,
    params: PairsParams,
    config: BacktestConfig,
    run_backtest: bool,
) -> dict | None:
    """Evaluate one candidate pair.  Returns None if evaluation fails."""
    try:
        min_bars = max(params.zscore_lookback * 3, 150)
        # Inner-align the two series
        idx = price_a.index.intersection(price_b.index)
        pa  = price_a.reindex(idx).dropna()
        pb  = price_b.reindex(idx).dropna()
        idx2 = pa.index.intersection(pb.index)
        pa, pb = pa.reindex(idx2), pb.reindex(idx2)
        if len(pa) < min_bars:
            return None

        # 1. Cointegration
        coint = engle_granger_test(pa, pb, ticker_a=ticker_a, ticker_b=ticker_b)

        # 2. Hedge ratio + spread
        hedge = compute_hedge_ratio(pa, pb)
        spread = compute_spread(pa, pb, hedge)

        # 3. Half-life
        hl = _halflife(spread)

        # 4. Stability
        stab = _stability_score(pa, pb)

        # 5. Mini-backtest
        sharpe = total_return = max_drawdown = None
        n_trades = 0
        if run_backtest:
            try:
                signals = build_pairs_signals(pa, pb, params)
                bt = Backtester(config).run(pa, pb, signals)
                s = compute_summary(bt)
                sharpe      = _safe(s.sharpe_ratio)
                total_return = _safe(s.total_return)
                max_drawdown = _safe(s.max_drawdown)
                n_trades    = int(s.n_trades)
            except Exception:
                pass

        score = _compute_score(coint.p_value, sharpe, max_drawdown, stab)

        return {
            "ticker_a":        ticker_a,
            "ticker_b":        ticker_b,
            "p_value":         round(coint.p_value, 4),
            "t_statistic":     round(coint.t_statistic, 3),
            "is_cointegrated": bool(coint.is_cointegrated),
            "hedge_ratio":     round(hedge, 4),
            "halflife":        hl,
            "stability_score": round(stab, 3),
            "sharpe":          sharpe,
            "total_return":    total_return,
            "max_drawdown":    max_drawdown,
            "n_trades":        n_trades,
            "score":           score,
        }
    except Exception as exc:
        logger.debug("Pair %s/%s evaluation failed: %s", ticker_a, ticker_b, exc)
        return None


# ── Price loading ─────────────────────────────────────────────

def _fetch_universe_prices(
    tickers: list[str],
    start: str,
    end: str,
    loader: PriceLoader,
) -> pd.DataFrame:
    """Load price data for a universe, silently skipping any tickers that fail."""
    series: dict[str, pd.Series] = {}
    for ticker in tickers:
        try:
            panel = loader.fetch([ticker], start=start, end=end)
            series[ticker] = panel.prices[ticker]
        except Exception as exc:
            logger.warning("Skipping %s: %s", ticker, exc)

    if not series:
        raise ValueError("No price data could be loaded for any ticker in the universe")

    df = pd.DataFrame(series)
    # Keep rows where at least 80% of loaded tickers have prices
    min_valid = max(2, int(len(series) * 0.8))
    df = df.dropna(thresh=min_valid)
    logger.info("Price panel: %d tickers × %d bars", len(series), len(df))
    return df


# ── Parallel evaluation ───────────────────────────────────────

def _evaluate_pairs_parallel(
    pairs: list[tuple[str, str]],
    prices: pd.DataFrame,
    params: PairsParams,
    config: BacktestConfig,
    run_backtest: bool,
    n_workers: int,
) -> list[dict]:
    results: list[dict] = []

    def _job(ticker_a: str, ticker_b: str) -> dict | None:
        pa = prices[ticker_a].dropna() if ticker_a in prices.columns else None
        pb = prices[ticker_b].dropna() if ticker_b in prices.columns else None
        if pa is None or pb is None:
            return None
        return _evaluate_pair(pa, pb, ticker_a, ticker_b, params, config, run_backtest)

    with ThreadPoolExecutor(max_workers=max(1, n_workers)) as pool:
        futures = {pool.submit(_job, a, b): (a, b) for a, b in pairs}
        done = 0
        for future in as_completed(futures):
            done += 1
            if done % 50 == 0:
                logger.info("  Evaluated %d / %d pairs …", done, len(pairs))
            result = future.result()
            if result is not None:
                results.append(result)

    return results


# ── Public API ────────────────────────────────────────────────

def screen_pairs(
    tickers: list[str],
    *,
    start: str = "2020-01-01",
    end: str = "2024-12-31",
    params: PairsParams | None = None,
    config: BacktestConfig | None = None,
    loader: PriceLoader | None = None,
    min_correlation: float = 0.6,
    max_pairs: int = 300,
    run_backtest: bool = True,
    n_workers: int = 4,
    top_k: int | None = None,
    seed: int = 42,
) -> pd.DataFrame:
    """Screen a universe of tickers and return a ranked DataFrame of pair candidates.

    Args:
        tickers:         List of ticker symbols to screen.
        start, end:      Date range for price data (ISO YYYY-MM-DD).
        params:          Strategy parameters for mini-backtest (default PairsParams()).
        config:          Backtest config (default BacktestConfig()).
        loader:          PriceLoader instance (created with default cache if None).
        min_correlation: Minimum |Pearson correlation| to consider a pair a candidate.
        max_pairs:       Maximum number of pairs to evaluate (top-N by |corr| if exceeded).
        run_backtest:    Whether to run a mini-backtest on each candidate pair.
        n_workers:       Number of parallel threads for pair evaluation.
        top_k:           If set, return only the top-K ranked pairs.
        seed:            RNG seed (reserved for future random sampling).

    Returns:
        DataFrame with columns:
            rank, ticker_a, ticker_b, score, p_value, t_statistic, is_cointegrated,
            hedge_ratio, halflife, stability_score, sharpe, total_return,
            max_drawdown, n_trades
        Sorted by score descending.
    """
    if params is None:
        params = PairsParams()
    if config is None:
        config = BacktestConfig()
    if loader is None:
        loader = PriceLoader()

    tickers = [t.upper().strip() for t in tickers if t.strip()]
    if len(tickers) < 2:
        raise ValueError("Need at least 2 tickers")

    logger.info("Pair screener: %d tickers, %s → %s", len(tickers), start, end)

    # ── 1. Load prices ────────────────────────────────────────
    prices = _fetch_universe_prices(tickers, start, end, loader)
    available = list(prices.columns)
    if len(available) < 2:
        raise ValueError("Need at least 2 tickers with valid data; check ticker symbols.")

    # ── 2. Correlation prefilter ──────────────────────────────
    log_ret = np.log(prices / prices.shift(1)).dropna()
    corr    = log_ret.corr()

    candidates: list[tuple[str, str, float]] = []
    for i, a in enumerate(available):
        for b in available[i + 1:]:
            c = corr.loc[a, b]
            if pd.notna(c) and abs(c) >= min_correlation:
                candidates.append((a, b, abs(c)))

    logger.info(
        "%d candidate pairs after |correlation| ≥ %.2f filter",
        len(candidates), min_correlation,
    )

    # ── 3. Trim to max_pairs by correlation strength ──────────
    if len(candidates) > max_pairs:
        candidates.sort(key=lambda x: x[2], reverse=True)
        candidates = candidates[:max_pairs]
        logger.info("Trimmed to %d pairs by correlation rank", max_pairs)

    if not candidates:
        logger.warning(
            "No candidate pairs found. Try lowering --min-correlation (currently %.2f).",
            min_correlation,
        )
        return pd.DataFrame()

    # ── 4. Parallel evaluation ────────────────────────────────
    logger.info(
        "Evaluating %d pairs with %d worker thread(s) (run_backtest=%s) …",
        len(candidates), n_workers, run_backtest,
    )
    pairs_to_test = [(a, b) for a, b, _ in candidates]
    results = _evaluate_pairs_parallel(
        pairs_to_test, prices, params, config, run_backtest, n_workers
    )
    logger.info("%d / %d pairs evaluated successfully", len(results), len(candidates))

    if not results:
        return pd.DataFrame()

    # ── 5. Build and rank DataFrame ───────────────────────────
    df = (
        pd.DataFrame(results)
        .sort_values("score", ascending=False)
        .reset_index(drop=True)
    )
    df.insert(0, "rank", df.index + 1)

    # Column order
    col_order = [
        "rank", "ticker_a", "ticker_b", "score",
        "p_value", "t_statistic", "is_cointegrated",
        "hedge_ratio", "halflife", "stability_score",
        "sharpe", "total_return", "max_drawdown", "n_trades",
    ]
    df = df[[c for c in col_order if c in df.columns]]

    if top_k is not None:
        df = df.head(top_k)

    return df


def format_screener_table(df: pd.DataFrame) -> str:
    """Return a pretty-printed string of the screener results for CLI output."""
    if df.empty:
        return "(no results)"
    display = df.copy()
    for pct_col in ("total_return", "max_drawdown"):
        if pct_col in display.columns:
            display[pct_col] = display[pct_col].apply(
                lambda v: f"{v*100:.1f}%" if pd.notna(v) else "—"
            )
    for f2_col in ("score", "p_value", "t_statistic", "sharpe", "stability_score"):
        if f2_col in display.columns:
            display[f2_col] = display[f2_col].apply(
                lambda v: f"{v:.2f}" if pd.notna(v) else "—"
            )
    display["pair"] = display["ticker_a"] + "/" + display["ticker_b"]
    cols = [
        "rank", "pair", "score", "p_value", "is_cointegrated",
        "sharpe", "total_return", "max_drawdown", "halflife",
        "stability_score", "n_trades",
    ]
    display = display[[c for c in cols if c in display.columns]]
    try:
        from tabulate import tabulate
        return tabulate(display, headers="keys", tablefmt="simple", showindex=False)
    except ImportError:
        return display.to_string(index=False)
