#pragma once

#include <stdint.h>

enum class SafetyState : uint8_t {
  Unknown,
  Healthy,
  Degraded,
  EmergencyStop,
};

struct HealthLimits {
  // Learn/Verify route: stop only when a confirmed obstacle is very close.
  // Explore uses its own earlier avoidance threshold in main.ino so it can
  // reverse/turn and continue instead of ending the run.
  float obstacleStopCm = 10.0f;
  float criticalBatteryV = 6.4f;
  float lowBatteryV = 6.8f;
  float maxTiltDeg = 35.0f;
  float maxMotorCurrentA = 3.0f;
  uint32_t websocketTimeoutMs = 2000;
};

struct HealthInputs {
  bool obstacleValid = false;
  float obstacleDistanceCm = 0.0f;
  bool batteryValid = false;
  float batteryV = 0.0f;
  bool tiltValid = false;
  float tiltDeg = 0.0f;
  bool motorCurrentValid = false;
  float motorCurrentA = 0.0f;
  bool websocketConnected = false;
  uint32_t nowMs = 0;
  uint32_t lastWebsocketActivityMs = 0;
};

struct HealthStatus {
  SafetyState state = SafetyState::Unknown;
  bool shouldStop = false;
  const char* reason = "not evaluated";
};

class SafetySupervisor {
 public:
  explicit SafetySupervisor(const HealthLimits& limits = HealthLimits{});

  HealthStatus evaluate(const HealthInputs& inputs);
  bool shouldStop() const;
  SafetyState state() const;
  const char* reason() const;

 private:
  HealthLimits limits_;
  HealthStatus status_;
};
