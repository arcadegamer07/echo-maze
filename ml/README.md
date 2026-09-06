# Echo-Maze ML foundation

This folder contains the first laptop-side anomaly-detection baseline. It is
designed to reduce integration pressure later: once CSE-1 sends real
`learn`/`verify` packets, the same commands can consume the receiver's JSONL
logs without changing the raw telemetry contract.

## Mental model

1. The receiver stores one JSON object per line in `data/runs/<run_id>.jsonl`.
2. `fft_features.py` groups packets into short overlapping windows and turns
   each window into named numeric features (motion, motor balance, scan/IR/
   temperature summaries, and a low-frequency acceleration spectrum).
3. `anomaly_model.py` imputes missing optional fields, scales the features, and
   fits an Isolation Forest to healthy `learn` windows.
4. A later `verify` run is scored window by window. The result is a relative
   `anomaly_score` from 0 to 100 plus `is_anomaly` and the raw model decision.

The score is not a probability and is not a structural-engineering safety
certificate. It is an early-warning signal that should be shown with map
geometry, sensor-health status, and human review.

## Commands

From the repository root, with the virtual environment active:

```powershell
python -m ml.pipeline learn `
  --input data/runs/baseline-01.jsonl `
  --model data/baseline/isolation_forest.joblib

python -m ml.pipeline verify `
  --input data/runs/verify-01.jsonl `
  --model data/baseline/isolation_forest.joblib `
  --output data/runs/verify-01.scores.jsonl
```

The default window is 20 packets with a stride of 10, which is about two
seconds at the current 10 Hz telemetry rate. A useful first baseline needs at
least eight windows (roughly 90 packets). The command rejects `test` and
`fixture` packets so connectivity fixtures cannot accidentally train the model.

## Current limits and next integration steps

- The WebSocket stream is about 10 Hz. Its Nyquist limit is about 5 Hz, so the
  FFT features are only low-frequency summaries. For real vibration analysis,
  sample the IMU faster on the ESP32 and send window summaries or a higher-rate
  stream.
- Missing scan, IR, and temperature values remain missing until the model's
  baseline imputer handles them. No fake sensor values are invented.
- The current model detects unusual telemetry windows. The final decision
  should fuse this with CSE-2's occupancy-grid/geometry change score and CSE-4's
  rover-health status. A disconnected, tilted, stalled, or low-battery rover
  should produce an invalid/needs-review result, not a structural anomaly.
- Thresholds and features are hackathon defaults. They must be evaluated with
  real repeated baseline and changed-structure runs before making accuracy
  claims.
