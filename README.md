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

Before hardware is ready, confirm the receiver using a simulated rover packet:

```powershell
.\\.venv\\Scripts\\python.exe -m ml.send_test_packet
```
