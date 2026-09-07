#pragma once

#include <stdint.h>

struct MotorCommand {
  int16_t left = 0;
  int16_t right = 0;
};

class MotorController {
 public:
  void begin();
  void stop();
  void setSpeeds(int16_t left, int16_t right);
  void runDiagnostic(uint8_t pwm = 70);

 private:
  static int16_t clampSpeed(int16_t value);
  void setOne(uint8_t pwmPin, uint8_t in1, uint8_t in2, int16_t speed);
};
