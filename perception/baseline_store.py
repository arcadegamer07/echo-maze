"""Immutable baseline/current occupancy-grid persistence."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from .occupancy_grid import Cell, GridSnapshot, OccupancyGrid


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fingerprint_snapshot(snapshot: GridSnapshot) -> str:
    """Return a short deterministic fingerprint for a grid snapshot."""

    digest = hashlib.sha256()
    digest.update(np.ascontiguousarray(snapshot.probabilities, dtype=np.float32).tobytes())
    digest.update(np.ascontiguousarray(snapshot.explored, dtype=np.uint8).tobytes())
    digest.update(json.dumps({
        "origin_cell": list(snapshot.origin_cell),
        "cell_size_cm": float(snapshot.cell_size_cm),
        "shape": list(snapshot.probabilities.shape),
    }, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    return digest.hexdigest()[:12].upper()


@dataclass(frozen=True)
class StoredGrid:
    snapshot: GridSnapshot
    fingerprint: str
    metadata: dict[str, Any]
    path: Path | None = None


def _snapshot_payload(snapshot: GridSnapshot, metadata: dict[str, Any]) -> dict[str, np.ndarray]:
    return {
        "probabilities": np.asarray(snapshot.probabilities, dtype=np.float32),
        "explored": np.asarray(snapshot.explored, dtype=np.uint8),
        "origin_cell": np.asarray(snapshot.origin_cell, dtype=np.int64),
        "cell_size_cm": np.asarray([snapshot.cell_size_cm], dtype=np.float64),
        "fingerprint": np.asarray([fingerprint_snapshot(snapshot)]),
        "metadata_json": np.asarray([json.dumps(metadata, sort_keys=True)]),
    }


def save_snapshot(
    snapshot: GridSnapshot,
    path: str | Path,
    *,
    metadata: dict[str, Any] | None = None,
    overwrite: bool = False,
) -> StoredGrid:
    """Save one snapshot as a portable compressed NPZ file."""

    destination = Path(path)
    if destination.suffix.lower() != ".npz":
        destination = destination.with_suffix(".npz")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and not overwrite:
        raise FileExistsError(f"refusing to overwrite grid snapshot: {destination}")
    complete_metadata = {"saved_at_utc": _utc_now(), **(metadata or {})}
    fingerprint = fingerprint_snapshot(snapshot)
    complete_metadata.setdefault("fingerprint", fingerprint)
    np.savez_compressed(destination, **_snapshot_payload(snapshot, complete_metadata))
    return StoredGrid(snapshot, fingerprint, complete_metadata, destination)


def load_snapshot(path: str | Path) -> StoredGrid:
    """Load and validate a stored NPZ snapshot."""

    source = Path(path)
    with np.load(source, allow_pickle=False) as payload:
        probabilities = np.asarray(payload["probabilities"], dtype=np.float32)
        explored = np.asarray(payload["explored"], dtype=bool)
        origin_values = np.asarray(payload["origin_cell"], dtype=np.int64).tolist()
        cell_size = float(np.asarray(payload["cell_size_cm"], dtype=float).reshape(-1)[0])
        stored_fingerprint = str(np.asarray(payload["fingerprint"]).reshape(-1)[0])
        metadata_raw = str(np.asarray(payload["metadata_json"]).reshape(-1)[0])
    snapshot = GridSnapshot(probabilities, explored, (int(origin_values[0]), int(origin_values[1])), cell_size)
    calculated = fingerprint_snapshot(snapshot)
    if calculated != stored_fingerprint:
        raise ValueError(f"snapshot fingerprint mismatch: expected {stored_fingerprint}, calculated {calculated}")
    try:
        metadata = json.loads(metadata_raw)
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid metadata in {source}") from error
    if not isinstance(metadata, dict):
        raise ValueError(f"metadata in {source} must be an object")
    return StoredGrid(snapshot, calculated, metadata, source)


class BaselineStore:
    """Filesystem store that never replaces a baseline unless asked explicitly."""

    def __init__(self, root: str | Path = "data") -> None:
        self.root = Path(root)
        self.baseline_dir = self.root / "baseline"
        self.runs_dir = self.root / "runs"

    def save_baseline(
        self,
        grid: OccupancyGrid | GridSnapshot,
        *,
        run_id: str = "baseline",
        metadata: dict[str, Any] | None = None,
    ) -> StoredGrid:
        snapshot = grid.snapshot() if isinstance(grid, OccupancyGrid) else grid
        safe_id = _safe_id(run_id)
        destination = self.baseline_dir / f"{safe_id}.npz"
        return save_snapshot(
            snapshot,
            destination,
            metadata={"kind": "baseline", "run_id": run_id, **(metadata or {})},
        )

    def save_current(
        self,
        grid: OccupancyGrid | GridSnapshot,
        *,
        run_id: str = "verify",
        metadata: dict[str, Any] | None = None,
    ) -> StoredGrid:
        snapshot = grid.snapshot() if isinstance(grid, OccupancyGrid) else grid
        safe_id = _safe_id(run_id)
        destination = self.runs_dir / f"{safe_id}.npz"
        return save_snapshot(
            snapshot,
            destination,
            metadata={"kind": "current", "run_id": run_id, **(metadata or {})},
        )

    def load_baseline(self, run_id: str = "baseline") -> StoredGrid:
        return load_snapshot(self.baseline_dir / f"{_safe_id(run_id)}.npz")


def _safe_id(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "-_" else "_" for char in str(value))
    if not cleaned:
        raise ValueError("run_id must contain at least one alphanumeric character")
    return cleaned

