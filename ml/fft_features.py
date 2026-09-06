"""Feature extraction for short telemetry windows.

The extractor intentionally works on the telemetry contract rather than on a
specific sensor library.  It returns a stable, named feature mapping so the
same code can be used for baseline training and verification.

The current WebSocket contract is approximately 10 Hz.  That is enough for
low-frequency trend features, but not for high-frequency vibration analysis.
For a meaningful FFT, the firmware should eventually sample the IMU faster
locally and either send window summaries or increase the telemetry rate.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np


class InsufficientTelemetryError(ValueError):
    """Raised when a window cannot produce the required sensor features."""


FEATURE_NAMES: tuple[str, ...] = (
    "packet_count",
    "imu_valid_fraction",
    "scan_valid_fraction",
    "ir_valid_fraction",
    "temp_valid_fraction",
    "accel_mag_mean",
    "accel_mag_std",
    "accel_mag_rms",
    "accel_mag_peak_to_peak",
    "accel_dominant_freq_hz",
    "accel_spectral_energy",
    "gyro_mag_mean",
    "gyro_mag_std",
    "motor_speed_mean",
    "motor_imbalance_mean",
    "scan_distance_mean",
    "scan_distance_std",
    "ir_mean",
    "temp_mean",
)


def feature_names() -> tuple[str, ...]:
    """Return the ordered feature names used by the model."""

    return FEATURE_NAMES


def _finite(values: Sequence[float]) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    return array[np.isfinite(array)]


def _stats(values: Sequence[float]) -> tuple[float, float, float, float]:
    finite = _finite(values)
    if finite.size == 0:
        return math.nan, math.nan, math.nan, math.nan
    return (
        float(np.mean(finite)),
        float(np.std(finite)),
        float(np.sqrt(np.mean(np.square(finite)))),
        float(np.ptp(finite)),
    )


def _magnitude(rows: Sequence[Sequence[float]]) -> np.ndarray:
    if not rows:
        return np.asarray([], dtype=float)
    values = np.asarray(rows, dtype=float)
    return np.linalg.norm(values, axis=1)


def _fft_summary(values: Sequence[float], sample_rate_hz: float) -> tuple[float, float]:
    finite = _finite(values)
    if finite.size < 3 or sample_rate_hz <= 0:
        return math.nan, math.nan

    centered = finite - np.mean(finite)
    frequencies = np.fft.rfftfreq(centered.size, d=1.0 / sample_rate_hz)
    power = np.abs(np.fft.rfft(centered)) ** 2
    if power.size <= 1:
        return math.nan, math.nan

    non_zero = np.arange(1, power.size)
    dominant_index = non_zero[int(np.argmax(power[1:]))]
    return float(frequencies[dominant_index]), float(np.sum(power[1:]))


def _number(packet: Mapping[str, Any], *path: str) -> float | None:
    value: Any = packet
    for key in path:
        if not isinstance(value, Mapping):
            return None
        value = value.get(key)
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def extract_window_features(
    packets: Sequence[Mapping[str, Any]],
    *,
    sample_rate_hz: float = 10.0,
    require_imu: bool = True,
) -> dict[str, float]:
    """Extract stable numeric features from one telemetry window.

    Missing optional fields are represented as ``NaN``.  The model's
    imputer handles those values using statistics learned from the baseline;
    they are not silently replaced with fake sensor readings.
    """

    if not packets:
        raise InsufficientTelemetryError("cannot extract features from an empty window")

    accel_rows: list[Sequence[float]] = []
    gyro_rows: list[Sequence[float]] = []
    scan_values: list[float] = []
    ir_values: list[float] = []
    temp_values: list[float] = []
    motor_speed_values: list[float] = []
    motor_imbalance_values: list[float] = []

    for packet in packets:
        imu = packet.get("imu") if isinstance(packet, Mapping) else None
        if isinstance(imu, Mapping):
            accel = imu.get("accel")
            gyro = imu.get("gyro")
            if isinstance(accel, Sequence) and len(accel) == 3:
                try:
                    values = [float(value) for value in accel]
                    if all(math.isfinite(value) for value in values):
                        accel_rows.append(values)
                except (TypeError, ValueError):
                    pass
            if isinstance(gyro, Sequence) and len(gyro) == 3:
                try:
                    values = [float(value) for value in gyro]
                    if all(math.isfinite(value) for value in values):
                        gyro_rows.append(values)
                except (TypeError, ValueError):
                    pass

        scan_distance = _number(packet, "scan", "distance_cm")
        if scan_distance is not None:
            scan_values.append(scan_distance)
        ir_value = _number(packet, "ir")
        if ir_value is not None:
            ir_values.append(ir_value)
        temp_value = _number(packet, "temp_c")
        if temp_value is not None:
            temp_values.append(temp_value)

        left_speed = _number(packet, "motor", "left_speed")
        right_speed = _number(packet, "motor", "right_speed")
        if left_speed is not None and right_speed is not None:
            motor_speed_values.append((abs(left_speed) + abs(right_speed)) / 2.0)
            motor_imbalance_values.append(abs(left_speed - right_speed))

    if require_imu and not accel_rows:
        raise InsufficientTelemetryError("window contains no valid IMU acceleration samples")

    accel_magnitude = _magnitude(accel_rows)
    gyro_magnitude = _magnitude(gyro_rows)
    accel_mean, accel_std, accel_rms, accel_ptp = _stats(accel_magnitude)
    gyro_mean, gyro_std, _, _ = _stats(gyro_magnitude)
    dominant_frequency, spectral_energy = _fft_summary(accel_magnitude, sample_rate_hz)

    packet_count = len(packets)
    features = {
        "packet_count": float(packet_count),
        "imu_valid_fraction": float(len(accel_rows) / packet_count),
        "scan_valid_fraction": float(len(scan_values) / packet_count),
        "ir_valid_fraction": float(len(ir_values) / packet_count),
        "temp_valid_fraction": float(len(temp_values) / packet_count),
        "accel_mag_mean": accel_mean,
        "accel_mag_std": accel_std,
        "accel_mag_rms": accel_rms,
        "accel_mag_peak_to_peak": accel_ptp,
        "accel_dominant_freq_hz": dominant_frequency,
        "accel_spectral_energy": spectral_energy,
        "gyro_mag_mean": gyro_mean,
        "gyro_mag_std": gyro_std,
        "motor_speed_mean": float(np.mean(motor_speed_values)) if motor_speed_values else math.nan,
        "motor_imbalance_mean": float(np.mean(motor_imbalance_values)) if motor_imbalance_values else math.nan,
        "scan_distance_mean": float(np.mean(scan_values)) if scan_values else math.nan,
        "scan_distance_std": float(np.std(scan_values)) if scan_values else math.nan,
        "ir_mean": float(np.mean(ir_values)) if ir_values else math.nan,
        "temp_mean": float(np.mean(temp_values)) if temp_values else math.nan,
    }
    return {name: float(features[name]) for name in FEATURE_NAMES}
