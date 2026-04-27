"""Pre-built ticker universes for the pair screener.

Each universe is a curated list of liquid, actively-traded symbols.
Users can always supply a custom list via --tickers on the CLI or the API.
"""
from __future__ import annotations

UNIVERSES: dict[str, list[str]] = {
    # ~60 liquid large-caps spanning all major S&P 500 sectors
    "SP500": [
        # Technology
        "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AMD", "INTC",
        "CRM", "ADBE", "ORCL", "CSCO", "QCOM", "TXN", "AVGO", "IBM",
        # Financials
        "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "AXP", "V", "MA",
        "SCHW", "USB", "PNC", "COF",
        # Energy
        "XOM", "CVX", "COP", "OXY", "SLB", "EOG", "PSX", "VLO",
        # Healthcare
        "JNJ", "PFE", "MRK", "ABBV", "UNH", "CVS", "BMY", "LLY",
        # Consumer Staples / Discretionary
        "KO", "PEP", "MCD", "SBUX", "NKE", "WMT", "TGT", "COST",
        "PG", "CL", "MDLZ",
        # Industrials
        "BA", "CAT", "MMM", "HON", "LMT", "RTX", "GE",
        # Materials / Commodity ETFs
        "GLD", "SLV", "GDX", "USO",
        # International ETFs
        "EWA", "EWC", "EWJ", "EWZ",
    ],

    "TECH": [
        "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AMD", "INTC",
        "CRM", "ADBE", "ORCL", "CSCO", "QCOM", "TXN", "AVGO", "IBM",
        "SNOW", "PLTR", "NET", "ZS", "CRWD", "DDOG", "MDB", "SHOP", "UBER",
    ],

    "ENERGY": [
        "XOM", "CVX", "COP", "OXY", "SLB", "EOG", "PSX", "VLO",
        "MPC", "HAL", "BKR", "DVN", "HES", "FANG", "PXD",
        "GLD", "SLV", "USO", "GDX",
    ],

    "FINANCE": [
        "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "AXP", "V", "MA",
        "SCHW", "USB", "PNC", "TFC", "COF", "BX", "KKR", "APO", "SPGI", "MCO",
    ],

    "CONSUMER": [
        "KO", "PEP", "MCD", "SBUX", "NKE", "HD", "LOW", "WMT", "TGT", "COST",
        "PG", "CL", "UL", "KHC", "GIS", "CAG", "SYY", "MDLZ", "HSY", "MKC",
    ],

    "HEALTHCARE": [
        "JNJ", "PFE", "MRK", "ABBV", "UNH", "CVS", "BMY", "LLY", "AMGN",
        "GILD", "BIIB", "REGN", "VRTX", "ISRG", "MDT", "ABT", "SYK", "BSX",
    ],
}

# Expose universe names for CLI choices and API validation
UNIVERSE_NAMES: list[str] = list(UNIVERSES.keys())


def get_universe(name: str) -> list[str]:
    """Return tickers for a named universe (case-insensitive)."""
    key = name.upper()
    if key not in UNIVERSES:
        raise ValueError(
            f"Unknown universe {name!r}. "
            f"Available: {', '.join(UNIVERSE_NAMES)}"
        )
    return list(UNIVERSES[key])
