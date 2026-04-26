"""FastAPI backend for the Spread Alpha Backtester dashboard.

Imports the existing src/ backtesting modules directly (no subprocess).
Run with:  uvicorn api.main:app --reload --port 8000
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Project root is one level up from api/
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.backtester import BacktestConfig
from src.data import PriceLoader
from src.runner import PairRun, run_pair
from src.strategies import PairsParams
from src.utils.cointegration import CointegrationResult
from src.robustness import (
    aggregate_summary as rob_aggregate,
    bootstrap_trades,
    compute_robustness_score,
    cost_sensitivity,
    generate_robustness_insight,
    random_window_test,
)

app = FastAPI(title="Spread Alpha Backtester API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RUNS_DIR = ROOT / "results" / "runs"
HISTORY_FILE = ROOT / "results" / "run_history.json"
CACHE_DIR = ROOT / "results" / "cache"

RUNS_DIR.mkdir(parents=True, exist_ok=True)
HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)


# ── Request model ─────────────────────────────────────────────

class BacktestRequest(BaseModel):
    ticker_a: str = Field(..., min_length=1, max_length=10)
    ticker_b: str = Field(..., min_length=1, max_length=10)
    start: str = "2020-01-01"
    end: str = "2024-12-31"
    zscore_lookback: int = Field(60, ge=5, le=252)
    entry_z: float = Field(2.0, gt=0, le=5)
    exit_z: float = Field(0.0, ge=0, lt=5)
    rolling_beta: bool = False
    beta_lookback: int = Field(60, ge=10, le=252)
    train_fraction: float = Field(0.5, gt=0, le=1)
    initial_capital: float = Field(100_000.0, gt=0)
    transaction_cost_bps: float = Field(10.0, ge=0, le=100)
    target_dollar_exposure: Optional[float] = None


# ── Serialization helpers ──────────────────────────────────────

def _safe(v: Any) -> Any:
    """Convert numpy scalars, NaN, Inf to JSON-safe Python types."""
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (np.floating, float)):
        if math.isnan(v) or math.isinf(v):
            return None
        return float(v)
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    return v


def _series_to_records(index: pd.Index, **series: pd.Series) -> list[dict]:
    """Convert aligned series to [{date, key1, key2, ...}] records."""
    dates = index.strftime("%Y-%m-%d").tolist()
    arrays = {k: v.to_numpy(dtype=float) for k, v in series.items()}
    records = []
    for i, date in enumerate(dates):
        row: dict = {"date": date}
        for k, arr in arrays.items():
            val = float(arr[i])
            row[k] = None if (math.isnan(val) or math.isinf(val)) else val
        records.append(row)
    return records


def _compute_drawdown(equity: pd.Series) -> pd.Series:
    peak = equity.cummax()
    return equity / peak - 1.0


def _generate_insight(
    ticker_a: str,
    ticker_b: str,
    metrics: dict,
    coint: CointegrationResult | None,
    params: PairsParams,
) -> str:
    parts: list[str] = []

    if coint is not None:
        if coint.is_cointegrated:
            parts.append(
                f"{ticker_a}/{ticker_b} passes the Engle–Granger cointegration test "
                f"(p = {coint.p_value:.4f}), providing statistical support for the "
                f"mean-reversion assumption underlying this strategy."
            )
        else:
            parts.append(
                f"{ticker_a}/{ticker_b} does not exhibit statistically significant "
                f"cointegration (p = {coint.p_value:.4f} > α = {coint.significance:.2f}). "
                f"The mean-reversion hypothesis is statistically weak; interpret results cautiously."
            )

    sharpe = metrics.get("sharpe_ratio")
    if sharpe is not None:
        if sharpe > 1.5:
            parts.append(
                f"The strategy delivers strong risk-adjusted performance "
                f"(Sharpe: {sharpe:.2f}), consistent with a viable systematic edge."
            )
        elif sharpe > 0.7:
            parts.append(
                f"Risk-adjusted returns are moderate (Sharpe: {sharpe:.2f}). "
                f"Real-world slippage and out-of-sample decay may erode this further."
            )
        else:
            parts.append(
                f"The Sharpe ratio of {sharpe:.2f} is below institutional thresholds, "
                f"suggesting the strategy does not generate adequate return per unit of risk."
            )

    mdd = metrics.get("max_drawdown")
    if mdd is not None:
        if abs(mdd) > 0.20:
            parts.append(
                f"The maximum drawdown of {abs(mdd):.1%} is substantial—"
                f"position-sizing discipline and drawdown controls are warranted."
            )
        elif abs(mdd) < 0.05:
            parts.append(
                f"Drawdown is well-contained at {abs(mdd):.1%}, "
                f"consistent with reliable mean-reversion behavior."
            )

    n_trades = metrics.get("n_trades") or 0
    if n_trades < 10:
        parts.append(
            f"Only {n_trades} round-trip trades were executed over this period, "
            f"limiting the statistical robustness of these results."
        )

    win_rate = metrics.get("win_rate")
    if win_rate is not None:
        if win_rate >= 0.65:
            parts.append(
                f"A win rate of {win_rate:.1%} is strong for a mean-reversion strategy, "
                f"indicating the spread reliably reverts after extreme deviations."
            )
        elif win_rate < 0.45:
            parts.append(
                f"Win rate of {win_rate:.1%} is below 50%—unusual for mean reversion—"
                f"which may indicate noisy signals or an unstable hedge ratio."
            )

    total_costs = metrics.get("total_costs") or 0
    total_return = metrics.get("total_return") or 0
    final_equity = metrics.get("final_equity") or 1
    initial_capital = final_equity / max(1 + total_return, 0.01)
    if initial_capital > 0 and total_costs / initial_capital > 0.02:
        parts.append(
            f"Transaction costs of ${total_costs:,.0f} represent a meaningful drag; "
            f"consider widening the entry threshold to reduce turnover."
        )

    pf = metrics.get("profit_factor")
    if pf is not None and pf < 1.0:
        parts.append(
            "Profit factor is below 1.0—gross losses exceed gross profits on a per-trade basis."
        )

    if not parts:
        return (
            f"Backtest completed for {ticker_a}/{ticker_b}. "
            f"Review the metrics and charts above for detailed performance analysis."
        )
    return " ".join(parts)


def _load_history() -> list[dict]:
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_history(history: list[dict]) -> None:
    HISTORY_FILE.write_text(
        json.dumps(history[-50:], indent=2),
        encoding="utf-8",
    )


# ── Endpoints ─────────────────────────────────────────────────

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": "1.0.0"}


@app.post("/api/backtest")
def run_backtest(req: BacktestRequest) -> dict:
    ticker_a = req.ticker_a.upper().strip()
    ticker_b = req.ticker_b.upper().strip()

    if ticker_a == ticker_b:
        raise HTTPException(400, "ticker_a and ticker_b must be different")

    try:
        params = PairsParams(
            zscore_lookback=req.zscore_lookback,
            entry_z=req.entry_z,
            exit_z=req.exit_z,
            rolling_beta=req.rolling_beta,
            beta_lookback=req.beta_lookback,
            train_fraction=req.train_fraction,
        )
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc

    config = BacktestConfig(
        initial_capital=req.initial_capital,
        transaction_cost=req.transaction_cost_bps / 10_000.0,
        target_dollar_exposure=req.target_dollar_exposure,
    )

    loader = PriceLoader(cache_dir=str(CACHE_DIR))
    try:
        panel = loader.fetch([ticker_a, ticker_b], start=req.start, end=req.end)
    except Exception as exc:
        raise HTTPException(400, detail=f"Failed to fetch price data: {exc}") from exc

    try:
        run: PairRun = run_pair(panel, ticker_a, ticker_b, params, config)
    except Exception as exc:
        raise HTTPException(500, detail=f"Backtest engine error: {exc}") from exc

    # ── Serialize ────────────────────────────────────────────
    portfolio = run.result.portfolio
    signals = run.result.signals
    trades_df = run.result.trades
    summary = run.summary
    coint = run.cointegration

    metrics = {k: _safe(v) for k, v in summary.as_dict().items()}

    coint_dict: dict | None = None
    if coint is not None:
        cv = coint.critical_values  # tuple: (1%, 5%, 10%)
        coint_dict = {
            "t_statistic": _safe(coint.t_statistic),
            "p_value": _safe(coint.p_value),
            "critical_values": {"1%": float(cv[0]), "5%": float(cv[1]), "10%": float(cv[2])},
            "is_cointegrated": bool(coint.is_cointegrated),
            "significance": coint.significance,
        }

    equity_ts = _series_to_records(portfolio.index, value=portfolio["equity"])
    drawdown_ts = _series_to_records(
        portfolio.index, value=_compute_drawdown(portfolio["equity"])
    )
    zscore_ts = _series_to_records(
        signals.zscore.index,
        value=signals.zscore,
        position=signals.position.astype(float),
    )
    spread_ts = _series_to_records(signals.spread.index, value=signals.spread)
    prices_ts = _series_to_records(
        portfolio.index,
        price_a=portfolio["price_a"],
        price_b=portfolio["price_b"],
    )

    trades_list: list[dict] = []
    if not trades_df.empty:
        for _, row in trades_df.iterrows():
            trades_list.append({
                "side": str(row.get("side", "")),
                "entry_date": str(row.get("entry_date", ""))[:10],
                "exit_date": str(row.get("exit_date", ""))[:10],
                "pnl": _safe(row.get("pnl")),
                "return": _safe(row.get("return")),
                "beta": _safe(row.get("beta")),
                "forced_close": bool(row.get("forced_close", False)),
            })

    run_id = f"{ticker_a}_{ticker_b}_{int(datetime.now(timezone.utc).timestamp())}"
    timestamp = datetime.now(timezone.utc).isoformat()
    insight = _generate_insight(ticker_a, ticker_b, metrics, coint, params)

    result = {
        "run_id": run_id,
        "ticker_a": ticker_a,
        "ticker_b": ticker_b,
        "timestamp": timestamp,
        "status": "success",
        "params": {
            "zscore_lookback": params.zscore_lookback,
            "entry_z": params.entry_z,
            "exit_z": params.exit_z,
            "rolling_beta": params.rolling_beta,
            "beta_lookback": params.beta_lookback,
            "train_fraction": params.train_fraction,
        },
        "config": {
            "initial_capital": config.initial_capital,
            "transaction_cost_bps": req.transaction_cost_bps,
            "target_dollar_exposure": config.target_dollar_exposure,
        },
        "metrics": metrics,
        "cointegration": coint_dict,
        "timeseries": {
            "equity": equity_ts,
            "drawdown": drawdown_ts,
            "zscore": zscore_ts,
            "spread": spread_ts,
            "prices": prices_ts,
        },
        "trades": trades_list,
        "insight": insight,
    }

    # Persist full result to disk
    run_file = RUNS_DIR / f"{run_id}.json"
    run_file.write_text(json.dumps(result, indent=2), encoding="utf-8")

    # Update lightweight history index
    history = _load_history()
    history.append({
        "run_id": run_id,
        "ticker_a": ticker_a,
        "ticker_b": ticker_b,
        "timestamp": timestamp,
        "metrics": {
            k: metrics.get(k)
            for k in ["final_equity", "total_return", "sharpe_ratio", "max_drawdown", "n_trades"]
        },
        "params": result["params"],
        "is_cointegrated": coint_dict["is_cointegrated"] if coint_dict else None,
        "cointegration_p": coint_dict["p_value"] if coint_dict else None,
    })
    _save_history(history)

    return result


@app.get("/api/history")
def get_history() -> list[dict]:
    return list(reversed(_load_history()))


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    run_file = RUNS_DIR / f"{run_id}.json"
    if not run_file.exists():
        raise HTTPException(404, detail=f"Run '{run_id}' not found")
    return json.loads(run_file.read_text(encoding="utf-8"))


@app.delete("/api/history")
def clear_history() -> dict:
    _save_history([])
    for f in RUNS_DIR.glob("*.json"):
        f.unlink(missing_ok=True)
    return {"status": "cleared"}


# ── Robustness endpoint ───────────────────────────────────────

class RobustnessRequest(BaseModel):
    ticker_a: str = Field(..., min_length=1, max_length=10)
    ticker_b: str = Field(..., min_length=1, max_length=10)
    start: str = "2020-01-01"
    end: str = "2024-12-31"
    # Strategy params (mirrors BacktestRequest)
    zscore_lookback: int = Field(60, ge=5, le=252)
    entry_z: float = Field(2.0, gt=0, le=5)
    exit_z: float = Field(0.0, ge=0, lt=5)
    rolling_beta: bool = False
    beta_lookback: int = Field(60, ge=10, le=252)
    train_fraction: float = Field(0.5, gt=0, le=1)
    initial_capital: float = Field(100_000.0, gt=0)
    transaction_cost_bps: float = Field(10.0, ge=0, le=100)
    target_dollar_exposure: Optional[float] = None
    # Robustness config
    n_window_sims: int = Field(200, ge=50, le=500)
    window_years: float = Field(2.0, ge=0.5, le=5.0)
    n_bootstrap_sims: int = Field(500, ge=100, le=2000)
    cost_range_bps: list[float] = [0, 5, 10, 20, 30, 40, 50, 75, 100]


@app.post("/api/robustness")
def run_robustness(req: RobustnessRequest) -> dict:
    ticker_a = req.ticker_a.upper().strip()
    ticker_b = req.ticker_b.upper().strip()

    if ticker_a == ticker_b:
        raise HTTPException(400, "ticker_a and ticker_b must be different")

    try:
        params = PairsParams(
            zscore_lookback=req.zscore_lookback,
            entry_z=req.entry_z,
            exit_z=req.exit_z,
            rolling_beta=req.rolling_beta,
            beta_lookback=req.beta_lookback,
            train_fraction=req.train_fraction,
        )
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc

    config = BacktestConfig(
        initial_capital=req.initial_capital,
        transaction_cost=req.transaction_cost_bps / 10_000.0,
        target_dollar_exposure=req.target_dollar_exposure,
    )

    loader = PriceLoader(cache_dir=str(CACHE_DIR))
    try:
        panel = loader.fetch([ticker_a, ticker_b], start=req.start, end=req.end)
    except Exception as exc:
        raise HTTPException(400, detail=f"Failed to fetch price data: {exc}") from exc

    from src.data import align_pair
    try:
        price_a, price_b = align_pair(panel, ticker_a, ticker_b)
    except Exception as exc:
        raise HTTPException(400, detail=f"Failed to align prices: {exc}") from exc

    # Run the baseline backtest to get trades for bootstrap
    try:
        base_run: PairRun = run_pair(panel, ticker_a, ticker_b, params, config,
                                     cointegration_significance=None)
    except Exception as exc:
        raise HTTPException(500, detail=f"Baseline backtest failed: {exc}") from exc

    # ── 3 robustness dimensions ───────────────────────────────
    try:
        window_runs = random_window_test(
            price_a, price_b, params, config,
            n_simulations=req.n_window_sims,
            window_years=req.window_years,
        )
    except Exception as exc:
        raise HTTPException(500, detail=f"Window test failed: {exc}") from exc

    try:
        bootstrap_runs = bootstrap_trades(
            base_run.result.trades,
            initial_capital=req.initial_capital,
            n_simulations=req.n_bootstrap_sims,
        )
    except Exception as exc:
        raise HTTPException(500, detail=f"Bootstrap test failed: {exc}") from exc

    try:
        cost_runs = cost_sensitivity(
            price_a, price_b, params, config,
            cost_bps_range=sorted(set(req.cost_range_bps)),
        )
    except Exception as exc:
        raise HTTPException(500, detail=f"Cost sensitivity test failed: {exc}") from exc

    summary   = rob_aggregate(window_runs, bootstrap_runs, cost_runs)
    rob_score = compute_robustness_score(window_runs, bootstrap_runs, cost_runs)
    insight   = generate_robustness_insight(
        ticker_a, ticker_b, summary, rob_score,
        req.n_window_sims, req.n_bootstrap_sims,
    )

    # Baseline metrics for context
    base_metrics = {k: _safe(v) for k, v in base_run.summary.as_dict().items()}

    return {
        "ticker_a":         ticker_a,
        "ticker_b":         ticker_b,
        "robustness_score": rob_score,
        "summary":          summary,
        "window_runs":      window_runs,
        "bootstrap_runs":   bootstrap_runs,
        "cost_sensitivity": cost_runs,
        "insight":          insight,
        "baseline_metrics": base_metrics,
        "params": {
            "zscore_lookback": params.zscore_lookback,
            "entry_z":         params.entry_z,
            "exit_z":          params.exit_z,
            "n_window_sims":   req.n_window_sims,
            "window_years":    req.window_years,
            "n_bootstrap_sims": req.n_bootstrap_sims,
            "cost_range_bps":  sorted(set(req.cost_range_bps)),
        },
    }
