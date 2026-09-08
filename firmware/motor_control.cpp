#include "motor_control.h"

#include <Arduino.h>

#include "hardware_config.h"

namespace {

constexpr uint8_t kPwmMax = 255;
constexpr uint16_t kStepMs = 400;
constexpr uint16_t kPauseMs = 300;

}  // namespace

void MotorController::begin() {
  pinMode(EchoPins::MotorPwmA, OUTPUT);
  pinMode(EchoPins::MotorAin1, OUTPUT);
  pinMode(EchoPins::MotorAin2, OUTPUT);
  pinMode(EchoPins::MotorStandby, OUTPUT);
  pinMode(EchoPins::MotorBin1, OUTPUT);
  pinMode(EchoPins::MotorBin2, OUTPUT);
  pinMode(EchoPins::MotorPwmB, OUTPUT);

  // Never enable the driver automatically. This protects the rover during
  // USB-only bring-up and while the board is booting.
  stop();
}

int16_t MotorController::clampSpeed(int16_t value) {
  if (value > kPwmMax) {
    return kPwmMax;
  }
  if (value < -kPwmMax) {
    return -kPwmMax;
  }
  return value;
}

void MotorController::setOne(uint8_t pwmPin, uint8_t in1, uint8_t in2,
                              int16_t speed) {
  speed = clampSpeed(speed);
  if (speed == 0) {
    analogWrite(pwmPin, 0);
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
    return;
  }

  if (speed > 0) {
    digitalWrite(in1, HIGH);
    digitalWrite(in2, LOW);
  } else {
    digitalWrite(in1, LOW);
    digitalWrite(in2, HIGH);
  }
  analogWrite(pwmPin, static_cast<uint8_t>(abs(speed)));
}

void MotorController::setSpeeds(int16_t left, int16_t right) {
  // Direction pins are set before standby is released. This prevents a
  // transient direction glitch from reaching the motor outputs.
  const int16_t electricalLeft = left * EchoPins::MotorADirectionSign;
  const int16_t electricalRight = right * EchoPins::MotorBDirectionSign;
  setOne(EchoPins::MotorPwmA, EchoPins::MotorAin1, EchoPins::MotorAin2, electricalLeft);
  setOne(EchoPins::MotorPwmB, EchoPins::MotorBin1, EchoPins::MotorBin2, electricalRight);
  digitalWrite(EchoPins::MotorStandby, (left == 0 && right == 0) ? LOW : HIGH);
}

void MotorController::stop() {
  analogWrite(EchoPins::MotorPwmA, 0);
  analogWrite(EchoPins::MotorPwmB, 0);
  digitalWrite(EchoPins::MotorAin1, LOW);
  digitalWrite(EchoPins::MotorAin2, LOW);
  digitalWrite(EchoPins::MotorBin1, LOW);
  digitalWrite(EchoPins::MotorBin2, LOW);
  digitalWrite(EchoPins::MotorStandby, LOW);
}

void MotorController::runDiagnostic(uint8_t pwm) {
  pwm = pwm > kPwmMax ? kPwmMax : pwm;

  // One motor at a time, low duty cycle, short duration. The caller must
  // ensure the wheels are lifted and the motor battery is connected.
  setSpeeds(pwm, 0);
  delay(kStepMs);
  stop();
  delay(kPauseMs);

  setSpeeds(-pwm, 0);
  delay(kStepMs);
  stop();
  delay(kPauseMs);

  setSpeeds(0, pwm);
  delay(kStepMs);
  stop();
  delay(kPauseMs);

  setSpeeds(0, -pwm);
  delay(kStepMs);
  stop();
}
