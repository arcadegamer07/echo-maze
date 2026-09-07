"""Hardware-independent perception primitives for Echo-Maze."""

from .baseline_store import BaselineStore, StoredGrid, fingerprint_snapshot, load_snapshot, save_snapshot
from .diff_detector import ChangedZone, GridDiff, compare_snapshots, compute_diff
from .occupancy_grid import GridSnapshot, OccupancyGrid, cell_to_world, ray_cells, world_to_cell
from .pose import DeadReckoner, Pose, PoseEstimator, normalize_angle, update_pose
from .scan_to_points import local_to_world_point, scan_to_local_point, scan_to_points, scan_to_world_point
from .structural_score import (
    IMUFingerprint,
    StructuralScore,
    compute_imu_fingerprint,
    fingerprint_deviations,
    score_checkpoint,
    structural_change_score,
)

__all__ = [
    "BaselineStore",
    "ChangedZone",
    "DeadReckoner",
    "GridDiff",
    "GridSnapshot",
    "IMUFingerprint",
    "OccupancyGrid",
    "Pose",
    "PoseEstimator",
    "StoredGrid",
    "StructuralScore",
    "cell_to_world",
    "compare_snapshots",
    "compute_diff",
    "compute_imu_fingerprint",
    "fingerprint_deviations",
    "fingerprint_snapshot",
    "load_snapshot",
    "local_to_world_point",
    "normalize_angle",
    "ray_cells",
    "save_snapshot",
    "scan_to_local_point",
    "scan_to_points",
    "scan_to_world_point",
    "score_checkpoint",
    "structural_change_score",
    "update_pose",
    "world_to_cell",
]
