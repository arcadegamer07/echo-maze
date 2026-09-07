import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from perception.baseline_store import BaselineStore, load_snapshot
from perception.diff_detector import compare_snapshots, compute_diff
from perception.occupancy_grid import GridSnapshot, OccupancyGrid, ray_cells, world_to_cell
from perception.pose import PoseEstimator, update_pose
from perception.scan_to_points import scan_to_local_point, scan_to_points, scan_to_world_point
from perception.structural_score import (
    compute_imu_fingerprint,
    fingerprint_deviations,
    structural_change_score,
)


class PerceptionTests(unittest.TestCase):
    def test_pose_straight_line_and_confidence_decay(self):
        x, y, theta = update_pose(0, 0, 0, 10, 10, 20)
        self.assertAlmostEqual(x, 10)
        self.assertAlmostEqual(y, 0)
        self.assertAlmostEqual(theta, 0)

        estimator = PoseEstimator(speed_scale_cm_s=1.0)
        pose = estimator.step(left_speed=100, right_speed=100, duration_ms=100)
        self.assertAlmostEqual(pose.x_cm, 10)
        self.assertLess(pose.confidence, 1.0)

    def test_scan_transform(self):
        self.assertAlmostEqual(scan_to_local_point(0, 10), (10, 0))
        self.assertAlmostEqual(scan_to_world_point((5, 2, math.pi / 2), 0, 10)[0], 5)
        self.assertAlmostEqual(scan_to_world_point((5, 2, math.pi / 2), 0, 10)[1], 12)
        points = scan_to_points(
            [{"angle": 0, "distance_cm": 10}, {"angle": 90, "distance_cm": None}],
            (0, 0, 0),
        )
        self.assertEqual(len(points), 1)

    def test_occupancy_grid_marks_free_and_hit(self):
        self.assertEqual(ray_cells((0, 0), (3, 0)), [(0, 0), (1, 0), (2, 0), (3, 0)])
        grid = OccupancyGrid(cell_size_cm=10)
        grid.update_scan(5, 5, 0, [{"angle": 0, "distance_cm": 25}])
        self.assertGreater(grid.probability((3, 0)), 0.5)
        self.assertLess(grid.probability((1, 0)), 0.5)
        self.assertGreater(grid.map_confidence, 0)

    def test_baseline_round_trip_is_immutable(self):
        grid = OccupancyGrid(cell_size_cm=10)
        grid.update_scan(5, 5, 0, [{"angle": 0, "distance_cm": 25}])
        with tempfile.TemporaryDirectory() as directory:
            store = BaselineStore(directory)
            saved = store.save_baseline(grid, run_id="healthy")
            loaded = store.load_baseline("healthy")
            self.assertEqual(saved.fingerprint, loaded.fingerprint)
            with self.assertRaises(FileExistsError):
                store.save_baseline(grid, run_id="healthy")
            self.assertEqual(load_snapshot(saved.path).fingerprint, saved.fingerprint)

    def test_diff_groups_changed_cells(self):
        baseline = GridSnapshot(np.full((3, 3), 0.5), np.ones((3, 3), bool), (0, 0), 10)
        current_values = baseline.probabilities.copy()
        current_values[1, 1] = 0.95
        current_values[1, 2] = 0.9
        current = GridSnapshot(current_values, baseline.explored, (0, 0), 10)
        result = compare_snapshots(baseline, current, threshold=0.2)
        self.assertEqual(len(result.zones), 1)
        self.assertEqual(result.zones[0].name, "ZONE B2")
        difference, changed = compute_diff(np.zeros((1, 1)), np.ones((1, 1)), threshold=0.5)
        self.assertTrue(bool(changed[0, 0]))
        self.assertEqual(float(difference[0, 0]), 1.0)

    def test_imu_fingerprint_and_score(self):
        baseline_samples = [{"imu": {"accel": [0, 0, 9.8]}, "temp_c": 25.0} for _ in range(20)]
        current_samples = [{"imu": {"accel": [2, 0, 9.0]}, "temp_c": 30.0} for _ in range(20)]
        baseline = compute_imu_fingerprint(baseline_samples)
        current = compute_imu_fingerprint(current_samples)
        deviations = fingerprint_deviations(baseline, current)
        self.assertAlmostEqual(baseline.tilt_deg, 0.0)
        self.assertGreater(deviations["tilt"], 0)
        score = structural_change_score(geometry=100, tilt=100, vibration=0, thermal=0)
        self.assertEqual(score.severity, "HIGH")
        self.assertTrue(score.needs_review)


if __name__ == "__main__":
    unittest.main()
