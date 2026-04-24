"""CLI for the statistical arbitrage backtester.

Examples
--------

Single pair:
    python main.py --pairs KO,PEP --start 2018-01-01 --end 2024-12-31

Multiple pairs with rolling β and tighter entry:
    python main.py --pairs KO,PEP GLD,SLV XOM,CVX --rolling-beta --entry-z 1.8

Parameter grid search on one pair:
    python main.py --pairs KO,PEP --grid \\
        --grid-lookbacks 30,60,90 --grid-entries 1.5,2.0,2.5
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

# Allow running this file directly without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.backtester import BacktestConfig
from src.data import PriceLoader
from src.runner import (
    grid_search,
    print_summary,
    run_many,
    save_run_artifacts,
)
from src.strategies import PairsParams


def _parse_pairs(raw: list[str]) -> list[tuple[str, str]]:
    """Parse 'A,B' strings (and 'A:B', 'A/B') into (A, B) tuples."""
    pairs: list[tuple[str, str]] = []
    for token in raw:
        for sep in (",", ":", "/"):
            if sep in token:
                a, b = token.split(sep, 1)
                pairs.append((a.strip().upper(), b.strip().upper()))
                break
        else:
            raise argparse.ArgumentTypeError(
                f"Invalid pair {token!r}: expected format 'TICKER_A,TICKER_B'"
            )
    if not pairs:
        raise argparse.ArgumentTypeError("at least one --pairs entry is required")
    return pairs


def _parse_floats(raw: str) -> list[float]:
    return [float(x.strip()) for x in raw.split(",") if x.strip()]


def _parse_ints(raw: str) -> list[int]:
    return [int(x.strip()) for x in raw.split(",") if x.strip()]


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="statarb",
        description="Backtest mean-reversion pairs trading strategies.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # --- universe ---
    p.add_argument("--pairs", nargs="+", required=True,
                   help="One or more 'TICKER_A,TICKER_B' pairs (e.g. KO,PEP GLD,SLV)")
    p.add_argument("--start", default="2018-01-01", help="Inclusive start date (YYYY-MM-DD)")
    p.add_argument("--end", default="2024-12-31", help="Exclusive end date (YYYY-MM-DD)")
    p.add_argument("--no-cache", action="store_true",
                   help="Disable on-disk price cache")

    # --- strategy ---
    p.add_argument("--zscore-lookback", type=int, default=60,
                   help="Rolling window for z-score mean & std")
    p.add_argument("--entry-z", type=float, default=2.0,
                   help="Absolute z-score required to open a position")
    p.add_argument("--exit-z", type=float, default=0.0,
                   help="Absolute z-score required to close a position")
    p.add_argument("--rolling-beta", action="store_true",
                   help="Re-estimate hedge ratio over a trailing window each bar")
    p.add_argument("--beta-lookback", type=int, default=60,
                   help="Window for rolling-β estimation")
    p.add_argument("--train-fraction", type=float, default=0.5,
                   help="Sample fraction used to fit static β (ignored with --rolling-beta)")

    # --- backtest ---
    p.add_argument("--capital", type=float, default=100_000.0,
                   help="Initial capital in dollars")
    p.add_argument("--cost-bps", type=float, default=10.0,
                   help="Transaction cost per leg in basis points (10 = 0.10%%)")
    p.add_argument("--exposure", type=float, default=None,
                   help="Target dollar exposure per spread unit (default: initial capital)")

    # --- evaluation ---
    p.add_argument("--cointegration-alpha", type=float, default=0.05,
                   help="Significance level for the Engle–Granger test")
    p.add_argument("--no-cointegration", action="store_true",
                   help="Skip the cointegration test")
    p.add_argument("--no-plots", action="store_true", help="Skip generating PNG plots")
    p.add_argument("--output", type=Path, default=Path("results"),
                   help="Output directory for CSVs, plots, and the run summary")
    p.add_argument("--log-level", default="INFO",
                   choices=["DEBUG", "INFO", "WARNING", "ERROR"])

    # --- grid search (single-pair only) ---
    p.add_argument("--grid", action="store_true",
                   help="Run a parameter grid search on the first pair instead of a single backtest")
    p.add_argument("--grid-lookbacks", type=str, default="30,60,90",
                   help="Comma-separated z-score lookbacks for the grid")
    p.add_argument("--grid-entries", type=str, default="1.5,2.0,2.5,3.0",
                   help="Comma-separated entry z thresholds for the grid")
    p.add_argument("--grid-exits", type=str, default="0.0,0.5",
                   help="Comma-separated exit z thresholds for the grid")

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    pairs = _parse_pairs(args.pairs)

    params = PairsParams(
        zscore_lookback=args.zscore_lookback,
        entry_z=args.entry_z,
        exit_z=args.exit_z,
        rolling_beta=args.rolling_beta,
        beta_lookback=args.beta_lookback,
        train_fraction=args.train_fraction,
    )
    config = BacktestConfig(
        initial_capital=args.capital,
        transaction_cost=args.cost_bps / 10_000.0,
        target_dollar_exposure=args.exposure,
    )

    args.output.mkdir(parents=True, exist_ok=True)
    loader = PriceLoader(cache_dir=None if args.no_cache else args.output / "cache")

    # --- Grid search mode ---
    if args.grid:
        ticker_a, ticker_b = pairs[0]
        panel = loader.fetch([ticker_a, ticker_b], start=args.start, end=args.end)
        grid = grid_search(
            panel,
            ticker_a, ticker_b,
            config=config,
            zscore_lookbacks=_parse_ints(args.grid_lookbacks),
            entry_zs=_parse_floats(args.grid_entries),
            exit_zs=_parse_floats(args.grid_exits),
            rolling_beta=args.rolling_beta,
            beta_lookback=args.beta_lookback,
        )
        if grid.empty:
            print("Grid search produced no rows.")
            return 1
        out_csv = args.output / f"grid_{ticker_a}_{ticker_b}.csv"
        grid.to_csv(out_csv, index=False)
        print(f"\nTop 10 parameter sets for {ticker_a}/{ticker_b} (by Sharpe):\n")
        with pd.option_context("display.max_columns", None, "display.width", 160,
                               "display.float_format", lambda v: f"{v:.4f}"):
            print(grid.head(10).to_string(index=False))
        print(f"\nFull grid saved to {out_csv}")
        return 0

    # --- Standard backtest mode ---
    runs = run_many(
        pairs,
        start=args.start,
        end=args.end,
        params=params,
        config=config,
        loader=loader,
        cointegration_significance=None if args.no_cointegration else args.cointegration_alpha,
    )
    if not runs:
        print("All pair backtests failed; see log for details.")
        return 1

    summary_rows = []
    for run in runs:
        artifacts = save_run_artifacts(run, args.output, make_plots=not args.no_plots)
        print_summary(run)
        if not args.no_plots:
            print(f"  Plots: {artifacts.get('diagnostics_plot')}, {artifacts.get('equity_plot')}")
        row = run.summary.as_dict()
        row["ticker_a"] = run.ticker_a
        row["ticker_b"] = run.ticker_b
        if run.cointegration is not None:
            row["cointegration_p"] = run.cointegration.p_value
            row["is_cointegrated"] = run.cointegration.is_cointegrated
        summary_rows.append(row)

    summary_df = pd.DataFrame(summary_rows)
    summary_csv = args.output / "summary.csv"
    summary_df.to_csv(summary_csv, index=False)
    print(f"\nCombined summary written to {summary_csv}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
