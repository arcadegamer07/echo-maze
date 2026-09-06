import json
import math
import tempfile
import unittest
from pathlib import Path

from ml.pipeline import score_verify, train_baseline, window_packets


def telemetry_packet(index: int, *, mode: str, run_id: str, changed: bool = False) -> dict:
    scale = 100.0 if changed else 1.0
    return {
        "run_id": run_id,
        "timestamp": index * 100,
        "mode": mode,
        "source": "live",
        "motor": {
            "left_speed": 100 + index % 3 if not changed else 10000,
            "right_speed": 98 if not changed else -10000,
            "duration_ms": 100,
        },
        "scan": {"angle": 90, "distance_cm": 45.0 if not changed else 1000.0},
        "imu": {
            "accel": [scale * math.sin(index / 4), 100.0 if changed else 0.0, 100.0 if changed else 9.8],
            "gyro": [100.0 if changed else 0.01, 0.0, 0.0],
        },
        "ir": 99999 if changed else 1500,
        "temp_c": 100.0 if changed else 25.0,
    }


def write_packets(path: Path, packets: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(packet, separators=(",", ":")) + "\n" for packet in packets),
        encoding="utf-8",
    )


class PipelineTests(unittest.TestCase):
    def test_windows_are_overlapping(self):
        packets = [telemetry_packet(i, mode="learn", run_id="x") for i in range(7)]
        windows = list(window_packets(packets, window_size=4, stride=2))
        self.assertEqual(len(windows), 2)
        self.assertEqual(windows[0][0]["timestamp"], 0)
        self.assertEqual(windows[1][0]["timestamp"], 200)

    def test_learn_then_verify(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            learn_path = root / "baseline.jsonl"
            verify_path = root / "verify.jsonl"
            model_path = root / "baseline.joblib"
            write_packets(
                learn_path,
                [telemetry_packet(i, mode="learn", run_id="baseline") for i in range(100)],
            )
            write_packets(
                verify_path,
                [
                    telemetry_packet(i, mode="verify", run_id="verify", changed=True)
                    for i in range(20)
                ],
            )

            train_baseline(learn_path, model_path)
            results = score_verify(verify_path, model_path)

        self.assertEqual(len(results), 1)
        self.assertIn("anomaly_score", results[0])
        self.assertIn("is_anomaly", results[0])
        self.assertTrue(results[0]["is_anomaly"])


if __name__ == "__main__":
    unittest.main()
