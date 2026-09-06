# Echo-Maze Pinout

## ESP32

Board:
TBD

## Motor Driver

Assumed driver:
L298N or compatible

| Function        | Temporary GPIO | Actual GPIO |
| --------------- | -------------: | ----------: |
| Left IN1        |             25 |         TBD |
| Left IN2        |             26 |         TBD |
| Left PWM / ENA  |             32 |         TBD |
| Right IN1       |             27 |         TBD |
| Right IN2       |             14 |         TBD |
| Right PWM / ENB |             33 |         TBD |

## Important

ESP32 GND and motor driver GND must be connected together.

Do not power motors directly from the ESP32.

## Motor Orientation

Forward test completed: [ ]

Reverse test completed: [ ]

Left turn test completed: [ ]

Right turn test completed: [ ]

## Future Hardware

Servo:
TBD

Distance sensor:
TBD

IMU:
TBD

Display:
TBD
