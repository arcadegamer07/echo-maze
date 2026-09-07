#pragma once

#include <stdint.h>

// Pure sweep scheduling logic. The eventual ESP32Servo/HC-SR04 adapter will
// move to each angle, wait settleMs, then attach its distance reading here.
struct ServoSweepConfig {
  uint16_t startAngleDeg = 0;
  uint16_t endAngleDeg = 180;
  uint16_t stepDeg = 15;
  uint16_t settleMs = 75;
};

class ServoSweepPlan {
 public:
  explicit ServoSweepPlan(const ServoSweepConfig& config = ServoSweepConfig{});

  bool configure(const ServoSweepConfig& config);
  void reset();
  bool nextAngle(uint16_t& angleDeg);
  bool complete() const;
  const ServoSweepConfig& config() const;

 private:
  ServoSweepConfig config_;
  uint16_t nextAngleDeg_ = 0;
  bool complete_ = true;
};
