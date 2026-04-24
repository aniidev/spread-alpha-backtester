"""Plotting utilities for pairs trading diagnostics and equity curves.

Uses the non-interactive Agg backend so plots can be saved headlessly.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from ..backtester import BacktestResult  # noqa: E402
from ..strategies import PairsParams  # noqa: E402

# Monochrome dark style so plots match the project aesthetic.
_STYLE = {
    "bg": "#121212",
    "panel": "#1A1A1A",
    "ink": "#E0E0E0",
    "muted": "#B0B0B0",
    "accent": "#888888",
    "border": "#444444",
    "long": "#7FB069",
    "short": "#D9534F",
}


def _apply_style(fig: plt.Figure, axes) -> None:
    """Apply the monochrome dark style to a figure and its axes."""
    fig.patch.set_facecolor(_STYLE["bg"])
    for ax in axes if hasattr(axes, "__iter__") else [axes]:
        ax.set_facecolor(_STYLE["panel"])
        for spine in ax.spines.values():
            spine.set_color(_STYLE["border"])
        ax.tick_params(colors=_STYLE["muted"], which="both")
        ax.xaxis.label.set_color(_STYLE["muted"])
        ax.yaxis.label.set_color(_STYLE["muted"])
        ax.title.set_color(_STYLE["ink"])
        ax.grid(True, color=_STYLE["border"], alpha=0.4, linestyle="--", linewidth=0.5)


def plot_pair_diagnostics(
    price_a: pd.Series,
    price_b: pd.Series,
    result: BacktestResult,
    params: PairsParams,
    *,
    output_path: str | Path,
    title: str | None = None,
) -> Path:
    """Three-panel diagnostic figure: prices, spread, z-score with bands.

    Args:
        price_a, price_b: Aligned price series.
        result: Backtest result whose signals are visualized.
        params: PairsParams used to build the signals (for entry/exit bands).
        output_path: Where to save the PNG.
        title: Optional figure suptitle.

    Returns:
        Path to the saved PNG.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fig, axes = plt.subplots(3, 1, figsize=(12, 9), sharex=True)
    ax_price, ax_spread, ax_z = axes

    # ---- Prices (twin axis so the scales don't collapse the smaller series) ----
    ax_price.plot(price_a.index, price_a.values, color=_STYLE["ink"], linewidth=1.2,
                  label=str(price_a.name))
    ax_price.set_ylabel(f"{price_a.name} price ($)", color=_STYLE["ink"])
    ax_b = ax_price.twinx()
    ax_b.plot(price_b.index, price_b.values, color=_STYLE["accent"], linewidth=1.2,
              label=str(price_b.name))
    ax_b.set_ylabel(f"{price_b.name} price ($)", color=_STYLE["accent"])
    ax_b.tick_params(colors=_STYLE["accent"])
    for spine in ax_b.spines.values():
        spine.set_color(_STYLE["border"])
    ax_price.set_title("Price series")

    # ---- Spread with position shading ----
    spread = result.signals.spread
    ax_spread.plot(spread.index, spread.values, color=_STYLE["ink"], linewidth=1.0)
    ax_spread.set_ylabel("Spread")
    ax_spread.set_title("Spread (A − β · B)")
    pos = result.portfolio["position"]
    _shade_positions(ax_spread, pos)

    # ---- Z-score with entry / exit bands ----
    z = result.signals.zscore
    ax_z.plot(z.index, z.values, color=_STYLE["ink"], linewidth=1.0)
    ax_z.axhline(params.entry_z, color=_STYLE["short"], linestyle="--", linewidth=0.8,
                 label=f"+entry ({params.entry_z})")
    ax_z.axhline(-params.entry_z, color=_STYLE["long"], linestyle="--", linewidth=0.8,
                 label=f"−entry ({params.entry_z})")
    ax_z.axhline(params.exit_z, color=_STYLE["muted"], linestyle=":", linewidth=0.8)
    ax_z.axhline(-params.exit_z, color=_STYLE["muted"], linestyle=":", linewidth=0.8)
    ax_z.set_ylabel("Z-score")
    ax_z.set_title("Spread z-score")
    ax_z.legend(loc="upper right", facecolor=_STYLE["panel"], edgecolor=_STYLE["border"],
                labelcolor=_STYLE["muted"])

    ax_z.xaxis.set_major_locator(mdates.AutoDateLocator())
    ax_z.xaxis.set_major_formatter(mdates.ConciseDateFormatter(ax_z.xaxis.get_major_locator()))

    _apply_style(fig, [ax_price, ax_spread, ax_z])
    if title:
        fig.suptitle(title, color=_STYLE["ink"], fontsize=14, y=0.995)
    fig.tight_layout()
    fig.savefig(output_path, dpi=120, facecolor=fig.get_facecolor())
    plt.close(fig)
    return output_path


def plot_equity_curve(
    result: BacktestResult,
    *,
    output_path: str | Path,
    title: str | None = None,
) -> Path:
    """Two-panel figure: equity curve and rolling drawdown."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    equity = result.portfolio["equity"]
    drawdown = equity / equity.cummax() - 1.0

    fig, (ax_eq, ax_dd) = plt.subplots(2, 1, figsize=(12, 7), sharex=True,
                                       gridspec_kw={"height_ratios": [2, 1]})

    ax_eq.plot(equity.index, equity.values, color=_STYLE["ink"], linewidth=1.2)
    ax_eq.axhline(result.config.initial_capital, color=_STYLE["accent"], linestyle="--",
                  linewidth=0.7, label="Initial capital")
    ax_eq.set_ylabel("Equity ($)")
    ax_eq.set_title("Portfolio equity curve")
    ax_eq.legend(loc="upper left", facecolor=_STYLE["panel"], edgecolor=_STYLE["border"],
                 labelcolor=_STYLE["muted"])

    ax_dd.fill_between(drawdown.index, drawdown.values, 0,
                       color=_STYLE["short"], alpha=0.4, linewidth=0)
    ax_dd.plot(drawdown.index, drawdown.values, color=_STYLE["short"], linewidth=0.8)
    ax_dd.set_ylabel("Drawdown")
    ax_dd.set_title("Rolling drawdown")
    ax_dd.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0%}"))

    ax_dd.xaxis.set_major_locator(mdates.AutoDateLocator())
    ax_dd.xaxis.set_major_formatter(mdates.ConciseDateFormatter(ax_dd.xaxis.get_major_locator()))

    _apply_style(fig, [ax_eq, ax_dd])
    if title:
        fig.suptitle(title, color=_STYLE["ink"], fontsize=14, y=0.995)
    fig.tight_layout()
    fig.savefig(output_path, dpi=120, facecolor=fig.get_facecolor())
    plt.close(fig)
    return output_path


def _shade_positions(ax, position: pd.Series) -> None:
    """Shade contiguous regions where position != 0."""
    if position.empty:
        return
    pos = position.to_numpy()
    idx = position.index
    in_pos = False
    start = None
    side = 0
    for i, p in enumerate(pos):
        if p != 0 and not in_pos:
            in_pos = True
            start = i
            side = p
        elif in_pos and (p != side):
            color = _STYLE["long"] if side == 1 else _STYLE["short"]
            ax.axvspan(idx[start], idx[i], color=color, alpha=0.10, linewidth=0)
            if p != 0:
                in_pos = True
                start = i
                side = p
            else:
                in_pos = False
    if in_pos:
        color = _STYLE["long"] if side == 1 else _STYLE["short"]
        ax.axvspan(idx[start], idx[-1], color=color, alpha=0.10, linewidth=0)
