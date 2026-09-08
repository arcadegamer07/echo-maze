# Firmware integration status

The ESP32 firmware is now a gyro-free, sensor-backed MVP. It keeps the TB6612
driver stopped at boot, connects to the laptop receiver, accepts dashboard
commands, and sends real telemetry at approximately 10 Hz during an explicit
learn/verify route.

## Working path

- `telemetry.h/.cpp`: contract-safe JSON; `imu: null` is valid in every mode.
- `sensors.h/.cpp`: ultrasonic (GPIO 32/33), digital IR (GPIO 34), DHT11
  (GPIO 4), and optional MPU6050 detection. Missing IMU is never faked.
- `motor_control.h/.cpp`: bounded PWM drive plus a low-power diagnostic;
  driver is in standby unless a command is active.
- `main.ino`: non-blocking runtime controller for routes, guarded Explore,
  bounded straight drive, stationary scan-only capture, and a wheel-up motor
  diagnostic. It sends a terminal zero-motor telemetry packet plus a
  `rover_status` side-channel event whenever a run stops.
- `health.h/.cpp`: ultrasonic, IR, and inbound-WebSocket heartbeat checks are
  evaluated before a straight-moving route continues. The heartbeat is based
  on received traffic only; outgoing telemetry can never falsely keep a rover
  moving.

## Runtime commands

The dashboard sends these exact JSON commands. A connected receiver is
required before any runtime can start; every motor-capable runtime has a hard
deadline and stops on a lost inbound WebSocket heartbeat.

| Command | Safe behavior | Limits |
|---|---|---|
| `{"cmd":"learn"}` | Repeatable route plus 15° range sweep. | Stops on 10 cm ultrasonic or active IR obstacle. |
| `{"cmd":"verify"}` | Identical repeatable route for comparison. | Same safety limits as Learn. |
| `{"cmd":"explore","duration_ms":10000}` | Stationary 60–120° front-cone sweep, then forward, reverse, turn, resweep, and resume around obstacles. | 1–30,000 ms; 22 cm avoidance threshold. |
| `{"cmd":"drive_straight","duration_ms":2000,"speed":230}` | Forward-only guarded distance check. | 1–10,000 ms; PWM clamped to 180–245. |
| `{"cmd":"scan_only"}` | Motors off; captures one stationary 0–180° ultrasonic sweep. | 13 samples at 15° increments. |
| `{"cmd":"motor_diagnostic","wheels_lifted":true}` | Tests each motor direction with off pauses. | Requires explicit wheel-up confirmation; 4-second watchdog. |
| `{"cmd":"stop"}` | Immediate driver standby / motor off. | Always available. |
| `{"cmd":"failsafe_status"}` or `{"cmd":"rover_status"}` | Requests the latest runtime and fail-safe state. | No motor action. |

Useful serial commands remain: `p` fixture connectivity, `a` I²C scan, `i`
sensor snapshot, `l` learn, `v` verify, `e` Explore, `d` 2-second straight
drive, `c` scan only, `m` wheel-up motor diagnostic, `f` fail-safe status, and
`s` immediate stop. Serial `m` is a local bench action; only use it with the
wheels lifted.

## Fail-safe status event

Normal packets continue to match `ml/schemas/telemetry.schema.json` unchanged.
The firmware also sends a small event frame after starts, avoidance, stops,
reconnects, and explicit status requests:

```json
{
  "ok": true,
  "event": "rover_status",
  "state": "stopped",
  "reason": "ultrasonic_obstacle",
  "detail": "obstacle too close",
  "recommended_action": "clear path or reposition rover before retrying",
  "run_id": "learn-12345",
  "runtime_mode": "learn",
  "timestamp": 12345
}
```

The receiver must whitelist and broadcast frames whose `event` is
`rover_status`; it should not write them into immutable telemetry JSONL files.
This keeps the telemetry contract backward-compatible while letting the
dashboard explain why a rover stopped and what the operator should do next.

## Honest limitation

The current MPU6050 is not detected. Pose and ML therefore use wheel-command
odometry plus ultrasonic/IR/temperature evidence; vibration and tilt are
reported as unavailable. Reinstalling the IMU later only requires enabling its
existing optional path.

Do not commit `firmware/secrets.h`; it contains local Wi-Fi credentials and is
already ignored by Git.
