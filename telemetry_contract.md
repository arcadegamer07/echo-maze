# Echo-Maze telemetry contract (CSE-1 -> CSE-2/CSE-3/CSE-4)

## Transport

The ESP32 opens a WebSocket connection to `ws://<laptop-ip>:8765`. It sends
one UTF-8 JSON object per WebSocket message at approximately 10 Hz. The laptop
does not send control commands in this first milestone; it replies only with a
small acknowledgement after accepting or rejecting a message.

## Canonical packet

```json
{
  "run_id": "baseline-01",
  "timestamp": 23843,
  "mode": "learn",
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

## Fields and units

| Field | Type | Unit / meaning |
|---|---|---|
| `timestamp` | number | Milliseconds since ESP32 boot. It must increase during a run. |
| `mode` | string | Exactly `learn` or `verify`. |
| `motor.left_speed`, `motor.right_speed` | number | Signed PWM command, convention agreed with firmware. |
| `motor.duration_ms` | number | Duration of the active command. |
| `scan.angle` | number | Servo angle in degrees; 90° is forward. |
| `scan.distance_cm` | number or `null` | Ultrasonic range in centimetres after servo settling. |
| `imu.accel` | three numbers | x/y/z acceleration in m/s². |
| `imu.gyro` | three numbers | x/y/z angular velocity in degrees/s. |
| `ir`, `temp_c` | number or `null` | Raw IR value; temperature in °C. |

Use JSON `null` for an unavailable reading—never a fake zero. The machine
readable schema is `ml/schemas/telemetry.schema.json`; it is the source of
truth for validation.
