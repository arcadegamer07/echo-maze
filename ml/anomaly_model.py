"""Small, reproducible Isolation Forest baseline for Echo-Maze telemetry.

This module deliberately keeps the model boring and inspectable.  A baseline
is learned from feature rows extracted from a healthy ``learn`` run.  A later
``verify`` row receives an anomaly score and a boolean flag.  The score is a
relative ranking (0 is ordinary and 100 is very unusual), not a probability
and not a structural-safety certification.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .fft_features import FEATURE_NAMES


MODEL_VERSION = "echo-maze-isolation-forest-v1"


@dataclass(frozen=True)
class AnomalyResult:
    """Model output for one feature row."""

    is_anomaly: bool
    anomaly_score: float
    raw_decision: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "is_anomaly": self.is_anomaly,
            "anomaly_score": self.anomaly_score,
            "raw_decision": self.raw_decision,
        }


def _matrix(rows: Sequence[Mapping[str, float]]) -> np.ndarray:
    if not rows:
        return np.empty((0, len(FEATURE_NAMES)), dtype=float)
    return np.asarray(
        [[row.get(name, np.nan) for name in FEATURE_NAMES] for row in rows],
        dtype=float,
    )


class BaselineAnomalyModel:
    """Isolation Forest model with stable feature ordering and persistence."""

    def __init__(
        self,
        *,
        contamination: float = 0.05,
        n_estimators: int = 200,
        random_state: int = 42,
        min_samples: int = 8,
    ) -> None:
        if not 0 < contamination < 0.5:
            raise ValueError("contamination must be between 0 and 0.5")
        if n_estimators < 10:
            raise ValueError("n_estimators must be at least 10")
        self.contamination = float(contamination)
        self.n_estimators = int(n_estimators)
        self.random_state = int(random_state)
        self.min_samples = int(min_samples)
        self.feature_names = FEATURE_NAMES
        self.model_version = MODEL_VERSION
        self.pipeline: Pipeline | None = None
        self.training_decision_median: float | None = None
        self.training_decision_floor: float | None = None

    @property
    def is_fitted(self) -> bool:
        return self.pipeline is not None

    def fit(self, rows: Sequence[Mapping[str, float]]) -> "BaselineAnomalyModel":
        """Fit on healthy baseline feature rows."""

        if len(rows) < self.min_samples:
            raise ValueError(
                f"at least {self.min_samples} baseline windows are required; got {len(rows)}"
            )
        matrix = _matrix(rows)

        self.pipeline = Pipeline(
            steps=[
                (
                    "imputer",
                    SimpleImputer(
                        strategy="median",
                        add_indicator=True,
                        keep_empty_features=True,
                    ),
                ),
                ("scaler", StandardScaler()),
                (
                    "isolation_forest",
                    IsolationForest(
                        n_estimators=self.n_estimators,
                        contamination=self.contamination,
                        random_state=self.random_state,
                    ),
                ),
            ]
        )
        self.pipeline.fit(matrix)
        decisions = self.pipeline.decision_function(matrix)
        self.training_decision_median = float(np.median(decisions))
        self.training_decision_floor = float(
            np.quantile(decisions, self.contamination)
        )
        return self

    def _require_fitted(self) -> Pipeline:
        if self.pipeline is None:
            raise RuntimeError("model is not fitted; call fit() or load() first")
        if self.training_decision_median is None or self.training_decision_floor is None:
            raise RuntimeError("model calibration metadata is missing")
        return self.pipeline

    def predict(self, rows: Sequence[Mapping[str, float]]) -> list[AnomalyResult]:
        """Score feature rows in their original order."""

        pipeline = self._require_fitted()
        if not rows:
            return []
        decisions = np.asarray(pipeline.decision_function(_matrix(rows)), dtype=float)
        # Pipeline.decision_function() has already subtracted the forest's
        # offset, so zero is the estimator's anomaly boundary here.  The
        # forest's raw ``offset_`` must not be compared to these shifted
        # values.
        threshold = 0.0
        median = float(self.training_decision_median)
        floor = float(self.training_decision_floor)
        spread = max(median - floor, 1e-6)
        results: list[AnomalyResult] = []
        for decision in decisions:
            score = float(np.clip(50.0 + (median - decision) / spread * 50.0, 0.0, 100.0))
            results.append(
                AnomalyResult(
                    is_anomaly=bool(decision < threshold),
                    anomaly_score=score,
                    raw_decision=float(decision),
                )
            )
        return results

    def predict_one(self, row: Mapping[str, float]) -> AnomalyResult:
        """Score exactly one feature row."""

        return self.predict([row])[0]

    def save(self, path: str | Path) -> Path:
        """Persist the fitted model and its feature compatibility metadata."""

        self._require_fitted()
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, destination)
        return destination

    @classmethod
    def load(cls, path: str | Path) -> "BaselineAnomalyModel":
        """Load a model and reject incompatible future feature layouts."""

        loaded = joblib.load(Path(path))
        if not isinstance(loaded, cls):
            raise TypeError(f"model file does not contain {cls.__name__}")
        if tuple(loaded.feature_names) != FEATURE_NAMES:
            raise ValueError("model feature names do not match this code version")
        loaded._require_fitted()
        return loaded
