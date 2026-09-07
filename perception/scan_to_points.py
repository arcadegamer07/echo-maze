"""Convert ultrasonic sweep readings into local and world point clouds."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from .pose import Pose


def _pose_values(pose: Pose | Mapping[str, Any] | Sequence[float]) -> tuple[float, float, float]:
    if isinstance(pose, Pose):
        return pose.x_cm, pose.y_cm, pose.heading_rad
    if isinstance(pose, Mapping):
        x = pose.get("x_cm", pose.get("x", 0.0))
        y = pose.get("y_cm", pose.get("y", 0.0))
        heading = pose.get("heading_rad", pose.get("theta", pose.get("heading", 0.0)))
        return float(x), float(y), float(heading)
    if len(pose) != 3:
        raise ValueError("pose sequence must contain x, y, heading")
    return float(pose[0]), float(pose[1]), float(pose[2])


def _reading_values(reading: Mapping[str, Any] | Sequence[float]) -> tuple[float, float | None]:
    if isinstance(reading, Mapping):
        angle = reading.get("angle", reading.get("angle_deg"))
        distance = reading.get("distance_cm", reading.get("distance"))
    else:
        if len(reading) != 2:
            raise ValueError("scan reading sequence must contain angle and distance")
        angle, distance = reading
    if angle is None:
        raise ValueError("scan reading has no angle")
    return float(angle), None if distance is None else float(distance)


def scan_to_local_point(
    angle_deg: float,
    distance_cm: float,
    *,
    servo_center_deg: float = 0.0,
) -> tuple[float, float]:
    """Return ``(x, y)`` in the rover frame for one valid reading.

    The legacy helper treats 0° as the forward axis.  The Echo-Maze servo
    contract uses a 0--180° turret where 90° is forward, so production calls
    should pass ``servo_center_deg=90``.
    """

    if distance_cm < 0 or not math.isfinite(float(distance_cm)):
        raise ValueError("distance_cm must be a finite non-negative number")
    angle_rad = math.radians(float(angle_deg) - float(servo_center_deg))
    return distance_cm * math.cos(angle_rad), distance_cm * math.sin(angle_rad)


def local_to_world_point(
    local_x_cm: float,
    local_y_cm: float,
    pose: Pose | Mapping[str, Any] | Sequence[float],
) -> tuple[float, float]:
    """Rotate a local point by rover heading and translate by rover position."""

    x, y, heading = _pose_values(pose)
    cos_h, sin_h = math.cos(heading), math.sin(heading)
    return (
        x + local_x_cm * cos_h - local_y_cm * sin_h,
        y + local_x_cm * sin_h + local_y_cm * cos_h,
    )


def scan_to_world_point(*args: Any, servo_center_deg: float = 0.0) -> tuple[float, float]:
    """Convert one contract reading to a world point.

    Preferred form is ``scan_to_world_point(pose, angle_deg, distance_cm)``.
    For compatibility with the original CSE-2 helper, the legacy five-value
    form ``(robot_x, robot_y, robot_theta, servo_angle, distance_cm)`` is also
    accepted.
    """

    if len(args) == 3:
        pose, angle_deg, distance_cm = args
    elif len(args) == 5:
        robot_x, robot_y, robot_theta, angle_deg, distance_cm = args
        pose = (float(robot_x), float(robot_y), float(robot_theta))
    else:
        raise TypeError("expected (pose, angle_deg, distance_cm) or five legacy values")
    return local_to_world_point(
        *scan_to_local_point(
            float(angle_deg), float(distance_cm), servo_center_deg=servo_center_deg
        ),
        pose,
    )


def scan_to_points(
    readings: Iterable[Mapping[str, Any] | Sequence[float]],
    pose: Pose | Mapping[str, Any] | Sequence[float],
    *,
    max_distance_cm: float | None = None,
    servo_center_deg: float = 0.0,
) -> list[tuple[float, float]]:
    """Convert all valid readings from a sweep into world ``(x, y)`` points.

    ``null`` distances are skipped; they indicate no return, not a zero-range
    obstacle.  Invalid or negative measurements are also skipped so one noisy
    sensor packet cannot crash a whole run.
    """

    # Accept the natural ``scan_to_points(pose, readings)`` spelling too;
    # packet-processing code in early prototypes used both orders.
    if _looks_like_pose(readings) and not _looks_like_pose(pose):
        readings, pose = pose, readings  # type: ignore[assignment]
    if max_distance_cm is not None and max_distance_cm <= 0:
        raise ValueError("max_distance_cm must be positive")
    points: list[tuple[float, float]] = []
    for reading in readings:
        try:
            angle, distance = _reading_values(reading)
            if distance is None or distance < 0 or not math.isfinite(distance):
                continue
            if max_distance_cm is not None and distance > max_distance_cm:
                continue
            points.append(
                scan_to_world_point(
                    pose, angle, distance, servo_center_deg=servo_center_deg
                )
            )
        except (TypeError, ValueError):
            continue
    return points


def _looks_like_pose(value: Any) -> bool:
    if isinstance(value, Pose):
        return True
    if isinstance(value, Mapping):
        return any(key in value for key in ("x", "x_cm", "heading", "heading_rad", "theta"))
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return len(value) == 3 and all(isinstance(item, (int, float)) for item in value)
    return False


def scan_to_point_records(
    readings: Iterable[Mapping[str, Any] | Sequence[float]],
    pose: Pose | Mapping[str, Any] | Sequence[float],
    *,
    max_distance_cm: float | None = None,
    servo_center_deg: float = 0.0,
) -> list[dict[str, float]]:
    """JSON-friendly version of :func:`scan_to_points`."""

    points = scan_to_points(
        readings,
        pose,
        max_distance_cm=max_distance_cm,
        servo_center_deg=servo_center_deg,
    )
    return [{"x_cm": float(x), "y_cm": float(y)} for x, y in points]
