"""IMU fingerprints and a transparent structural-change score."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

import numpy as np


@dataclass(frozen=True)
class IMUFingerprint:
    vibration_rms: float
    vibration_variance: float
    accel_rms: float
    tilt_deg: float
    temperature_c: float | None = None
    sample_count: int = 0

    def as_dict(self) -> dict[str, float | int | None]:
        return {
            "vibration_rms": self.vibration_rms,
            "vibration_variance": self.vibration_variance,
            "accel_rms": self.accel_rms,
            "tilt_deg": self.tilt_deg,
            "temperature_c": self.temperature_c,
            "sample_count": self.sample_count,
        }


def _extract_samples(samples: Iterable[Any]) -> tuple[np.ndarray, np.ndarray, list[float]]:
    accel_rows: list[list[float]] = []
    gyro_rows: list[list[float]] = []
    temperatures: list[float] = []
    for sample in samples:
        if isinstance(sample, Mapping):
            imu = sample.get("imu", sample)
            accel = imu.get("accel") if isinstance(imu, Mapping) else None
            gyro = imu.get("gyro") if isinstance(imu, Mapping) else None
            temp = sample.get("temp_c")
        else:
            accel = sample
            gyro = None
            temp = None
        try:
            if isinstance(accel, Sequence) and not isinstance(accel, (str, bytes)) and len(accel) == 3:
                row = [float(value) for value in accel]
                if all(math.isfinite(value) for value in row):
                    accel_rows.append(row)
            if isinstance(gyro, Sequence) and not isinstance(gyro, (str, bytes)) and len(gyro) == 3:
                row = [float(value) for value in gyro]
                if all(math.isfinite(value) for value in row):
                    gyro_rows.append(row)
            if temp is not None and math.isfinite(float(temp)):
                temperatures.append(float(temp))
        except (TypeError, ValueError):
            continue
    if not accel_rows:
        raise ValueError("at least one valid 3-axis acceleration sample is required")
    return np.asarray(accel_rows, dtype=float), np.asarray(gyro_rows, dtype=float), temperatures


def compute_imu_fingerprint(samples: Iterable[Any]) -> IMUFingerprint:
    """Compute stationary vibration, variance, RMS and tilt metrics.

    Tilt is calculated from the mean gravity vector.  ``vibration_rms`` is
    the RMS of magnitude fluctuations around the window mean, while
    ``accel_rms`` preserves the total acceleration RMS for diagnostics.
    """

    accel, _gyro, temperatures = _extract_samples(samples)
    magnitudes = np.linalg.norm(accel, axis=1)
    mean_magnitude = float(np.mean(magnitudes))
    vibration = magnitudes - mean_magnitude
    vibration_rms = float(np.sqrt(np.mean(np.square(vibration))))
    vibration_variance = float(np.var(vibration))
    accel_rms = float(np.sqrt(np.mean(np.square(accel))))
    gravity = np.mean(accel, axis=0)
    tilt_deg = math.degrees(math.atan2(math.hypot(float(gravity[0]), float(gravity[1])), abs(float(gravity[2]))))
    return IMUFingerprint(
        vibration_rms=vibration_rms,
        vibration_variance=vibration_variance,
        accel_rms=accel_rms,
        tilt_deg=float(tilt_deg),
        temperature_c=float(np.mean(temperatures)) if temperatures else None,
        sample_count=int(accel.shape[0]),
    )


def _relative_deviation(value: float | None, baseline: float | None, tolerance: float) -> float:
    if value is None or baseline is None:
        return 0.0
    if tolerance <= 0:
        raise ValueError("tolerance must be positive")
    return float(np.clip(abs(float(value) - float(baseline)) / tolerance * 100.0, 0.0, 100.0))


def fingerprint_deviations(
    baseline: IMUFingerprint,
    current: IMUFingerprint,
    *,
    tilt_tolerance_deg: float = 5.0,
    vibration_tolerance: float = 0.20,
    thermal_tolerance_c: float = 3.0,
) -> dict[str, float]:
    """Compare two checkpoints, returning each component on a 0--100 scale."""

    return {
        "tilt": _relative_deviation(current.tilt_deg, baseline.tilt_deg, tilt_tolerance_deg),
        "vibration": _relative_deviation(current.vibration_rms, baseline.vibration_rms, vibration_tolerance),
        "thermal": _relative_deviation(current.temperature_c, baseline.temperature_c, thermal_tolerance_c),
    }


@dataclass(frozen=True)
class StructuralScore:
    geometry: float
    tilt: float
    vibration: float
    thermal: float
    combined: float
    severity: str

    @property
    def needs_review(self) -> bool:
        return self.severity in {"MODERATE", "HIGH"}

    def as_dict(self) -> dict[str, float | str | bool]:
        return {
            "geometry": self.geometry,
            "tilt": self.tilt,
            "vibration": self.vibration,
            "thermal": self.thermal,
            "combined": self.combined,
            "severity": self.severity,
            "needs_review": self.needs_review,
        }


def structural_change_score(
    *,
    geometry: float,
    tilt: float,
    vibration: float,
    thermal: float,
    weights: tuple[float, float, float, float] = (0.50, 0.20, 0.20, 0.10),
) -> StructuralScore:
    """Fuse normalized components; geometry intentionally has highest weight."""

    if len(weights) != 4 or any(weight < 0 for weight in weights) or sum(weights) <= 0:
        raise ValueError("weights must contain four non-negative values with positive sum")
    total_weight = float(sum(weights))
    components = tuple(float(np.clip(value, 0.0, 100.0)) for value in (geometry, tilt, vibration, thermal))
    combined = float(np.clip(sum(value * weight for value, weight in zip(components, weights)) / total_weight, 0.0, 100.0))
    severity = "LOW" if combined < 33.0 else "MODERATE" if combined < 66.0 else "HIGH"
    return StructuralScore(*components, combined=combined, severity=severity)


def score_checkpoint(
    *,
    geometry_score: float,
    baseline_fingerprint: IMUFingerprint,
    current_fingerprint: IMUFingerprint,
) -> StructuralScore:
    deviations = fingerprint_deviations(baseline_fingerprint, current_fingerprint)
    return structural_change_score(
        geometry=geometry_score,
        tilt=deviations["tilt"],
        vibration=deviations["vibration"],
        thermal=deviations["thermal"],
    )

