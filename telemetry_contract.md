# Echo-Maze telemetry contract (CSE-1 -> CSE-2/CSE-3/CSE-4)

## Transport

The ESP32 opens a WebSocket connection to `ws://<laptop-ip>:8765`. It sends
one UTF-8 JSON object per WebSocket message at approximately 10 Hz. The laptop
receiver also relays dashboard commands (`learn`, `verify`, `explore`, `stop`, `reset`,
`run_route`) to the connected ESP32 and broadcasts accepted telemetry to
dashboard clients. It replies with a small acknowledgement after accepting or
rejecting a frame.

Use `mode: "test"` with `source: "fixture"` for connectivity checks before
all sensors are wired. Test packets are never used to build a baseline, map,
or ML model. Use `mode: "learn"`, `mode: "verify"`, or `mode: "explore"` only
for real rover readings, with `source: "live"`. `explore` is the bounded,
sensor-guarded unknown-area survey: it is mappable live evidence, but it is
not used to train the baseline anomaly model.

## Canonical packet

```json
{
  "run_id": "connectivity-test-01",
  "timestamp": 23843,
  "mode": "test",
  "source": "fixture",
  "motor": {"left_speed": 120, "right_speed": 120, "duration_ms": 500},
  "scan": {"angle": 90.0, "distance_cm": 54.2},
  "imu": {
    "accel": [0.05, -0.02, 9.78],
    "gyro": [0.1, 0.0, -0.1]
  },
  "ir": 1780,
  "temp_c": 27.1
}
```

`run_id` is a required addition to the original shared shape. It uniquely
identifies a full rover pass, e.g. `baseline-01` or `verify-01`; use a new
value for every run. The server adds `received_at_utc` and `sender_ip` when it
writes the raw log, but firmware must not send those two fields.

The values in the packet above are valid only because it is explicitly marked
as a fixture test. Never use placeholder IMU values in `learn` or `verify`
telemetry.

## Fields and units

| Field | Type | Unit / meaning |
|---|---|---|
| `timestamp` | number | Milliseconds since ESP32 boot. It must increase during a run. |
| `mode` | string | `test`, `learn`, `verify`, or `explore`. `test` is never map/baseline data. |
| `source` | string | `fixture` for a simulated test; `live` for real rover readings. |
| `motor.left_speed`, `motor.right_speed` | number | Signed PWM command, convention agreed with firmware. |
| `motor.duration_ms` | number | Duration of the active command. |
| `scan.angle` | number | Servo angle in degrees; 90° is forward. |
| `scan.distance_cm` | number or `null` | Ultrasonic range in centimetres after servo settling. |
| `imu` | object or `null` | Optional sensor block. This hardware build is gyro-free, so live runs may use `null`; never invent values. |
| `imu.accel` | three numbers | x/y/z acceleration in m/s². |
| `imu.gyro` | three numbers | x/y/z angular velocity in degrees/s. |
| `ir`, `temp_c` | number or `null` | Raw IR value; temperature in °C. |

Use JSON `null` for an unavailable reading—never a fake zero. In gyro-free
mode the model uses range, motor, IR and temperature evidence plus wheel
command odometry; vibration/tilt evidence is unavailable. The machine
readable schema is `ml/schemas/telemetry.schema.json`; it is the source of
truth for validation.
