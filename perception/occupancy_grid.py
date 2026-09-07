"""Sparse probabilistic occupancy grid for Echo-Maze.

The grid uses 10 cm cells by default and stores log-odds internally.  Unknown
cells remain at probability 0.5; only cells touched by a scan become explored.
The sparse representation avoids choosing an arbitrary maze size before the
rover has mapped it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

import numpy as np


Cell = tuple[int, int]


def world_to_cell(x_cm: float, y_cm: float, cell_size_cm: float = 10.0) -> Cell:
    if cell_size_cm <= 0:
        raise ValueError("cell_size_cm must be positive")
    return (math.floor(float(x_cm) / cell_size_cm), math.floor(float(y_cm) / cell_size_cm))


def cell_to_world(cell: Cell, cell_size_cm: float = 10.0) -> tuple[float, float]:
    if cell_size_cm <= 0:
        raise ValueError("cell_size_cm must be positive")
    return ((cell[0] + 0.5) * cell_size_cm, (cell[1] + 0.5) * cell_size_cm)


def _logit(probability: float) -> float:
    p = min(1.0 - 1e-6, max(1e-6, float(probability)))
    return math.log(p / (1.0 - p))


def _sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, value))))


def ray_cells(start: Cell, end: Cell) -> list[Cell]:
    """Return cells on a line using integer Bresenham traversal."""

    x0, y0 = start
    x1, y1 = end
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    error = dx - dy
    cells: list[Cell] = []
    while True:
        cells.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        twice = 2 * error
        if twice > -dy:
            error -= dy
            x0 += sx
        if twice < dx:
            error += dx
            y0 += sy
    return cells


@dataclass(frozen=True)
class GridSnapshot:
    """Dense snapshot used for persistence and baseline comparison."""

    probabilities: np.ndarray
    explored: np.ndarray
    origin_cell: Cell
    cell_size_cm: float

    def __post_init__(self) -> None:
        if self.probabilities.shape != self.explored.shape:
            raise ValueError("probabilities and explored must have the same shape")
        if self.probabilities.ndim != 2:
            raise ValueError("grid arrays must be two-dimensional")


class OccupancyGrid:
    """A sparse log-odds occupancy grid with confidence tracking."""

    def __init__(
        self,
        *,
        cell_size_cm: float = 10.0,
        hit_probability: float = 0.85,
        miss_probability: float = 0.30,
        min_log_odds: float = -6.0,
        max_log_odds: float = 6.0,
    ) -> None:
        if cell_size_cm <= 0:
            raise ValueError("cell_size_cm must be positive")
        if not 0 < miss_probability < 0.5 or not 0.5 < hit_probability < 1:
            raise ValueError("miss_probability must be <0.5 and hit_probability >0.5")
        self.cell_size_cm = float(cell_size_cm)
        self.hit_probability = float(hit_probability)
        self.miss_probability = float(miss_probability)
        self.min_log_odds = float(min_log_odds)
        self.max_log_odds = float(max_log_odds)
        self._log_odds: dict[Cell, float] = {}

    @property
    def cells(self) -> set[Cell]:
        return set(self._log_odds)

    @property
    def explored_count(self) -> int:
        return len(self._log_odds)

    def probability(self, cell: Cell) -> float:
        return _sigmoid(self._log_odds.get(cell, 0.0))

    def update_cell(self, cell: Cell, *, occupied: bool) -> float:
        likelihood = self.hit_probability if occupied else self.miss_probability
        self._log_odds[cell] = max(
            self.min_log_odds,
            min(self.max_log_odds, self._log_odds.get(cell, 0.0) + _logit(likelihood)),
        )
        return self.probability(cell)

    def update_ray(self, origin: Cell, endpoint: Cell, *, hit: bool = True) -> None:
        cells = ray_cells(origin, endpoint)
        free_cells = cells[:-1] if hit and len(cells) > 1 else cells
        for cell in free_cells:
            self.update_cell(cell, occupied=False)
        if hit:
            self.update_cell(cells[-1], occupied=True)

    def update_scan(
        self,
        robot_x_cm: float,
        robot_y_cm: float,
        robot_heading_rad: float,
        readings: Iterable[Mapping[str, Any] | tuple[float, float | None]],
        *,
        max_range_cm: float = 250.0,
        servo_center_deg: float = 0.0,
    ) -> None:
        """Update free ray cells and hit cells from one ultrasonic sweep.

        ``servo_center_deg=90`` is the Echo-Maze firmware convention (the
        centre of its 0--180° turret points forward).  The default remains
        0° for compatibility with the original low-level helper API.
        """

        if max_range_cm <= 0:
            raise ValueError("max_range_cm must be positive")
        origin = world_to_cell(robot_x_cm, robot_y_cm, self.cell_size_cm)
        cos_h, sin_h = math.cos(robot_heading_rad), math.sin(robot_heading_rad)
        for reading in readings:
            if isinstance(reading, Mapping):
                angle = reading.get("angle", reading.get("angle_deg"))
                distance = reading.get("distance_cm", reading.get("distance"))
            else:
                angle, distance = reading
            if angle is None:
                continue
            try:
                angle_rad = math.radians(float(angle) - float(servo_center_deg))
                distance_value = None if distance is None else float(distance)
            except (TypeError, ValueError):
                continue
            if distance_value is not None and (
                distance_value < 0 or not math.isfinite(distance_value)
            ):
                continue
            hit = distance_value is not None and distance_value < max_range_cm
            ray_distance = distance_value if hit else max_range_cm
            local_x = ray_distance * math.cos(angle_rad)
            local_y = ray_distance * math.sin(angle_rad)
            world_x = robot_x_cm + local_x * cos_h - local_y * sin_h
            world_y = robot_y_cm + local_x * sin_h + local_y * cos_h
            self.update_ray(
                origin,
                world_to_cell(world_x, world_y, self.cell_size_cm),
                hit=hit,
            )

    @property
    def map_confidence(self) -> float:
        """Average certainty over explored cells, expressed as 0--100."""

        if not self._log_odds:
            return 0.0
        certainty = [2.0 * abs(self.probability(cell) - 0.5) for cell in self._log_odds]
        return float(np.mean(certainty) * 100.0)

    def snapshot(self, *, padding: int = 0) -> GridSnapshot:
        """Materialize the sparse grid into a dense snapshot."""

        if padding < 0:
            raise ValueError("padding must be non-negative")
        if not self._log_odds:
            return GridSnapshot(
                probabilities=np.full((1, 1), 0.5, dtype=np.float32),
                explored=np.zeros((1, 1), dtype=bool),
                origin_cell=(0, 0),
                cell_size_cm=self.cell_size_cm,
            )
        xs = [cell[0] for cell in self._log_odds]
        ys = [cell[1] for cell in self._log_odds]
        min_x, max_x = min(xs) - padding, max(xs) + padding
        min_y, max_y = min(ys) - padding, max(ys) + padding
        probabilities = np.full((max_y - min_y + 1, max_x - min_x + 1), 0.5, dtype=np.float32)
        explored = np.zeros_like(probabilities, dtype=bool)
        for (x, y), log_odds in self._log_odds.items():
            row, col = y - min_y, x - min_x
            probabilities[row, col] = self.probability((x, y))
            explored[row, col] = True
        return GridSnapshot(probabilities, explored, (min_x, min_y), self.cell_size_cm)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cell_size_cm": self.cell_size_cm,
            "map_confidence": self.map_confidence,
            "cells": [
                {"x": x, "y": y, "occupancy": self.probability((x, y))}
                for x, y in sorted(self._log_odds)
            ],
        }

    @classmethod
    def from_snapshot(cls, snapshot: GridSnapshot) -> "OccupancyGrid":
        grid = cls(cell_size_cm=snapshot.cell_size_cm)
        for row, col in zip(*np.nonzero(snapshot.explored)):
            cell = (int(col + snapshot.origin_cell[0]), int(row + snapshot.origin_cell[1]))
            grid._log_odds[cell] = _logit(float(snapshot.probabilities[row, col]))
        return grid
