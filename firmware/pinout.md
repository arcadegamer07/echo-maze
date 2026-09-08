# Echo-Maze hardware pin map

This is the logical pin assignment for the ESP32 Dev Module used by Echo-Maze.
Treat it as the source of truth for firmware. Do not change a GPIO in a driver
without updating this file and reviewing the wiring first.

## Motor driver: TB6612FNG

| TB6612FNG pin | ESP32 GPIO | Purpose |
|---|---:|---|
| PWMA | 14 | Motor A PWM |
| AIN1 | 27 | Motor A direction 1 |
| AIN2 | 26 | Motor A direction 2 |
| STBY | 5 | Driver standby (must be high to run) |
| BIN1 | 25 | Motor B direction 1 |
| BIN2 | 2 | Motor B direction 2 |
| PWMB | 15 | Motor B PWM |
| VCC | 3V3 | Logic supply |
| GND | GND | Common ground |
| VM | motor battery + | Motor supply |

AO1/AO2 connect to Motor 1. BO1/BO2 connect to Motor 2. Motor battery
negative connects to the common ground.

The assembled chassis uses inverted electrical polarity on both motor
channels, so firmware logical `+speed` is calibrated as physical forward.
That calibration is kept in `hardware_config.h` and applies consistently to
manual commands, Explore, Learn/Verify routes, and diagnostics.

## I2C bus

| Device pin | ESP32 GPIO |
|---|---:|
| SDA (OLED + MPU6050) | 21 |
| SCL/SCK (OLED + MPU6050) | 22 |
| VCC/VDD | 3V3 |
| GND | GND |

The OLED and MPU6050 intentionally share the I2C bus. Leave MPU6050 XDA,
XCL, AD0, and INT disconnected unless a later design explicitly uses them.
The usual addresses are OLED `0x3C` and MPU6050 `0x68`; firmware must scan and
report the actual address instead of silently assuming it.

## Other sensors and actuator

| Device | Signal | ESP32 GPIO / supply |
|---|---|---|
| DHT11 module | DATA | GPIO 4 / 3V3 |
| IR obstacle module | OUT | GPIO 34 / 3V3 |
| SG90 servo | signal | GPIO 13 / separate 5V supply |
| HC-SR04 | TRIG | GPIO 32 / 5V module supply |
| HC-SR04 | ECHO | GPIO 33 through a divider / 5V module supply |

GPIO 34 is input-only, which is appropriate for the IR output. The servo must
not be powered from the ESP32 3V3 pin. The HC-SR04 ECHO line must not be wired
directly to an ESP32 GPIO: use 1 kΩ from ECHO to the GPIO node and 2 kΩ from
that node to GND (about 3.3 V at the GPIO when ECHO is high).

## Boot and power precautions

- GPIO 2 and GPIO 5 are ESP32 boot-strapping pins. Keep TB6612 inputs from
  adding a pull-up during reset; initialize the motor driver in a stopped state
  and keep `STBY` low until setup has completed.
- All grounds must be common, including the separate 5V servo supply and
  motor-battery negative.
- Do not connect the 3.7V motor battery directly to OLED/IMU/DHT/IR VCC.
- Do not plug or unplug powered sensor wires. Verify the physical breadboard
  holes against a clear wiring photo before applying battery power.
