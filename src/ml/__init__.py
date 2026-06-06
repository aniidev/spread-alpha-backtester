"""Machine-learning entry/exit signal generation for the spread alpha backtester."""
from .signal_model import (
    FEATURE_COLUMNS,
    MLModelResult,
    assert_causal_features,
    assert_target_strictly_forward,
    build_features,
    build_target,
    feature_ablation,
    probability_calibration,
    train_signal_model,
)
from .ml_backtest import (
    DEFAULT_THRESHOLD_GRID,
    MLBacktestRun,
    run_ml_backtest,
    signal_from_thresholds,
    threshold_sweep,
)

__all__ = [
    "FEATURE_COLUMNS",
    "MLModelResult",
    "MLBacktestRun",
    "DEFAULT_THRESHOLD_GRID",
    "build_features",
    "build_target",
    "train_signal_model",
    "probability_calibration",
    "feature_ablation",
    "assert_causal_features",
    "assert_target_strictly_forward",
    "run_ml_backtest",
    "signal_from_thresholds",
    "threshold_sweep",
]
