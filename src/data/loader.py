"""Historical price data loading and alignment.

Fetches adjusted daily close prices from Yahoo Finance, caches them on disk
to avoid repeated downloads, and provides utilities for aligning two price
series for pairs trading.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PricePanel:
    """Aligned panel of adjusted close prices.

    Attributes:
        prices: DataFrame indexed by date, one column per ticker.
        start: First date in the panel.
        end: Last date in the panel.
    """

    prices: pd.DataFrame

    @property
    def start(self) -> pd.Timestamp:
        return self.prices.index[0]

    @property
    def end(self) -> pd.Timestamp:
        return self.prices.index[-1]

    @property
    def tickers(self) -> list[str]:
        return list(self.prices.columns)

    def __len__(self) -> int:
        return len(self.prices)


class PriceLoader:
    """Loads historical adjusted-close prices with optional disk caching.

    Caching avoids re-downloading the same series across runs and is keyed by
    (ticker, start, end). The cache lives under `cache_dir` as parquet files.
    """

    def __init__(self, cache_dir: str | Path | None = "results/cache") -> None:
        self.cache_dir = Path(cache_dir) if cache_dir is not None else None
        if self.cache_dir is not None:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, ticker: str, start: str, end: str) -> Path | None:
        if self.cache_dir is None:
            return None
        safe = ticker.replace("/", "_").replace("\\", "_")
        return self.cache_dir / f"{safe}__{start}__{end}.csv"

    def fetch(
        self,
        tickers: Iterable[str],
        start: str,
        end: str,
        *,
        use_cache: bool = True,
    ) -> PricePanel:
        """Fetch adjusted close prices for one or more tickers.

        Args:
            tickers: Iterable of ticker symbols (e.g. ["KO", "PEP"]).
            start: Inclusive start date, ISO format YYYY-MM-DD.
            end: Exclusive end date, ISO format YYYY-MM-DD.
            use_cache: If True, read/write parquet cache under `cache_dir`.

        Returns:
            PricePanel with one column per ticker, inner-joined on date.
        """
        tickers = list(tickers)
        series: dict[str, pd.Series] = {}

        for ticker in tickers:
            cache_path = self._cache_path(ticker, start, end)
            if use_cache and cache_path is not None and cache_path.exists():
                logger.info("Loading %s from cache", ticker)
                series[ticker] = pd.read_csv(cache_path, index_col=0, parse_dates=True)["close"]
                continue

            logger.info("Downloading %s from Yahoo Finance (%s → %s)", ticker, start, end)
            df = yf.download(
                ticker,
                start=start,
                end=end,
                auto_adjust=True,
                progress=False,
                multi_level_index=False,
            )
            if df.empty:
                raise ValueError(f"No data returned for ticker {ticker!r} in [{start}, {end})")
            close = df["Close"].rename("close").astype(float)
            series[ticker] = close
            if use_cache and cache_path is not None:
                close.to_frame().to_csv(cache_path)

        # Inner join on date — only keep dates where every ticker has a price.
        panel = pd.concat(series, axis=1).dropna(how="any")
        panel.index = pd.DatetimeIndex(panel.index).tz_localize(None)
        panel.columns = [str(c) for c in panel.columns]

        if panel.empty:
            raise ValueError(
                f"After aligning {tickers!r}, no overlapping dates remain in [{start}, {end})"
            )

        return PricePanel(prices=panel)


def align_pair(panel: PricePanel, ticker_a: str, ticker_b: str) -> tuple[pd.Series, pd.Series]:
    """Extract two aligned price series from a PricePanel.

    Args:
        panel: PricePanel containing both tickers.
        ticker_a, ticker_b: Symbols to extract.

    Returns:
        Two pd.Series sharing the same DatetimeIndex.
    """
    if ticker_a not in panel.prices.columns:
        raise KeyError(f"{ticker_a!r} not in panel: {panel.tickers}")
    if ticker_b not in panel.prices.columns:
        raise KeyError(f"{ticker_b!r} not in panel: {panel.tickers}")
    pa = panel.prices[ticker_a].rename(ticker_a)
    pb = panel.prices[ticker_b].rename(ticker_b)
    return pa, pb
