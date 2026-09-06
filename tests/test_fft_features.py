import math
import unittest

from ml.fft_features import (
    FEATURE_NAMES,
    InsufficientTelemetryError,
    extract_window_features,
)


def packet(index: int, *, imu: object = None) -> dict:
    return {
        "run_id": "feature-test",
        "timestamp": index * 100,
        "mode": "learn",
        "source": "live",
        "motor": {"left_speed": 100 + index, "right_speed": 96, "duration_ms": 100},
        "scan": {"angle": 90, "distance_cm": 40 + index * 0.2},
        "imu": imu,
        "ir": 1200 + index,
        "temp_c": 25.0,
    }


class FeatureExtractionTests(unittest.TestCase):
    def test_extracts_named_finite_features(self):
        packets = [
            packet(
                index,
                imu={
                    "accel": [0.1 * math.sin(index), 0.0, 9.8],
                    "gyro": [0.01, 0.0, 0.0],
                },
            )
            for index in range(20)
        ]
        features = extract_window_features(packets)
        self.assertEqual(tuple(features), FEATURE_NAMES)
        self.assertTrue(all(math.isfinite(value) for value in features.values()))
        self.assertEqual(features["packet_count"], 20.0)
        self.assertGreater(features["imu_valid_fraction"], 0.99)

    def test_optional_missing_values_are_not_fake_zeroes(self):
        packets = [
            {
                **packet(index, imu={"accel": [0, 0, 9.8], "gyro": [0, 0, 0]}),
                "scan": {"angle": 90, "distance_cm": None},
                "ir": None,
                "temp_c": None,
            }
            for index in range(20)
        ]
        features = extract_window_features(packets)
        self.assertTrue(math.isnan(features["scan_distance_mean"]))
        self.assertTrue(math.isnan(features["ir_mean"]))
        self.assertTrue(math.isnan(features["temp_mean"]))

    def test_requires_real_imu_for_ml_window(self):
        with self.assertRaises(InsufficientTelemetryError):
            extract_window_features([packet(index) for index in range(20)])


if __name__ == "__main__":
    unittest.main()
