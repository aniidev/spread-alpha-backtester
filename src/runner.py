"""High-level orchestration: run a backtest end-to-end for one or many pairs.

Used by `main.py` (CLI) and importable from notebooks for ad-hoc research.
"""
from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import pandas as pd

from .backtester import BacktestConfig, BacktestResult, Backtester
from .data import PriceLoader, align_pair
from .data.loader import PricePanel
from .metrics import PerformanceSummary, compute_summary, format_summary
from .strategies import PairsParams, build_pairs_signals
from .utils import engle_granger_test, plot_equity_curve, plot_pair_diagnostics
from .utils.cointegration import CointegrationResult

logger = logging.getLogger(__name__)


@dataclass
class PairRun:
    """Results for one (ticker_a, ticker_b) backtest."""

    ticker_a: str
    ticker_b: str
    params: PairsParams
    summary: PerformanceSummary
    result: BacktestResult
    cointegration: CointegrationResult | None


def run_pair(
    panel: PricePanel,
    ticker_a: str,
    ticker_b: str,
    params: PairsParams,
    config: BacktestConfig,
    *,
    cointegration_significance: float | None = 0.05,
) -> PairRun:
    """Run the full pipeline for a single pair.

    Args:
        panel: Price panel containing both tickers.
        ticker_a, ticker_b: Symbols to trade.
        params: Strategy hyperparameters.
        config: Backtest configuration.
        cointegration_significance: If not None, also run an Engle–Granger test.

    Returns:
        PairRun with summary stats, full backtest result, and cointegration test.
    """
    price_a, price_b = align_pair(panel, ticker_a, ticker_b)

    coint_result: CointegrationResult | None = None
    if cointegration_significance is not None:
        try:
            coint_result = engle_granger_test(
                price_a,
                price_b,
                ticker_a=ticker_a,
                ticker_b=ticker_b,
                significance=cointegration_significance,
            )
            logger.info(
                "Cointegration %s/%s: t=%.3f p=%.4f → %s",
                ticker_a, ticker_b,
                coint_result.t_statistic,
                coint_result.p_value,
                "COINTEGRATED" if coint_result.is_cointegrated else "not cointegrated",
            )
        except Exception:  # pragma: no cover — defensive against statsmodels edge cases
            logger.exception("Cointegration test failed for %s/%s", ticker_a, ticker_b)

    signals = build_pairs_signals(price_a, price_b, params)
    result = Backtester(config).run(price_a, price_b, signals)
    summary = compute_summary(result)

    return PairRun(
        ticker_a=ticker_a,
        ticker_b=ticker_b,
        params=params,
        summary=summary,
        result=result,
        cointegration=coint_result,
    )


def run_many(
    pairs: Sequence[tuple[str, str]],
    *,
    start: str,
    end: str,
    params: PairsParams,
    config: BacktestConfig,
    loader: PriceLoader | None = None,
    cointegration_significance: float | None = 0.05,
) -> list[PairRun]:
    """Backtest multiple pairs sharing one price panel.

    All tickers are downloaded in one batch, then each pair runs against the
    aligned panel.
    """
    loader = loader or PriceLoader()
    universe = sorted({t for pair in pairs for t in pair})
    panel = loader.fetch(universe, start=start, end=end)

    runs: list[PairRun] = []
    for ticker_a, ticker_b in pairs:
        try:
            runs.append(
                run_pair(panel, ticker_a, ticker_b, params, config,
                         cointegration_significance=cointegration_significance)
            )
        except Exception:
            logger.exception("Pair %s/%s failed; skipping", ticker_a, ticker_b)
    return runs


def grid_search(
    panel: PricePanel,
    ticker_a: str,
    ticker_b: str,
    *,
    config: BacktestConfig,
    zscore_lookbacks: Iterable[int],
    entry_zs: Iterable[float],
    exit_zs: Iterable[float] = (0.0,),
    rolling_beta: bool = False,
    beta_lookback: int = 60,
) -> pd.DataFrame:
    """Sweep strategy parameters and return a ranked summary table.

    Each row corresponds to one (lookback, entry_z, exit_z) combination.
    """
    rows: list[dict] = []
    for lookback, entry_z, exit_z in itertools.product(zscore_lookbacks, entry_zs, exit_zs):
        if entry_z <= exit_z:
            continue  # invalid; entry must dominate exit
        try:
            params = PairsParams(
                zscore_lookback=lookback,
                entry_z=entry_z,
                exit_z=exit_z,
                rolling_beta=rolling_beta,
                beta_lookback=beta_lookback,
            )
        except ValueError:
            continue
        try:
            run = run_pair(panel, ticker_a, ticker_b, params, config,
                           cointegration_significance=None)
        except Exception:
            logger.exception("Grid point (%s, %s, %s) failed", lookback, entry_z, exit_z)
            continue
        rows.append({
            "ticker_a": ticker_a,
            "ticker_b": ticker_b,
            "zscore_lookback": lookback,
            "entry_z": entry_z,
            "exit_z": exit_z,
            "total_return": run.summary.total_return,
            "annualized_return": run.summary.annualized_return,
            "sharpe": run.summary.sharpe_ratio,
            "max_drawdown": run.summary.max_drawdown,
            "n_trades": run.summary.n_trades,
            "win_rate": run.summary.win_rate,
        })
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("sharpe", ascending=False).reset_index(drop=True)
    return df


def save_run_artifacts(
    run: PairRun, output_dir: str | Path, *, make_plots: bool = True
) -> dict[str, Path]:
    """Persist a PairRun's CSVs and plots under `output_dir / <pair_name>/`.

    Returns:
        Dict of artifact name → file path.
    """
    output_dir = Path(output_dir)
    pair_name = f"{run.ticker_a}_{run.ticker_b}"
    pair_dir = output_dir / pair_name
    pair_dir.mkdir(parents=True, exist_ok=True)

    artifacts: dict[str, Path] = {}
    portfolio_csv = pair_dir / "portfolio.csv"
    trades_csv = pair_dir / "trades.csv"
    summary_csv = pair_dir / "summary.csv"

    run.result.portfolio.to_csv(portfolio_csv)
    run.result.trades.to_csv(trades_csv, index=False)
    pd.DataFrame([run.summary.as_dict()]).to_csv(summary_csv, index=False)
    artifacts.update(portfolio=portfolio_csv, trades=trades_csv, summary=summary_csv)

    if make_plots:
        price_a = run.result.portfolio["price_a"].rename(run.ticker_a)
        price_b = run.result.portfolio["price_b"].rename(run.ticker_b)
        diag_png = plot_pair_diagnostics(
            price_a, price_b, run.result, run.params,
            output_path=pair_dir / "diagnostics.png",
            title=f"{run.ticker_a} / {run.ticker_b} — spread diagnostics",
        )
        eq_png = plot_equity_curve(
            run.result,
            output_path=pair_dir / "equity.png",
            title=f"{run.ticker_a} / {run.ticker_b} — equity",
        )
        artifacts.update(diagnostics_plot=diag_png, equity_plot=eq_png)

    return artifacts


def print_summary(run: PairRun) -> None:
    """Print a human-readable summary for a single pair run."""
    title = f"{run.ticker_a} / {run.ticker_b}"
    print()
    print(format_summary(run.summary, title=title))
    if run.cointegration is not None:
        c = run.cointegration
        print(
            f"  Cointegration (Engle–Granger): t={c.t_statistic:.3f}, "
            f"p={c.p_value:.4f} → "
            f"{'cointegrated' if c.is_cointegrated else 'not cointegrated'} "
            f"@α={c.significance:.2f}"
        )
