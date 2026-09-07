"""Dead-reckoning pose estimation for Echo-Maze.

Coordinates are expressed in centimetres and radians.  The rover starts at
``(0, 0, 0)`` where heading zero points along +X.  Wheel speeds are converted
to distance with ``speed_scale_cm_s``; this is deliberately configurable
because the ESP32 motor values may be PWM units rather than cm/s.

Dead reckoning always drifts.  ``PoseEstimator.confidence`` makes that drift
visible to the dashboard instead of presenting an apparently precise pose.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping


def normalize_angle(angle_rad: float) -> float:
    """Wrap an angle to ``[-pi, pi)``."""

    return (float(angle_rad) + math.pi) % (2.0 * math.pi) - math.pi


def _blend_angle(first: float, second: float, weight: float) -> float:
    """Blend two headings along the shortest circular path."""

    weight = max(0.0, min(1.0, float(weight)))
    return normalize_angle(first + weight * normalize_angle(second - first))


def update_pose(
    x: float,
    y: float,
    theta: float,
    d_left: float,
    d_right: float,
    wheel_base: float,
) -> tuple[float, float, float]:
    """Integrate one differential-drive wheel-distance increment.

    ``d_left`` and ``d_right`` use the same distance unit as ``x``/``y``.
    Midpoint integration behaves well for both straight motion and turns.
    """

    if wheel_base <= 0:
        raise ValueError("wheel_base must be positive")
    delta_s = (float(d_left) + float(d_right)) / 2.0
    delta_theta = (float(d_right) - float(d_left)) / float(wheel_base)
    theta_mid = float(theta) + delta_theta / 2.0
    return (
        float(x) + delta_s * math.cos(theta_mid),
        float(y) + delta_s * math.sin(theta_mid),
        normalize_angle(float(theta) + delta_theta),
    )


@dataclass
class Pose:
    """A pose plus an honest confidence estimate."""

    x_cm: float = 0.0
    y_cm: float = 0.0
    heading_rad: float = 0.0
    confidence: float = 1.0

    @property
    def heading_deg(self) -> float:
        return math.degrees(self.heading_rad)

    # Short aliases make the object convenient in plotting code while the
    # explicit ``*_cm``/``*_rad`` names remain the canonical serialized form.
    @property
    def x(self) -> float:
        return self.x_cm

    @property
    def y(self) -> float:
        return self.y_cm

    @property
    def theta(self) -> float:
        return self.heading_rad

    @property
    def confidence_percent(self) -> float:
        return self.confidence * 100.0

    def as_dict(self) -> dict[str, float]:
        return {
            "x_cm": float(self.x_cm),
            "y_cm": float(self.y_cm),
            "heading_rad": float(self.heading_rad),
            "heading_deg": float(self.heading_deg),
            "confidence": float(self.confidence),
            "confidence_percent": float(self.confidence_percent),
        }


class PoseEstimator:
    """Stateful differential-drive dead reckoner.

    ``step`` accepts motor speeds and a command duration.  If a fused IMU yaw
    is available, it is used to correct the heading after the wheel update;
    otherwise the wheel-derived turn is retained.  Confidence decays with
    travelled distance and turn magnitude, and can be restored only by an
    explicit ``reset`` or a high-quality external pose fix.
    """

    def __init__(
        self,
        *,
        wheel_base_cm: float = 14.0,
        speed_scale_cm_s: float = 1.0,
        distance_decay_cm: float = 500.0,
        turn_decay_rad: float = math.pi * 2.0,
        imu_heading_weight: float = 0.65,
        initial_pose: Pose | None = None,
    ) -> None:
        if wheel_base_cm <= 0 or speed_scale_cm_s < 0:
            raise ValueError("wheel_base_cm must be positive and speed_scale_cm_s non-negative")
        if distance_decay_cm <= 0 or turn_decay_rad <= 0:
            raise ValueError("confidence decay scales must be positive")
        if not 0 <= imu_heading_weight <= 1:
            raise ValueError("imu_heading_weight must be between 0 and 1")
        self.wheel_base_cm = float(wheel_base_cm)
        self.speed_scale_cm_s = float(speed_scale_cm_s)
        self.distance_decay_cm = float(distance_decay_cm)
        self.turn_decay_rad = float(turn_decay_rad)
        self.imu_heading_weight = float(imu_heading_weight)
        self.pose = initial_pose or Pose()
        self.pose.heading_rad = normalize_angle(self.pose.heading_rad)
        self.pose.confidence = max(0.0, min(1.0, float(self.pose.confidence)))
        self.distance_since_fix_cm = 0.0
        self.turn_since_fix_rad = 0.0

    def reset(self, pose: Pose | None = None) -> Pose:
        """Set a known-good pose and restore confidence to its supplied value."""

        self.pose = pose or Pose()
        self.pose.heading_rad = normalize_angle(self.pose.heading_rad)
        self.pose.confidence = max(0.0, min(1.0, float(self.pose.confidence)))
        self.distance_since_fix_cm = 0.0
        self.turn_since_fix_rad = 0.0
        return self.pose

    def step(
        self,
        *,
        left_speed: float,
        right_speed: float,
        duration_ms: float,
        imu_yaw_rad: float | None = None,
        speed_scale_cm_s: float | None = None,
    ) -> Pose:
        """Advance the estimate by one motor command.

        Speeds are signed.  ``duration_ms`` is converted to seconds.  A
        ``None`` IMU yaw is valid and does not invent a heading measurement.
        """

        if duration_ms < 0:
            raise ValueError("duration_ms must be non-negative")
        scale = self.speed_scale_cm_s if speed_scale_cm_s is None else float(speed_scale_cm_s)
        if scale < 0:
            raise ValueError("speed_scale_cm_s must be non-negative")
        seconds = float(duration_ms) / 1000.0
        d_left = float(left_speed) * seconds * scale
        d_right = float(right_speed) * seconds * scale
        old_heading = self.pose.heading_rad
        new_x, new_y, wheel_heading = update_pose(
            self.pose.x_cm,
            self.pose.y_cm,
            old_heading,
            d_left,
            d_right,
            self.wheel_base_cm,
        )
        distance = abs((d_left + d_right) / 2.0)
        wheel_turn = abs(normalize_angle(wheel_heading - old_heading))
        heading = wheel_heading
        if imu_yaw_rad is not None and math.isfinite(float(imu_yaw_rad)):
            heading = _blend_angle(wheel_heading, float(imu_yaw_rad), self.imu_heading_weight)
        self.pose.x_cm = new_x
        self.pose.y_cm = new_y
        self.pose.heading_rad = heading
        self.distance_since_fix_cm += distance
        self.turn_since_fix_rad += wheel_turn
        self.pose.confidence *= math.exp(
            -distance / self.distance_decay_cm - wheel_turn / self.turn_decay_rad
        )
        self.pose.confidence = max(0.0, min(1.0, self.pose.confidence))
        return self.pose

    def update_from_packet(
        self,
        packet: Mapping[str, Any],
        *,
        imu_yaw_rad: float | None = None,
        speed_scale_cm_s: float | None = None,
    ) -> Pose:
        """Consume the repository telemetry packet shape."""

        motor = packet.get("motor")
        if not isinstance(motor, Mapping):
            raise ValueError("packet is missing a motor object")
        try:
            left = float(motor["left_speed"])
            right = float(motor["right_speed"])
            duration = float(motor["duration_ms"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("motor must contain numeric left_speed, right_speed, duration_ms") from error
        return self.step(
            left_speed=left,
            right_speed=right,
            duration_ms=duration,
            imu_yaw_rad=imu_yaw_rad,
            speed_scale_cm_s=speed_scale_cm_s,
        )

    def as_dict(self) -> dict[str, float]:
        return self.pose.as_dict()


# Name used in several early planning notes; keep it as a friendly alias.
DeadReckoner = PoseEstimator
