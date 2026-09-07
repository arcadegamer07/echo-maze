"""Stable gyro-free features for Echo-Maze telemetry windows.

The rover's MPU6050 is not available in the current build. Missing IMU data
is kept missing; this extractor uses geometry/range, motor, IR and temperature
evidence instead of pretending that vibration is zero.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Sequence

import numpy as np


class InsufficientTelemetryError(ValueError):
    """Raised when a window cannot produce the required features."""


FEATURE_NAMES: tuple[str, ...] = (
    "packet_count", "imu_valid_fraction", "scan_valid_fraction", "ir_valid_fraction", "temp_valid_fraction",
    "accel_mag_mean", "accel_mag_std", "accel_mag_rms", "accel_mag_peak_to_peak",
    "accel_dominant_freq_hz", "accel_spectral_energy", "gyro_mag_mean", "gyro_mag_std",
    "motor_speed_mean", "motor_imbalance_mean", "motor_motion_fraction",
    "scan_distance_mean", "scan_distance_std", "scan_distance_min", "scan_distance_max",
    "scan_distance_range", "ir_mean", "temp_mean", "temperature_range",
)


def feature_names() -> tuple[str, ...]:
    return FEATURE_NAMES


def _number(packet: Mapping[str, Any], *path: str) -> float | None:
    value: Any = packet
    for key in path:
        if not isinstance(value, Mapping):
            return None
        value = value.get(key)
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def extract_window_features(
    packets: Sequence[Mapping[str, Any]],
    *,
    sample_rate_hz: float = 10.0,
    require_imu: bool = True,
) -> dict[str, float]:
    """Return one NaN-safe feature row for a packet window."""
    if not packets:
        raise InsufficientTelemetryError("cannot extract features from an empty window")
    accel_rows: list[list[float]] = []
    gyro_rows: list[list[float]] = []
    _ = sample_rate_hz

    scan: list[float] = []
    ir: list[float] = []
    temp: list[float] = []
    speeds: list[float] = []
    imbalance: list[float] = []
    moving: list[float] = []
    for packet in packets:
        imu = packet.get("imu") if isinstance(packet, Mapping) else None
        if isinstance(imu, Mapping):
            accel = imu.get("accel")
            gyro = imu.get("gyro")
            if isinstance(accel, Sequence) and len(accel) == 3:
                try:
                    row = [float(value) for value in accel]
                    if all(math.isfinite(value) for value in row):
                        accel_rows.append(row)
                except (TypeError, ValueError):
                    pass
            if isinstance(gyro, Sequence) and len(gyro) == 3:
                try:
                    row = [float(value) for value in gyro]
                    if all(math.isfinite(value) for value in row):
                        gyro_rows.append(row)
                except (TypeError, ValueError):
                    pass
        value = _number(packet, "scan", "distance_cm")
        if value is not None and value >= 0:
            scan.append(value)
        value = _number(packet, "ir")
        if value is not None:
            ir.append(value)
        value = _number(packet, "temp_c")
        if value is not None:
            temp.append(value)
        left = _number(packet, "motor", "left_speed")
        right = _number(packet, "motor", "right_speed")
        if left is not None and right is not None:
            speeds.append((abs(left) + abs(right)) / 2.0)
            imbalance.append(abs(left - right))
            moving.append(float(abs(left) + abs(right) > 0.0))

    if require_imu and not accel_rows:
        raise InsufficientTelemetryError("window contains no valid IMU acceleration samples")
    accel_mag = np.linalg.norm(np.asarray(accel_rows, dtype=float), axis=1) if accel_rows else np.asarray([])
    gyro_mag = np.linalg.norm(np.asarray(gyro_rows, dtype=float), axis=1) if gyro_rows else np.asarray([])
    def stats(values: np.ndarray) -> tuple[float, float, float, float]:
        if not values.size:
            return math.nan, math.nan, math.nan, math.nan
        return float(np.mean(values)), float(np.std(values)), float(np.sqrt(np.mean(values * values))), float(np.ptp(values))
    accel_mean, accel_std, accel_rms, accel_ptp = stats(accel_mag)
    gyro_mean, gyro_std, _, _ = stats(gyro_mag)
    if accel_mag.size >= 3 and sample_rate_hz > 0:
        centered = accel_mag - float(np.mean(accel_mag))
        power = np.abs(np.fft.rfft(centered)) ** 2
        dominant = float(np.argmax(power[1:]) + 1) * float(sample_rate_hz) / accel_mag.size if power.size > 1 else math.nan
        spectral = float(np.sum(power[1:])) if power.size > 1 else math.nan
    else:
        dominant, spectral = math.nan, math.nan

    def mean(values: list[float]) -> float:
        return float(np.mean(values)) if values else math.nan

    def std(values: list[float]) -> float:
        return float(np.std(values)) if values else math.nan

    def minimum(values: list[float]) -> float:
        return float(np.min(values)) if values else math.nan

    def maximum(values: list[float]) -> float:
        return float(np.max(values)) if values else math.nan

    features = {
        "packet_count": float(len(packets)),
        "imu_valid_fraction": len(accel_rows) / len(packets),
        "scan_valid_fraction": len(scan) / len(packets),
        "ir_valid_fraction": len(ir) / len(packets),
        "temp_valid_fraction": len(temp) / len(packets),
        "accel_mag_mean": accel_mean,
        "accel_mag_std": accel_std,
        "accel_mag_rms": accel_rms,
        "accel_mag_peak_to_peak": accel_ptp,
        "accel_dominant_freq_hz": dominant,
        "accel_spectral_energy": spectral,
        "gyro_mag_mean": gyro_mean,
        "gyro_mag_std": gyro_std,
        "motor_speed_mean": mean(speeds),
        "motor_imbalance_mean": mean(imbalance),
        "motor_motion_fraction": mean(moving),
        "scan_distance_mean": mean(scan),
        "scan_distance_std": std(scan),
        "scan_distance_min": minimum(scan),
        "scan_distance_max": maximum(scan),
        "scan_distance_range": (maximum(scan) - minimum(scan)) if scan else math.nan,
        "ir_mean": mean(ir),
        "temp_mean": mean(temp),
        "temperature_range": (maximum(temp) - minimum(temp)) if temp else math.nan,
    }
    return {name: float(features[name]) for name in FEATURE_NAMES}
