#include "health.h"

namespace {

void setStatus(HealthStatus& status, SafetyState state, bool shouldStop,
               const char* reason) {
  status.state = state;
  status.shouldStop = shouldStop;
  status.reason = reason;
}

}  // namespace

SafetySupervisor::SafetySupervisor(const HealthLimits& limits) : limits_(limits) {}

HealthStatus SafetySupervisor::evaluate(const HealthInputs& inputs) {
  setStatus(status_, SafetyState::Healthy, false, "ok");

  if (inputs.obstacleValid && inputs.obstacleDistanceCm <= limits_.obstacleStopCm) {
    setStatus(status_, SafetyState::EmergencyStop, true, "obstacle too close");
  } else if (inputs.tiltValid && inputs.tiltDeg >= limits_.maxTiltDeg) {
    setStatus(status_, SafetyState::EmergencyStop, true, "tilt limit exceeded");
  } else if (inputs.motorCurrentValid &&
             inputs.motorCurrentA >= limits_.maxMotorCurrentA) {
    setStatus(status_, SafetyState::EmergencyStop, true, "motor current too high");
  } else if (!inputs.websocketConnected &&
             inputs.nowMs - inputs.lastWebsocketActivityMs >= limits_.websocketTimeoutMs) {
    setStatus(status_, SafetyState::EmergencyStop, true, "websocket heartbeat lost");
  } else if (inputs.batteryValid && inputs.batteryV <= limits_.criticalBatteryV) {
    setStatus(status_, SafetyState::EmergencyStop, true, "battery critically low");
  } else if (inputs.batteryValid && inputs.batteryV <= limits_.lowBatteryV) {
    setStatus(status_, SafetyState::Degraded, false, "battery low");
  }

  return status_;
}

bool SafetySupervisor::shouldStop() const {
  return status_.shouldStop;
}

SafetyState SafetySupervisor::state() const {
  return status_.state;
}

const char* SafetySupervisor::reason() const {
  return status_.reason;
}
