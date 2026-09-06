import tempfile
import unittest
from pathlib import Path

from ml.anomaly_model import BaselineAnomalyModel
from ml.fft_features import FEATURE_NAMES


def row(level: float) -> dict[str, float]:
    return {name: level + index * 0.01 for index, name in enumerate(FEATURE_NAMES)}


class AnomalyModelTests(unittest.TestCase):
    def test_fit_predict_and_save_load(self):
        baseline = [row(1.0 + index * 0.02) for index in range(20)]
        model = BaselineAnomalyModel(contamination=0.1, n_estimators=100).fit(baseline)
        normal_result = model.predict_one(row(1.2))
        unusual_result = model.predict_one(row(100.0))

        self.assertGreaterEqual(normal_result.anomaly_score, 0.0)
        self.assertLessEqual(normal_result.anomaly_score, 100.0)
        self.assertTrue(unusual_result.is_anomaly)
        self.assertGreater(unusual_result.anomaly_score, normal_result.anomaly_score)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.joblib"
            model.save(path)
            loaded_result = BaselineAnomalyModel.load(path).predict_one(row(100.0))
        self.assertEqual(loaded_result.is_anomaly, unusual_result.is_anomaly)
        self.assertAlmostEqual(loaded_result.raw_decision, unusual_result.raw_decision)

    def test_fit_rejects_too_few_windows(self):
        with self.assertRaises(ValueError):
            BaselineAnomalyModel().fit([row(1.0)] * 7)


if __name__ == "__main__":
    unittest.main()
