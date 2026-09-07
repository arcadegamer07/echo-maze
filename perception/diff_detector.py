"""Baseline/current occupancy-grid comparison and changed-zone grouping."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from string import ascii_uppercase
from typing import Iterable

import numpy as np

from .occupancy_grid import Cell, GridSnapshot


def _column_name(index: int) -> str:
    name = ""
    value = int(index) + 1
    while value:
        value, remainder = divmod(value - 1, 26)
        name = ascii_uppercase[remainder] + name
    return name


@dataclass(frozen=True)
class ChangedZone:
    name: str
    cells: tuple[Cell, ...]
    bbox: tuple[Cell, Cell]
    area_cells: int
    mean_change: float
    max_change: float


@dataclass(frozen=True)
class GridDiff:
    difference: np.ndarray
    changed: np.ndarray
    origin_cell: Cell
    cell_size_cm: float
    threshold: float
    zones: tuple[ChangedZone, ...]

    @property
    def changed_fraction(self) -> float:
        return float(np.mean(self.changed)) if self.changed.size else 0.0

    @property
    def geometry_score(self) -> float:
        """Geometry deviation on a 0--100 scale."""

        if not self.difference.size:
            return 0.0
        return float(np.clip(np.mean(self.difference) * 200.0, 0.0, 100.0))


def _align_snapshots(baseline: GridSnapshot, current: GridSnapshot) -> tuple[np.ndarray, np.ndarray, np.ndarray, Cell, float]:
    if not np.isclose(baseline.cell_size_cm, current.cell_size_cm):
        raise ValueError("baseline and current cell sizes must match")
    min_x = min(baseline.origin_cell[0], current.origin_cell[0])
    min_y = min(baseline.origin_cell[1], current.origin_cell[1])
    max_x = max(
        baseline.origin_cell[0] + baseline.probabilities.shape[1] - 1,
        current.origin_cell[0] + current.probabilities.shape[1] - 1,
    )
    max_y = max(
        baseline.origin_cell[1] + baseline.probabilities.shape[0] - 1,
        current.origin_cell[1] + current.probabilities.shape[0] - 1,
    )
    shape = (max_y - min_y + 1, max_x - min_x + 1)
    base = np.full(shape, 0.5, dtype=np.float32)
    now = np.full(shape, 0.5, dtype=np.float32)
    base_explored = np.zeros(shape, dtype=bool)
    now_explored = np.zeros(shape, dtype=bool)

    def place(snapshot: GridSnapshot, target: np.ndarray, target_mask: np.ndarray) -> None:
        row = snapshot.origin_cell[1] - min_y
        col = snapshot.origin_cell[0] - min_x
        h, w = snapshot.probabilities.shape
        target[row : row + h, col : col + w] = snapshot.probabilities
        target_mask[row : row + h, col : col + w] = snapshot.explored

    place(baseline, base, base_explored)
    place(current, now, now_explored)
    comparable = base_explored & now_explored
    return base, now, comparable, (min_x, min_y), baseline.cell_size_cm


def _zones(changed: np.ndarray, difference: np.ndarray, origin: Cell, min_cells: int) -> tuple[ChangedZone, ...]:
    visited = np.zeros_like(changed, dtype=bool)
    found: list[ChangedZone] = []
    height, width = changed.shape
    for row in range(height):
        for col in range(width):
            if not changed[row, col] or visited[row, col]:
                continue
            queue: deque[tuple[int, int]] = deque([(row, col)])
            visited[row, col] = True
            cells: list[Cell] = []
            while queue:
                current_row, current_col = queue.popleft()
                cells.append((current_col + origin[0], current_row + origin[1]))
                for next_row, next_col in (
                    (current_row - 1, current_col),
                    (current_row + 1, current_col),
                    (current_row, current_col - 1),
                    (current_row, current_col + 1),
                ):
                    if (
                        0 <= next_row < height
                        and 0 <= next_col < width
                        and changed[next_row, next_col]
                        and not visited[next_row, next_col]
                    ):
                        visited[next_row, next_col] = True
                        queue.append((next_row, next_col))
            if len(cells) < min_cells:
                continue
            rows = [cell[1] - origin[1] for cell in cells]
            cols = [cell[0] - origin[0] for cell in cells]
            local_values = difference[rows, cols]
            min_cell = (min(cell[0] for cell in cells), min(cell[1] for cell in cells))
            max_cell = (max(cell[0] for cell in cells), max(cell[1] for cell in cells))
            found.append(
                ChangedZone(
                    name="",
                    cells=tuple(sorted(cells, key=lambda item: (item[1], item[0]))),
                    bbox=(min_cell, max_cell),
                    area_cells=len(cells),
                    mean_change=float(np.mean(local_values)),
                    max_change=float(np.max(local_values)),
                )
            )
    found.sort(key=lambda zone: (-zone.area_cells, zone.bbox[1][1], zone.bbox[0][0]))
    named: list[ChangedZone] = []
    for zone in found:
        col = zone.bbox[0][0] - origin[0]
        row = zone.bbox[0][1] - origin[1] + 1
        named.append(ChangedZone(f"ZONE {_column_name(col)}{row}", zone.cells, zone.bbox, zone.area_cells, zone.mean_change, zone.max_change))
    return tuple(named)


def compare_snapshots(
    baseline: GridSnapshot,
    current: GridSnapshot,
    *,
    threshold: float = 0.20,
    min_zone_cells: int = 1,
) -> GridDiff:
    """Compute ``abs(current - baseline)`` and contiguous changed zones."""

    if threshold < 0:
        raise ValueError("threshold must be non-negative")
    if min_zone_cells < 1:
        raise ValueError("min_zone_cells must be positive")
    base, now, comparable, origin, cell_size = _align_snapshots(baseline, current)
    difference = np.abs(now - base).astype(np.float32)
    changed = (difference >= threshold) & comparable
    return GridDiff(
        difference=difference,
        changed=changed,
        origin_cell=origin,
        cell_size_cm=cell_size,
        threshold=float(threshold),
        zones=_zones(changed, difference, origin, min_zone_cells),
    )


def compute_diff(
    baseline: np.ndarray,
    current: np.ndarray,
    *,
    threshold: float = 0.20,
) -> tuple[np.ndarray, np.ndarray]:
    """Small array-only API for callers that already aligned their grids."""

    baseline_array = np.asarray(baseline, dtype=float)
    current_array = np.asarray(current, dtype=float)
    if baseline_array.shape != current_array.shape:
        raise ValueError("baseline and current arrays must have the same shape")
    difference = np.abs(current_array - baseline_array)
    return difference, difference >= threshold

