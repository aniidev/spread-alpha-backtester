"""Monte Carlo / Robustness testing for the pairs-trading strategy.

Three orthogonal stress dimensions:
  1. Random historical window sampling — does the edge persist across subperiods?
  2. Bootstrap trade-return resampling — does the edge survive sequence randomness?
  3. Transaction cost perturbation    — at what cost level does alpha vanish?

All computation reuses existing strategy modules (no duplication of logic).
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .backtester import BacktestConfig, Backtester
from .metrics import compute_summary
from .strategies import PairsParams, build_pairs_signals


# ── Type helpers ──────────────────────────────────────────────

def _safe(v: Any) -> Any:
    """Convert numpy scalars / NaN / Inf to JSON-serialisable Python types."""
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (np.floating, float)):
        if math.isnan(v) or math.isinf(v):
            return None
        return float(v)
    return v


# ── 1. Random historical window sampling ──────────────────────

def random_window_test(
    price_a: pd.Series,
    price_b: pd.Series,
    params: PairsParams,
    config: BacktestConfig,
    *,
    n_simulations: int = 200,
    window_years: float = 2.0,
    seed: int = 42,
) -> list[dict]:
    """Run the strategy on N randomly sampled contiguous time windows.

    Answers: is the edge real, or specific to one lucky historical period?
    """
    rng = np.random.default_rng(seed)
    min_bars_for_params = params.zscore_lookback * 3 + params.beta_lookback
    window_bars = max(int(window_years * 252), min_bars_for_params + 30)
    n = len(price_a)

    if window_bars >= n:
        window_bars = max(n // 2, min_bars_for_params + 30)
    if n - window_bars < 1:
        return []

    results: list[dict] = []
    for _ in range(n_simulations):
        start_idx = int(rng.integers(0, n - window_bars))
        end_idx = start_idx + window_bars
        sub_a = price_a.iloc[start_idx:end_idx]
        sub_b = price_b.iloc[start_idx:end_idx]
        try:
            signals = build_pairs_signals(sub_a, sub_b, params)
            bt = Backtester(config).run(sub_a, sub_b, signals)
            s = compute_summary(bt)
            results.append({
                "window_start":     str(sub_a.index[0].date()),
                "window_end":       str(sub_a.index[-1].date()),
                "sharpe":           _safe(s.sharpe_ratio),
                "total_return":     _safe(s.total_return),
                "annualized_return": _safe(s.annualized_return),
                "max_drawdown":     _safe(s.max_drawdown),
                "win_rate":         _safe(s.win_rate),
                "n_trades":         int(s.n_trades),
            })
        except Exception:
            pass

    return results


# ── 2. Bootstrap trade-return resampling ──────────────────────

def bootstrap_trades(
    trades: pd.DataFrame,
    initial_capital: float = 100_000.0,
    *,
    n_simulations: int = 500,
    seed: int = 42,
) -> list[dict]:
    """Resample realized trade returns (with replacement) N times.

    Answers: how much of the strategy's P&L comes from the *sequence* of trades
    vs. the actual trade-return distribution?
    """
    if trades.empty or "return" not in trades.columns:
        return []

    raw = trades["return"].dropna().to_numpy()
    if len(raw) < 3:
        return []

    rng = np.random.default_rng(seed)
    results: list[dict] = []

    for _ in range(n_simulations):
        sample = rng.choice(raw, size=len(raw), replace=True)

        # Equity path from compounded trade returns
        cum = np.cumprod(1.0 + sample)
        total_return = float(cum[-1]) - 1.0

        # Trade-level Sharpe proxy (mean/std × √n, captures info ratio)
        std = float(sample.std(ddof=1))
        sharpe_proxy = (
            float(sample.mean() / std * np.sqrt(len(sample)))
            if std > 0 else float("nan")
        )

        # Drawdown on the trade equity path
        cummax = np.maximum.accumulate(cum)
        dd = float((cum / cummax - 1.0).min())

        results.append({
            "cumulative_return": _safe(total_return),
            "sharpe_proxy":      _safe(sharpe_proxy),
            "max_drawdown":      _safe(dd),
        })

    return results


# ── 3. Transaction cost sensitivity ───────────────────────────

def cost_sensitivity(
    price_a: pd.Series,
    price_b: pd.Series,
    params: PairsParams,
    config: BacktestConfig,
    cost_bps_range: list[float] | None = None,
) -> list[dict]:
    """Re-run the strategy across a range of transaction cost assumptions.

    Signals are computed once (costs do not affect signal generation).
    Answers: at what cost level does alpha disappear?
    """
    if cost_bps_range is None:
        cost_bps_range = [0, 5, 10, 20, 30, 40, 50, 75, 100]

    # Signals are cost-independent — compute once
    signals = build_pairs_signals(price_a, price_b, params)

    results: list[dict] = []
    for bps in cost_bps_range:
        adj_config = BacktestConfig(
            initial_capital=config.initial_capital,
            transaction_cost=bps / 10_000.0,
            target_dollar_exposure=config.target_dollar_exposure,
            annualization_factor=config.annualization_factor,
        )
        try:
            bt = Backtester(adj_config).run(price_a, price_b, signals)
            s = compute_summary(bt)
            results.append({
                "cost_bps":          float(bps),
                "sharpe":            _safe(s.sharpe_ratio),
                "total_return":      _safe(s.total_return),
                "annualized_return": _safe(s.annualized_return),
                "max_drawdown":      _safe(s.max_drawdown),
                "total_costs":       _safe(s.total_costs),
                "n_trades":          int(s.n_trades),
            })
        except Exception:
            results.append({
                "cost_bps": float(bps), "sharpe": None, "total_return": None,
                "annualized_return": None, "max_drawdown": None,
                "total_costs": None, "n_trades": 0,
            })

    return results


# ── Aggregate statistics ───────────────────────────────────────

def aggregate_summary(
    window_runs: list[dict],
    bootstrap_runs: list[dict],
    cost_runs: list[dict],
) -> dict:
    """Compute cross-simulation statistics for all three robustness dimensions."""
    out: dict[str, Any] = {}

    # ── Window stats ──
    sharpes  = [r["sharpe"] for r in window_runs
                if r.get("sharpe") is not None and not math.isnan(r["sharpe"])]
    returns  = [r["total_return"] for r in window_runs
                if r.get("total_return") is not None and not math.isnan(r["total_return"])]
    drawdowns = [r["max_drawdown"] for r in window_runs
                 if r.get("max_drawdown") is not None and not math.isnan(r["max_drawdown"])]

    if sharpes:
        arr = np.array(sharpes)
        out["mean_sharpe"]          = _safe(float(arr.mean()))
        out["median_sharpe"]        = _safe(float(np.median(arr)))
        out["sharpe_std"]           = _safe(float(arr.std(ddof=1)))
        out["sharpe_ci_low"]        = _safe(float(np.percentile(arr, 2.5)))
        out["sharpe_ci_high"]       = _safe(float(np.percentile(arr, 97.5)))
        out["sharpe_p25"]           = _safe(float(np.percentile(arr, 25)))
        out["sharpe_p75"]           = _safe(float(np.percentile(arr, 75)))
        out["pct_positive_sharpe"]  = _safe(float((arr > 0).mean()))

    if returns:
        arr_r = np.array(returns)
        out["mean_return"]           = _safe(float(arr_r.mean()))
        out["pct_positive_windows"]  = _safe(float((arr_r > 0).mean()))

    if drawdowns:
        out["worst_drawdown"]  = _safe(float(min(drawdowns)))
        out["median_drawdown"] = _safe(float(np.median(drawdowns)))

    # ── Bootstrap stats ──
    b_rets = [r["cumulative_return"] for r in bootstrap_runs
              if r.get("cumulative_return") is not None]
    if b_rets:
        arr_b = np.array(b_rets)
        out["bootstrap_mean_return"]  = _safe(float(arr_b.mean()))
        out["bootstrap_ci_low"]       = _safe(float(np.percentile(arr_b, 2.5)))
        out["bootstrap_ci_high"]      = _safe(float(np.percentile(arr_b, 97.5)))
        out["bootstrap_pct_positive"] = _safe(float((arr_b > 0).mean()))

    # ── Cost breakeven ──
    if cost_runs:
        profitable = [
            r["cost_bps"] for r in cost_runs
            if r.get("total_return") is not None and r["total_return"] > 0
        ]
        out["breakeven_cost_bps"] = float(max(profitable)) if profitable else 0.0

    return out


# ── Robustness score ─────────────────────────────────────────

def compute_robustness_score(
    window_runs: list[dict],
    bootstrap_runs: list[dict],
    cost_runs: list[dict],
) -> float:
    """Normalised robustness score 0–100 across four dimensions.

    Dimension 1 — Window positivity  (40 pts): fraction of windows with positive Sharpe.
    Dimension 2 — Sharpe stability   (30 pts): low CV of Sharpe → stable edge.
    Dimension 3 — Bootstrap positive (20 pts): fraction of bootstrap runs profitable.
    Dimension 4 — Cost resilience    (10 pts): strategy profitable at ≥20 bps.
    """
    score = 0.0

    # 1. Window positivity
    sharpes = [r["sharpe"] for r in window_runs
               if r.get("sharpe") is not None and not math.isnan(r["sharpe"])]
    if sharpes:
        pos_frac = sum(s > 0 for s in sharpes) / len(sharpes)
        score += pos_frac * 40.0

    # 2. Sharpe stability
    if len(sharpes) > 1:
        mean_s = float(np.mean(sharpes))
        std_s  = float(np.std(sharpes, ddof=1))
        if mean_s > 0 and std_s > 0:
            cv = std_s / mean_s
            stability = max(0.0, 1.0 - min(cv, 3.0) / 3.0)
            score += stability * 30.0
        # If mean ≤ 0, no stability credit

    # 3. Bootstrap positivity
    b_rets = [r["cumulative_return"] for r in bootstrap_runs
              if r.get("cumulative_return") is not None]
    if b_rets:
        pos_frac = sum(r > 0 for r in b_rets) / len(b_rets)
        score += pos_frac * 20.0

    # 4. Cost resilience
    if cost_runs:
        if any(r.get("total_return") is not None and r["total_return"] > 0
               and r["cost_bps"] >= 20 for r in cost_runs):
            score += 10.0
        elif any(r.get("total_return") is not None and r["total_return"] > 0
                 and r["cost_bps"] >= 10 for r in cost_runs):
            score += 5.0

    return round(score, 1)


# ── Insight generation ────────────────────────────────────────

def generate_robustness_insight(
    ticker_a: str,
    ticker_b: str,
    summary: dict,
    robustness_score: float,
    n_window_sims: int,
    n_bootstrap_sims: int,
) -> str:
    parts: list[str] = []

    # Overall verdict
    if robustness_score >= 70:
        parts.append(
            f"The {ticker_a}/{ticker_b} strategy achieves a robustness score of "
            f"{robustness_score:.0f}/100, indicating a stable edge across out-of-sample conditions."
        )
    elif robustness_score >= 45:
        parts.append(
            f"With a robustness score of {robustness_score:.0f}/100, the {ticker_a}/{ticker_b} "
            f"strategy shows moderate stability but meaningful sensitivity to sample selection."
        )
    else:
        parts.append(
            f"The strategy scores {robustness_score:.0f}/100 on robustness, raising material "
            f"concerns about overfitting to the specific historical window tested."
        )

    # Window analysis
    pct_pos   = summary.get("pct_positive_sharpe")
    mean_sh   = summary.get("mean_sharpe")
    ci_lo     = summary.get("sharpe_ci_low")
    ci_hi     = summary.get("sharpe_ci_high")

    if pct_pos is not None and mean_sh is not None:
        if pct_pos >= 0.75:
            parts.append(
                f"Across {n_window_sims} randomly sampled time windows, {pct_pos:.0%} produced "
                f"positive Sharpe ratios (mean {mean_sh:.2f}), supporting a genuine rather than "
                f"data-mined edge."
            )
        elif pct_pos >= 0.50:
            parts.append(
                f"Positive Sharpe in {pct_pos:.0%} of {n_window_sims} random windows "
                f"(mean {mean_sh:.2f})—performance appears partially sample-dependent."
            )
        else:
            parts.append(
                f"Only {pct_pos:.0%} of {n_window_sims} random windows yielded positive Sharpe; "
                f"results are highly sensitive to the time period chosen—a strong overfitting signal."
            )

    if ci_lo is not None and ci_hi is not None:
        parts.append(
            f"The 95% confidence interval for Sharpe is [{ci_lo:.2f}, {ci_hi:.2f}]."
        )

    # Bootstrap analysis
    b_pos    = summary.get("bootstrap_pct_positive")
    b_ci_lo  = summary.get("bootstrap_ci_low")
    b_ci_hi  = summary.get("bootstrap_ci_high")

    if b_pos is not None:
        if b_pos >= 0.80:
            parts.append(
                f"Bootstrap resampling ({n_bootstrap_sims} iterations) confirms the edge: "
                f"{b_pos:.0%} of reordered trade sequences produce positive cumulative returns "
                f"(95% CI: [{b_ci_lo:.1%}, {b_ci_hi:.1%}])."
            )
        elif b_pos >= 0.55:
            parts.append(
                f"Bootstrap simulation shows {b_pos:.0%} of trade sequence permutations are "
                f"profitable—marginal but real per-trade edge "
                f"(95% CI: [{b_ci_lo:.1%}, {b_ci_hi:.1%}])."
            )
        else:
            parts.append(
                f"Only {b_pos:.0%} of bootstrap simulations yield positive returns, "
                f"suggesting the realized P&L may be largely attributable to a favourable "
                f"trade sequence rather than genuine alpha."
            )

    # Cost sensitivity
    bkeven = summary.get("breakeven_cost_bps")
    if bkeven is not None:
        if bkeven >= 30:
            parts.append(
                f"Profitability survives up to ~{bkeven:.0f} bps in transaction costs, "
                f"demonstrating meaningful resilience to execution friction."
            )
        elif bkeven >= 10:
            parts.append(
                f"Alpha holds up to approximately {bkeven:.0f} bps; live execution costs "
                f"approaching this threshold would materially impair returns."
            )
        else:
            parts.append(
                f"The strategy breaks even below {max(bkeven, 0):.0f} bps—it is highly sensitive "
                f"to execution costs and requires a prime-brokerage-level cost structure to be viable."
            )

    # Tail risk note
    worst_dd = summary.get("worst_drawdown")
    if worst_dd is not None and abs(worst_dd) > 0.25:
        parts.append(
            f"Worst-case drawdown across all windows reaches {abs(worst_dd):.1%}—"
            f"tail risk is substantial and demands active position-sizing controls."
        )

    return " ".join(parts)
