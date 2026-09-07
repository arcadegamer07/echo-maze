#include "servo_scan.h"

ServoSweepPlan::ServoSweepPlan(const ServoSweepConfig& config) {
  configure(config);
}

bool ServoSweepPlan::configure(const ServoSweepConfig& config) {
  if (config.stepDeg == 0 || config.startAngleDeg > config.endAngleDeg ||
      config.endAngleDeg > 180) {
    return false;
  }
  config_ = config;
  reset();
  return true;
}

void ServoSweepPlan::reset() {
  nextAngleDeg_ = config_.startAngleDeg;
  complete_ = false;
}

bool ServoSweepPlan::nextAngle(uint16_t& angleDeg) {
  if (complete_) {
    return false;
  }
  angleDeg = nextAngleDeg_;
  if (nextAngleDeg_ >= config_.endAngleDeg ||
      config_.endAngleDeg - nextAngleDeg_ < config_.stepDeg) {
    complete_ = true;
  } else {
    nextAngleDeg_ += config_.stepDeg;
  }
  return true;
}

bool ServoSweepPlan::complete() const {
  return complete_;
}

const ServoSweepConfig& ServoSweepPlan::config() const {
  return config_;
}
