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
- `main.ino`: WebSocket command handling, repeatable route, a front-facing
  85–95° servo micro-sweep in 5° steps (90° straight ahead), OLED status,
  10 Hz telemetry, and obstacle/WebSocket emergency stop.
- `health.h/.cpp`: obstacle and connection safety checks are evaluated before
  advancing the route.

## Commands

The dashboard sends `{"cmd":"learn"}`, `verify`, `stop`, `reset`, or
`run_route`. The laptop receiver relays commands to the ESP32 and broadcasts
valid telemetry packets back to the dashboard. Serial commands remain useful:
`p` fixture connectivity, `a` I²C scan, `i` sensor snapshot, `m` motor
diagnostic, `l` learn, `v` verify, and `s` stop.

## Honest limitation

The current MPU6050 is not detected. Pose and ML therefore use wheel-command
odometry plus ultrasonic/IR/temperature evidence; vibration and tilt are
reported as unavailable. Reinstalling the IMU later only requires enabling its
existing optional path.

Do not commit `firmware/secrets.h`; it contains local Wi-Fi credentials and is
already ignored by Git.
