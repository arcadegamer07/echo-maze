# Firmware integration plan

The firmware currently proves Wi-Fi/WebSocket connectivity with a fixture
packet. The new small modules separate the pieces that can be tested now from
the hardware-specific work that must wait for wiring.

## Modules ready for integration

- `telemetry.h/.cpp`: one contract-safe sample structure and JSON serializer.
  `learn` and `verify` samples are rejected by `telemetrySampleValid()` unless
  they contain real IMU values. `test` automatically uses `source: "fixture"`.
- `command_protocol.h/.cpp`: recognizes the dashboard's
  `{"cmd":"learn"}`, `verify`, `stop`, `reset`, and `run_route` commands.
- `route.h/.cpp`: deterministic iterator for a pre-programmed movement/scan
  route. It performs no motor I/O itself.
- `servo_scan.h/.cpp`: deterministic angle plan. The eventual servo driver
  should wait `settleMs` (default 75 ms) before each ultrasonic ping.
- `sensors.h/.cpp`: callback boundary for the actual IMU, IR, and temperature
  libraries.
- `health.h/.cpp`: safety supervisor for obstacle distance, tilt, current,
  battery, and a lost WebSocket heartbeat. A `shouldStop` result must be acted
  on before any queued route command.

## Hardware work still required

1. Confirm the exact ESP32 board pins and sensor part numbers.
2. Add the selected libraries (for example ESP32Servo, Adafruit MPU6050, and
   the OLED library) to `platformio.ini` only after those choices are fixed.
3. Implement callbacks in `sensors.cpp` and the actual servo/ultrasonic adapter.
4. Make `main.ino` run one fixed route for both learn and verify modes.
5. Call the safety supervisor every loop and immediately stop the motors on a
   stop condition.
6. Send one telemetry sample per reading, using a unique `run_id` and a
   monotonic millisecond timestamp.

Do not commit `firmware/secrets.h`; it contains local Wi-Fi credentials and is
already ignored by Git.
