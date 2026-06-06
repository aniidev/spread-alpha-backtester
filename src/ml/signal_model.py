"""ML entry/exit signal model for spread mean-reversion.

Given the existing z-score / spread series we engineer a handful of
look-back-only features and train a sklearn classifier to predict whether
the spread will revert to |z| < exit_z within the next N bars. The probability
is then thresholded (long if p > 0.6, short if p < 0.4) and shifted by one
bar to match the same lookahead guarantees the rule-based engine enforces.

Leakage audit (kept here so future edits don't drift):
    * Every feature at bar t uses only data ≤ t (rolling/lag, no global fit).
      - half_life is computed by `_rolling_half_life` over a *trailing*
        window, NOT over the full series or test window.
      - `assert_causal_features` re-derives features on truncated prefixes
        and fails if any feature row changes when future bars are removed.
    * Target at bar t covers the *strictly forward* window [t+1 .. t+n_bars]
      built with `FixedForwardWindowIndexer`; the last `n_bars` rows are
      NaN'd. The current bar t is NOT in the label window, so the feature
      window (≤ t) and the label window (> t) never overlap.
      - `assert_target_strictly_forward` perturbs bar t and fails if the
        label moves — the regression test for the original leak, where a
        backward `.rolling()` after `.shift(-1)` pulled crosses[t] into the
        label and made it trivially predictable from zscore[t].
    * Train/test split is strictly time-ordered (no shuffle).
    * The last `n_bars` rows of the training set are PURGED so no training
      label is supervised by a bar that falls inside the test window.
    * Scaling lives inside a Pipeline that is fit on X_train only and
      reused (transform-only) on X_test — verified against X_train stats.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import pandas as pd
from pandas.api.indexers import FixedForwardWindowIndexer
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ModelType = Literal["lr", "gbm", "rf"]

FEATURE_COLUMNS: list[str] = [
    "zscore",
    "zscore_lag1",
    "zscore_lag5",
    "spread_momentum_5",
    "spread_momentum_10",
    "half_life",
    "rolling_vol_ratio",
    "spread_rsi_14",
]


# ── Feature engineering ───────────────────────────────────────────

def _rolling_half_life(spread: pd.Series, window: int = 60) -> pd.Series:
    """Rolling Ornstein-Uhlenbeck half-life estimate over a trailing window.

    AR(1) on the difference: ΔS_t = α + β·S_{t-1} + ε. Half-life = -ln 2 / ln(1+β).
    Returns NaN where β >= 0 (no mean reversion) or window not full.
    """
    s = spread.astype(float)
    lagged = s.shift(1)
    delta = s.diff()

    lag_mean = lagged.rolling(window).mean()
    delta_mean = delta.rolling(window).mean()
    cov = (lagged * delta).rolling(window).mean() - lag_mean * delta_mean
    var = lagged.rolling(window).var(ddof=0)

    beta = cov / var.replace(0.0, np.nan)
    # Only mean-reverting regimes give a finite half-life
    valid = (beta < 0) & ((1.0 + beta) > 0)
    hl = pd.Series(np.nan, index=spread.index, dtype=float)
    hl.loc[valid] = -np.log(2.0) / np.log(1.0 + beta.loc[valid])
    # Clip absurd values from numerical fragility
    hl = hl.clip(lower=0.0, upper=1000.0)
    return hl.rename("half_life")


def _spread_rsi(spread: pd.Series, period: int = 14) -> pd.Series:
    """Wilder-style RSI of spread differences over a rolling period."""
    diff = spread.diff()
    gain = diff.clip(lower=0.0)
    loss = -diff.clip(upper=0.0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return rsi.rename("spread_rsi_14")


def build_features(
    zscore: pd.Series,
    spread: pd.Series,
    *,
    half_life_window: int = 60,
    vol_short: int = 10,
    vol_long: int = 60,
) -> pd.DataFrame:
    """Engineer features from z-score and spread series.

    Every feature is computed using past bars only — the rule-based engine
    shifts position by one bar before trading, and ml_backtest does the same.
    """
    if not zscore.index.equals(spread.index):
        raise ValueError("zscore and spread must share the same index")

    momentum_5 = spread.diff(5)
    momentum_10 = spread.diff(10)
    vol_s = spread.diff().rolling(vol_short).std(ddof=0)
    vol_l = spread.diff().rolling(vol_long).std(ddof=0)
    vol_ratio = vol_s / vol_l.replace(0.0, np.nan)

    features = pd.DataFrame(
        {
            "zscore": zscore,
            "zscore_lag1": zscore.shift(1),
            "zscore_lag5": zscore.shift(5),
            "spread_momentum_5": momentum_5,
            "spread_momentum_10": momentum_10,
            "half_life": _rolling_half_life(spread, window=half_life_window),
            "rolling_vol_ratio": vol_ratio,
            "spread_rsi_14": _spread_rsi(spread, period=14),
        },
        index=zscore.index,
    )
    return features[FEATURE_COLUMNS]


def build_target(
    zscore: pd.Series, *, exit_z: float = 0.5, n_bars: int = 5
) -> pd.Series:
    """Binary target: does |z| cross below exit_z within the next n_bars?

    The label at bar t is 1 iff ``|z|`` dips below ``exit_z`` on at least one
    of the *strictly forward* bars ``t+1 .. t+n_bars``. The current bar t is
    deliberately excluded — if it were included, the label would be a direct
    function of ``zscore[t]`` (a feature), which is exactly the lookahead leak
    that previously inflated test AUC to ~0.95 and produced 0/1 probabilities.

    Last n_bars rows are NaN because their forward window extends past the
    sample and their outcome is censored.
    """
    if exit_z < 0:
        raise ValueError("exit_z must be non-negative")
    if n_bars < 1:
        raise ValueError("n_bars must be >= 1")

    indicator = (zscore.abs() < exit_z).astype(float)

    # FixedForwardWindowIndexer makes `.rolling` look FORWARD instead of back.
    # Applied to indicator.shift(-1), row t aggregates indicator[t+1 .. t+n_bars]
    # — a window that starts one bar after t and never touches the current bar.
    indexer = FixedForwardWindowIndexer(window_size=n_bars)
    fwd = indicator.shift(-1).rolling(window=indexer, min_periods=1).max()

    # Tail rows whose horizon extends past the sample have no known outcome.
    fwd.iloc[-n_bars:] = np.nan
    return fwd.rename("target")


# ── Leakage diagnostics ───────────────────────────────────────────

def probability_calibration(
    y_true: np.ndarray, y_proba: np.ndarray, *, n_bins: int = 10
) -> dict:
    """Bin predicted probabilities and measure reliability.

    Returns per-bin counts plus the reliability curve (mean predicted
    probability vs the empirical fraction of positives in that bin). An
    honest, well-calibrated model spreads probability mass across the bins
    and tracks the diagonal; a *leaking*, over-confident model piles mass
    into the 0.0 and 1.0 bins and the histogram looks U-shaped.
    """
    yt = np.asarray(y_true, dtype=float)
    yp = np.asarray(y_proba, dtype=float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    # digitize on the interior edges so p in [edges[b], edges[b+1]) -> bin b,
    # and p == 1.0 lands in the final bin.
    idx = np.clip(np.digitize(yp, edges[1:-1], right=False), 0, n_bins - 1)

    bins: list[dict] = []
    for b in range(n_bins):
        mask = idx == b
        count = int(mask.sum())
        bins.append({
            "bin_lower": float(edges[b]),
            "bin_upper": float(edges[b + 1]),
            "bin_mid": float((edges[b] + edges[b + 1]) / 2.0),
            "count": count,
            "mean_predicted": float(yp[mask].mean()) if count else None,
            "fraction_positive": float(yt[mask].mean()) if count else None,
        })

    # A scalar overconfidence summary: share of predictions in the extreme bins.
    n = len(yp)
    extreme = int((idx == 0).sum() + (idx == n_bins - 1).sum())
    return {
        "n_bins": n_bins,
        "n_samples": int(n),
        "extreme_bin_fraction": float(extreme / n) if n else None,
        "bins": bins,
    }


def _label_eq(a: float, b: float) -> bool:
    """Equality that treats NaN == NaN as True (censored rows match)."""
    if (a != a) and (b != b):  # both NaN
        return True
    return a == b


def assert_causal_features(
    zscore: pd.Series, spread: pd.Series, *, n_probe: int = 8, atol: float = 1e-8
) -> None:
    """Assert every feature at bar t depends only on bars ≤ t.

    Re-derives the full feature matrix on truncated prefixes ``[0 .. t]`` for
    a handful of probe rows and checks the last prefix row matches the
    full-series computation. If a feature peeked at future bars, truncating
    the series would change its value and this raises ``AssertionError``.
    """
    full = build_features(zscore, spread)
    finite_pos = np.where(full.notna().all(axis=1).to_numpy())[0]
    # Keep probes past the warm-up region so rolling windows are full.
    finite_pos = finite_pos[finite_pos >= 60]
    if len(finite_pos) == 0:
        return
    probes = np.unique(
        finite_pos[np.linspace(0, len(finite_pos) - 1,
                               min(n_probe, len(finite_pos))).astype(int)]
    )
    for t in probes:
        prefix = build_features(zscore.iloc[: t + 1], spread.iloc[: t + 1])
        a = full.iloc[t].to_numpy(dtype=float)
        b = prefix.iloc[-1].to_numpy(dtype=float)
        if not np.allclose(np.nan_to_num(a), np.nan_to_num(b), atol=atol, equal_nan=True):
            bad = [
                FEATURE_COLUMNS[i]
                for i in range(len(a))
                if not np.isclose(np.nan_to_num(a[i]), np.nan_to_num(b[i]), atol=atol)
            ]
            raise AssertionError(
                f"Feature leakage at row {t}: {bad} change when future bars are "
                f"removed (full={a}, prefix={b})."
            )


def assert_target_strictly_forward(
    zscore: pd.Series, *, exit_z: float = 0.5, n_bars: int = 5, n_probe: int = 12
) -> None:
    """Assert the label window is strictly forward of the feature window.

    For probe rows, perturbs ONLY the current bar t (pushes ``|z|`` far above
    ``exit_z``) and asserts ``target[t]`` is unchanged. If the label moves, the
    current bar is inside the label window and feature/label windows overlap —
    the exact bug this module was fixed for.
    """
    base = build_target(zscore, exit_z=exit_z, n_bars=n_bars)
    finite_pos = np.where(base.notna().to_numpy())[0]
    finite_pos = finite_pos[(finite_pos > n_bars) & (finite_pos < len(zscore) - n_bars - 1)]
    if len(finite_pos) == 0:
        return
    probes = np.unique(
        finite_pos[np.linspace(0, len(finite_pos) - 1,
                               min(n_probe, len(finite_pos))).astype(int)]
    )
    for t in probes:
        z2 = zscore.copy()
        z2.iloc[t] = zscore.iloc[t] + 1000.0  # force crosses[t] = 0
        moved = build_target(z2, exit_z=exit_z, n_bars=n_bars)
        if not _label_eq(float(base.iloc[t]), float(moved.iloc[t])):
            raise AssertionError(
                f"Target leakage: label[{t}] changed ({base.iloc[t]} -> "
                f"{moved.iloc[t]}) when only bar t was perturbed — the label "
                f"window overlaps the current (feature) bar."
            )


# ── Model training ────────────────────────────────────────────────

_MODEL_LABELS = {
    "lr": "Logistic Regression",
    "gbm": "Gradient Boosting",
    "rf": "Random Forest",
}


def _build_estimator(model_type: ModelType, random_state: int = 42) -> Pipeline:
    if model_type == "lr":
        clf = LogisticRegression(max_iter=500, C=1.0, random_state=random_state)
    elif model_type == "gbm":
        clf = GradientBoostingClassifier(
            n_estimators=150, max_depth=3, learning_rate=0.05, random_state=random_state
        )
    elif model_type == "rf":
        clf = RandomForestClassifier(
            n_estimators=200, max_depth=6, min_samples_leaf=20,
            n_jobs=-1, random_state=random_state,
        )
    else:
        raise ValueError(f"Unknown model_type {model_type!r}; expected lr|gbm|rf")
    return Pipeline([("scaler", StandardScaler()), ("clf", clf)])


def _feature_importance(pipeline: Pipeline, feature_names: list[str]) -> dict[str, float]:
    clf = pipeline.named_steps["clf"]
    if hasattr(clf, "feature_importances_"):
        weights = np.asarray(clf.feature_importances_, dtype=float)
    elif hasattr(clf, "coef_"):
        weights = np.abs(np.asarray(clf.coef_, dtype=float)).ravel()
    else:
        weights = np.zeros(len(feature_names))
    total = weights.sum()
    if total > 0:
        weights = weights / total
    return {name: float(w) for name, w in zip(feature_names, weights)}


@dataclass
class MLModelResult:
    """Outputs of a single ML training run."""

    model_type: ModelType
    model_label: str
    pipeline: Pipeline
    features: pd.DataFrame
    target: pd.Series
    train_index: pd.Index
    test_index: pd.Index
    prob_full: pd.Series          # probability of reversion at every bar
    signal_full: pd.Series        # {-1, 0, +1} signal at every bar
    metrics: dict[str, float] = field(default_factory=dict)
    feature_importance: dict[str, float] = field(default_factory=dict)
    roc_curve: dict[str, list[float]] = field(default_factory=dict)
    calibration: dict = field(default_factory=dict)


def train_signal_model(
    zscore: pd.Series,
    spread: pd.Series,
    *,
    model_type: ModelType = "gbm",
    exit_z_target: float = 0.5,
    n_bars_target: int = 5,
    train_fraction: float = 0.7,
    long_threshold: float = 0.6,
    short_threshold: float = 0.4,
    random_state: int = 42,
    feature_subset: list[str] | None = None,
    run_assertions: bool = True,
) -> MLModelResult:
    """Train a classifier and emit ML-based entry/exit signals.

    Splits the labelled rows in time order (no shuffling), trains on the
    first `train_fraction`, predicts on the whole series, then derives a
    {-1, 0, +1} signal via the long/short probability thresholds.

    `feature_subset` restricts the model to a subset of FEATURE_COLUMNS
    (used by `feature_ablation`). `run_assertions` toggles the causal/target
    leakage checks — leave on for the production path, off for tight loops.
    """
    if not (0 < train_fraction < 1):
        raise ValueError("train_fraction must lie in (0, 1)")
    if not (0 < short_threshold < long_threshold < 1):
        raise ValueError("require 0 < short_threshold < long_threshold < 1")

    feature_cols = list(feature_subset) if feature_subset else list(FEATURE_COLUMNS)
    unknown = [c for c in feature_cols if c not in FEATURE_COLUMNS]
    if unknown:
        raise ValueError(f"Unknown feature(s) in feature_subset: {unknown}")

    # Hard leakage assertions — every feature ≤ t, target strictly forward.
    if run_assertions:
        assert_causal_features(zscore, spread)
        assert_target_strictly_forward(zscore, exit_z=exit_z_target, n_bars=n_bars_target)

    features = build_features(zscore, spread)[feature_cols]
    target = build_target(zscore, exit_z=exit_z_target, n_bars=n_bars_target)

    # Rows where every feature and the target are finite — the labelled set.
    labelled = pd.concat([features, target], axis=1).dropna()
    if len(labelled) < 100:
        raise ValueError(
            f"Need at least 100 labelled bars to train; got {len(labelled)}"
        )

    n_train = int(len(labelled) * train_fraction)
    train = labelled.iloc[:n_train]
    test = labelled.iloc[n_train:]

    # ── Purge ────────────────────────────────────────────────
    # Training rows whose forward target window [t+1 .. t+n_bars] falls
    # inside the test set would let train labels peek at test-period bars.
    # Drop the last `n_bars_target` rows of the training set to eliminate
    # that boundary leakage (López de Prado purging).
    purge = min(n_bars_target, max(len(train) - 50, 0))
    if purge > 0:
        train = train.iloc[:-purge]

    X_train = train[feature_cols].to_numpy(dtype=float)
    y_train = train["target"].to_numpy(dtype=int)
    X_test = test[feature_cols].to_numpy(dtype=float)
    y_test = test["target"].to_numpy(dtype=int)

    pipeline = _build_estimator(model_type, random_state=random_state)
    # Guard against degenerate single-class training sets.
    if len(np.unique(y_train)) < 2:
        raise ValueError(
            "Training set contains a single class — try a wider window, "
            "higher exit_z_target, or more bars."
        )
    pipeline.fit(X_train, y_train)

    # Assert the scaler learned ONLY training statistics — no test row ever
    # touched fit(). If test data leaked in, scaler.mean_ would not match.
    scaler = pipeline.named_steps["scaler"]
    if not np.allclose(scaler.mean_, X_train.mean(axis=0), atol=1e-8):
        raise AssertionError(
            "Scaler statistics do not match X_train — test data leaked into fit()."
        )

    # Test-set metrics
    y_proba_test = pipeline.predict_proba(X_test)[:, 1]
    y_pred_test = (y_proba_test >= 0.5).astype(int)
    try:
        auc = float(roc_auc_score(y_test, y_proba_test))
    except ValueError:
        auc = float("nan")
    try:
        fpr, tpr, _thr = roc_curve(y_test, y_proba_test)
        roc = {"fpr": [float(x) for x in fpr], "tpr": [float(x) for x in tpr]}
    except ValueError:
        roc = {"fpr": [], "tpr": []}

    metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred_test)),
        "precision": float(precision_score(y_test, y_pred_test, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred_test, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred_test, zero_division=0)),
        "auc_roc": auc,
        "n_train": int(len(train)),
        "n_test": int(len(test)),
        "n_purged": int(purge),
        "train_positive_rate": float(y_train.mean()) if len(y_train) else float("nan"),
        "test_positive_rate": float(y_test.mean()) if len(y_test) else float("nan"),
    }

    # Calibration / reliability on the held-out test set.
    calibration = probability_calibration(y_test, y_proba_test, n_bins=10)

    # Predict probability on every bar where features are finite.
    finite_features = features.dropna()
    prob_full = pd.Series(np.nan, index=features.index, dtype=float, name="ml_prob")
    if not finite_features.empty:
        proba = pipeline.predict_proba(
            finite_features.to_numpy(dtype=float)
        )[:, 1]
        prob_full.loc[finite_features.index] = proba

    # Translate probability into a state-machine-friendly signal.
    #   p > long_threshold  → expect reversion → fade by going long the spread when z<0
    #                         and short the spread when z>0.
    #   p < short_threshold → expect continuation → flat (avoid the trade).
    signal = pd.Series(0, index=features.index, dtype=np.int8, name="ml_position")
    long_mask = prob_full > long_threshold
    signal.loc[long_mask & (zscore < 0)] = 1
    signal.loc[long_mask & (zscore > 0)] = -1
    # short_threshold is informational here; values between thresholds also stay flat.

    feature_importance = _feature_importance(pipeline, feature_cols)

    return MLModelResult(
        model_type=model_type,
        model_label=_MODEL_LABELS[model_type],
        pipeline=pipeline,
        features=features,
        target=target,
        train_index=train.index,
        test_index=test.index,
        prob_full=prob_full,
        signal_full=signal,
        metrics=metrics,
        feature_importance=feature_importance,
        roc_curve=roc,
        calibration=calibration,
    )


# ── Feature ablation ──────────────────────────────────────────────

def feature_ablation(
    zscore: pd.Series,
    spread: pd.Series,
    *,
    model_type: ModelType = "gbm",
    exit_z_target: float = 0.5,
    n_bars_target: int = 5,
    train_fraction: float = 0.7,
    random_state: int = 42,
) -> list[dict]:
    """Drop each feature in turn, retrain, and record test AUC.

    A feature whose removal collapses AUC toward chance (~0.5) is the one
    carrying lookahead. With the leak-free target no single feature should
    dominate: dropping any one only nudges AUC. Returned rows are sorted so
    the most damaging drop (largest AUC loss) is reported first.
    """
    full = train_signal_model(
        zscore, spread, model_type=model_type, exit_z_target=exit_z_target,
        n_bars_target=n_bars_target, train_fraction=train_fraction,
        random_state=random_state, run_assertions=True,
    )
    full_auc = full.metrics["auc_roc"]

    rows: list[dict] = [{
        "dropped": None,
        "n_features": len(FEATURE_COLUMNS),
        "auc_roc": full_auc,
        "delta_vs_full": 0.0,
    }]
    for feat in FEATURE_COLUMNS:
        subset = [c for c in FEATURE_COLUMNS if c != feat]
        try:
            r = train_signal_model(
                zscore, spread, model_type=model_type, exit_z_target=exit_z_target,
                n_bars_target=n_bars_target, train_fraction=train_fraction,
                random_state=random_state, feature_subset=subset,
                run_assertions=False,  # full model already verified above
            )
            auc = r.metrics["auc_roc"]
        except ValueError:
            auc = float("nan")
        rows.append({
            "dropped": feat,
            "n_features": len(subset),
            "auc_roc": auc,
            "delta_vs_full": (auc - full_auc) if not np.isnan(auc) else float("nan"),
        })

    rows[1:] = sorted(
        rows[1:],
        key=lambda r: (r["delta_vs_full"] if r["delta_vs_full"] == r["delta_vs_full"] else 0.0),
    )
    return rows
