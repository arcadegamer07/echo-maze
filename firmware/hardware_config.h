#pragma once

#include <stdint.h>

// Echo-Maze ESP32 Dev Module logical pin assignment.
// Keep wiring and firmware synchronized through firmware/pinout.md.
namespace EchoPins {
// Logical positive speed must mean physical forward for the current chassis
// assembly. Keep this calibration here (rather than hiding it in one runtime
// mode) so route driving, diagnostics, telemetry, and safety stops share the
// same convention. If the motor leads are rewired, change these signs only
// after a wheels-lifted direction check.
constexpr int8_t MotorADirectionSign = 1;
constexpr int8_t MotorBDirectionSign = 1;

constexpr uint8_t MotorPwmA = 14;
constexpr uint8_t MotorAin1 = 27;
constexpr uint8_t MotorAin2 = 26;
constexpr uint8_t MotorStandby = 5;
constexpr uint8_t MotorBin1 = 25;
constexpr uint8_t MotorBin2 = 2;
constexpr uint8_t MotorPwmB = 15;

constexpr uint8_t I2cSda = 21;
constexpr uint8_t I2cScl = 22;

constexpr uint8_t DhtData = 4;
constexpr uint8_t IrAnalog = 34;
constexpr uint8_t ServoSignal = 13;
constexpr uint8_t UltrasonicTrig = 32;
constexpr uint8_t UltrasonicEcho = 33;
}

namespace EchoAddresses {
constexpr uint8_t Oled = 0x3C;
constexpr uint8_t Mpu6050 = 0x68;
}
