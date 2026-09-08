# Echo-Maze

Laptop-side start for the Echo-Maze rover project.

## Initial layout

```text
firmware/       ESP32 code (CSE-1)
perception/     pose, occupancy grid, and temporal diff (CSE-2)
ml/             telemetry, features, anomaly model, and pipeline (CSE-3)
dashboard/      React user interface (CSE-4)
data/baseline/  immutable baseline artifacts
data/runs/      immutable raw JSONL telemetry logs
```

## CSE-3: run the first milestone

```powershell
.\\.venv\\Scripts\\python.exe -m ml.telemetry_server --port 8765
```

The firmware connects to `ws://<laptop-ip>:8765`. The exact packet contract is
in `telemetry_contract.md`. Do not start the anomaly model until raw packets
are reliably being logged.

The current hardware-independent firmware boundaries are documented in
`firmware/INTEGRATION_PLAN.md`; the ML foundation and its learn/verify commands
are documented in `ml/README.md`.

## Standalone rover power

The laptop USB cable is only needed for flashing and serial diagnostics. For
field operation, connect a power bank's regulated 5 V USB output to the ESP32
USB port, then unplug the laptop. Keep the TB6612 motor supply on its own
properly rated motor battery/regulated rail; do not feed motors from the
ESP32 3V3 pin or directly from an unverified USB rail. Tie the power-bank
ground, motor-supply ground, servo-supply ground, and ESP32/TB6612 GND
together. The firmware boots, joins the configured hotspot, and reconnects to
the receiver without a USB data connection.

Recommended power-on order:

1. Start the laptop receiver and enable the configured hotspot.
2. Keep the motor supply switched off while powering the ESP32 from the power
   bank; confirm the dashboard/receiver link.
3. Turn on the motor supply only after the rover reports `WebSocket CONNECTED`.
4. Use the dashboard's non-motion status check, then run a supervised field
   function. Keep the USB cable available for reflashing or serial logs.

## CSE-2: perception pipeline

The perception layer is hardware-independent and can be exercised from a
replayed JSONL run before the rover is wired:

1. `perception.pose.PoseEstimator` integrates signed wheel commands and an
   optional fused IMU yaw into an `(x, y, heading)` pose.  Its confidence
   starts at 1.0 and decays with distance and turning; it is an estimate, not
   ground truth.
2. `perception.scan_to_points.scan_to_points` converts each valid ultrasonic
   `{angle, distance_cm}` return from the rover frame into world centimetres.
   `null` ranges are skipped rather than treated as a zero-distance obstacle.
3. `perception.occupancy_grid.OccupancyGrid` maintains a sparse 10 cm log-odds
   grid.  Cells traversed by a ray become more likely free; the hit cell
   becomes more likely occupied.  `map_confidence` is the average certainty of
   explored cells, expressed as 0--100.
4. `perception.baseline_store.BaselineStore.save_baseline` writes an immutable
   compressed `.npz` snapshot under `data/baseline/`.  A verify run is saved
   separately with `save_current` under `data/runs/`; a SHA-256 fingerprint
   makes accidental edits detectable.
5. `perception.diff_detector.compare_snapshots` aligns baseline/current grids,
   computes `abs(current - baseline)`, thresholds changed cells, and groups
   contiguous changes into deterministic names such as `ZONE B3`.
6. `perception.structural_score.compute_imu_fingerprint` remains available for
   a future IMU, while the current gyro-free build uses `score_checkpoint`
   with geometry and temperature evidence. Missing IMU data is represented as
   `null`, never as fake zeros.

Example with a live-shaped packet list:

```python
from perception import BaselineStore, OccupancyGrid, PoseEstimator, compare_snapshots

pose = PoseEstimator(wheel_base_cm=14.0, speed_scale_cm_s=0.08)
grid = OccupancyGrid(cell_size_cm=10.0)
for packet in packets:
    pose.update_from_packet(packet)
    grid.update_scan(
        pose.pose.x_cm, pose.pose.y_cm, pose.pose.heading_rad,
        [packet["scan"]],
        servo_center_deg=90.0,  # firmware turret: 90° points forward
    )

store = BaselineStore("data")
baseline = store.save_baseline(grid, run_id="baseline-01")
# Later: current = store.save_current(current_grid, run_id="verify-01")
# diff = compare_snapshots(baseline.snapshot, current.snapshot)
```

All distances in this layer are centimetres; angles supplied by the telemetry
contract are degrees, while pose headings are radians. Real learn/verify runs
may contain `imu: null` in the gyro-free build. Fixture values are for
connectivity tests only and must never be used to train or compare a baseline.

Before hardware is ready, confirm the receiver using a simulated rover packet:

```powershell
.\\.venv\\Scripts\\python.exe -m ml.send_test_packet
```

Run the laptop-side tests with:

```powershell
.\\.venv\\Scripts\\python.exe -m unittest discover -s tests -v
```
