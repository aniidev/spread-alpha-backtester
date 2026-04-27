"""CLI for the statistical arbitrage backtester.

Examples
--------

Single pair:
    python main.py --pairs KO,PEP --start 2018-01-01 --end 2024-12-31

Multiple pairs with rolling β:
    python main.py --pairs KO,PEP GLD,SLV XOM,CVX --rolling-beta

Parameter grid search:
    python main.py --pairs KO,PEP --grid \\
        --grid-lookbacks 30,60,90 --grid-entries 1.5,2.0,2.5

Pair screener — named universe:
    python main.py --pair-screener --screen-universe SP500 --top-k 10

Pair screener — custom tickers:
    python main.py --pair-screener --tickers AAPL,MSFT,GOOGL,META,AMZN --top-k 5

Pair screener — then run full backtests on top 3:
    python main.py --pair-screener --screen-universe ENERGY --top-k 10 --run-top 3
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

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
from src.universes import UNIVERSE_NAMES, get_universe


def _parse_pairs(raw: list[str]) -> list[tuple[str, str]]:
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

    # --- universe (required for backtest, optional for screener) ---
    p.add_argument("--pairs", nargs="+", default=None,
                   help="One or more 'TICKER_A,TICKER_B' pairs (e.g. KO,PEP GLD,SLV)")
    p.add_argument("--start", default="2018-01-01", help="Start date (YYYY-MM-DD)")
    p.add_argument("--end",   default="2024-12-31", help="End date (YYYY-MM-DD)")
    p.add_argument("--no-cache", action="store_true", help="Disable on-disk price cache")

    # --- strategy ---
    p.add_argument("--zscore-lookback", type=int,   default=60)
    p.add_argument("--entry-z",         type=float, default=2.0)
    p.add_argument("--exit-z",          type=float, default=0.0)
    p.add_argument("--rolling-beta",    action="store_true")
    p.add_argument("--beta-lookback",   type=int,   default=60)
    p.add_argument("--train-fraction",  type=float, default=0.5)

    # --- backtest ---
    p.add_argument("--capital",  type=float, default=100_000.0)
    p.add_argument("--cost-bps", type=float, default=10.0,
                   help="Transaction cost per leg in basis points")
    p.add_argument("--exposure", type=float, default=None)

    # --- evaluation ---
    p.add_argument("--cointegration-alpha", type=float, default=0.05)
    p.add_argument("--no-cointegration",    action="store_true")
    p.add_argument("--no-plots",            action="store_true")
    p.add_argument("--output", type=Path,   default=Path("results"))
    p.add_argument("--log-level", default="INFO",
                   choices=["DEBUG", "INFO", "WARNING", "ERROR"])

    # --- grid search ---
    p.add_argument("--grid",           action="store_true")
    p.add_argument("--grid-lookbacks", type=str, default="30,60,90")
    p.add_argument("--grid-entries",   type=str, default="1.5,2.0,2.5,3.0")
    p.add_argument("--grid-exits",     type=str, default="0.0,0.5")

    # ── Pair screener ─────────────────────────────────────────
    p.add_argument("--pair-screener", action="store_true",
                   help="Run the pair discovery / ranking engine")
    p.add_argument("--screen-universe", choices=UNIVERSE_NAMES, default=None,
                   help=f"Named ticker universe to screen ({', '.join(UNIVERSE_NAMES)})")
    p.add_argument("--tickers", type=str, default=None,
                   help="Comma-separated custom tickers to screen (e.g. AAPL,MSFT,GOOG)")
    p.add_argument("--top-k", type=int, default=10,
                   help="Number of top pairs to display / save")
    p.add_argument("--min-correlation", type=float, default=0.6,
                   help="Minimum |Pearson correlation| to consider a pair (prefilter)")
    p.add_argument("--max-pairs", type=int, default=300,
                   help="Maximum number of pairs to evaluate after correlation filter")
    p.add_argument("--no-backtest", action="store_true",
                   help="Skip mini-backtest in screener (faster, cointegration only)")
    p.add_argument("--workers", type=int, default=4,
                   help="Parallel worker threads for screener")
    p.add_argument("--run-top", type=int, default=0,
                   help="After screening, run full backtests on the top-N pairs")

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

    args.output.mkdir(parents=True, exist_ok=True)
    loader = PriceLoader(cache_dir=None if args.no_cache else args.output / "cache")

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

    # ── Pair screener mode ────────────────────────────────────
    if args.pair_screener or args.screen_universe:
        from src.pair_screener import format_screener_table, screen_pairs

        if args.screen_universe:
            tickers = get_universe(args.screen_universe)
            universe_label = args.screen_universe
        elif args.tickers:
            tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
            universe_label = "custom"
        else:
            parser.error(
                "--pair-screener requires either --screen-universe or --tickers"
            )

        print(f"\n{'='*60}")
        print(f"  Pair Discovery Engine — {universe_label} ({len(tickers)} tickers)")
        print(f"  Period: {args.start} → {args.end}")
        print(f"  |correlation| ≥ {args.min_correlation}  ·  max pairs: {args.max_pairs}")
        print(f"  Mini-backtest: {'no' if args.no_backtest else 'yes'}  "
              f"·  Workers: {args.workers}")
        print(f"{'='*60}\n")

        ranked = screen_pairs(
            tickers,
            start=args.start,
            end=args.end,
            params=params,
            config=config,
            loader=loader,
            min_correlation=args.min_correlation,
            max_pairs=args.max_pairs,
            run_backtest=not args.no_backtest,
            n_workers=args.workers,
            top_k=args.top_k,
        )

        if ranked.empty:
            print("No candidate pairs found. Try lowering --min-correlation.")
            return 1

        print(f"\nTop {min(args.top_k, len(ranked))} Ranked Pairs\n")
        print(format_screener_table(ranked))

        out_csv = args.output / "pair_screener.csv"
        ranked.to_csv(out_csv, index=False)
        print(f"\nFull results saved to {out_csv}")

        # Optionally run full backtests on top-N
        if args.run_top > 0 and not ranked.empty:
            top_pairs = [
                (row.ticker_a, row.ticker_b)
                for row in ranked.head(args.run_top).itertuples()
            ]
            print(f"\n{'─'*60}")
            print(f"  Running full backtests on top {len(top_pairs)} pairs …")
            print(f"{'─'*60}")
            runs = run_many(
                top_pairs,
                start=args.start,
                end=args.end,
                params=params,
                config=config,
                loader=loader,
                cointegration_significance=None if args.no_cointegration
                                           else args.cointegration_alpha,
            )
            for run in runs:
                save_run_artifacts(run, args.output, make_plots=not args.no_plots)
                print_summary(run)

        return 0

    # ── Standard backtest / grid search ──────────────────────
    if args.pairs is None:
        parser.error("--pairs is required (or use --pair-screener to discover pairs)")

    pairs = _parse_pairs(args.pairs)

    # Grid search
    if args.grid:
        ticker_a, ticker_b = pairs[0]
        panel = loader.fetch([ticker_a, ticker_b], start=args.start, end=args.end)
        grid = grid_search(
            panel, ticker_a, ticker_b,
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

    # Standard backtest
    runs = run_many(
        pairs,
        start=args.start,
        end=args.end,
        params=params,
        config=config,
        loader=loader,
        cointegration_significance=None if args.no_cointegration
                                   else args.cointegration_alpha,
    )
    if not runs:
        print("All pair backtests failed; see log for details.")
        return 1

    summary_rows = []
    for run in runs:
        artifacts = save_run_artifacts(run, args.output, make_plots=not args.no_plots)
        print_summary(run)
        if not args.no_plots:
            print(f"  Plots: {artifacts.get('diagnostics_plot')}, "
                  f"{artifacts.get('equity_plot')}")
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
