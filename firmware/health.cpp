#include "health.h"

namespace {

void setStatus(HealthStatus& status, SafetyState state, SafetyCause cause,
               bool shouldStop, const char* reason) {
  status.state = state;
  status.cause = cause;
  status.shouldStop = shouldStop;
  status.reason = reason;
}

}  // namespace

const char* safetyCauseName(SafetyCause cause) {
  switch (cause) {
    case SafetyCause::UltrasonicObstacle:
      return "ultrasonic_obstacle";
    case SafetyCause::IrObstacle:
      return "ir_obstacle";
    case SafetyCause::TiltLimit:
      return "tilt_limit";
    case SafetyCause::MotorCurrentLimit:
      return "motor_current_limit";
    case SafetyCause::WebSocketHeartbeatLost:
      return "websocket_heartbeat_lost";
    case SafetyCause::CriticalBattery:
      return "critical_battery";
    case SafetyCause::LowBattery:
      return "low_battery";
    case SafetyCause::None:
    default:
      return "none";
  }
}

SafetySupervisor::SafetySupervisor(const HealthLimits& limits) : limits_(limits) {}

HealthStatus SafetySupervisor::evaluate(const HealthInputs& inputs) {
  setStatus(status_, SafetyState::Healthy, SafetyCause::None, false, "ok");

  if (inputs.obstacleValid && inputs.obstacleDistanceCm <= limits_.obstacleStopCm) {
    setStatus(status_, SafetyState::EmergencyStop,
              SafetyCause::UltrasonicObstacle, true, "obstacle too close");
  } else if (inputs.irValid && inputs.irObstacle) {
    setStatus(status_, SafetyState::EmergencyStop, SafetyCause::IrObstacle,
              true, "IR obstacle detected");
  } else if (inputs.tiltValid && inputs.tiltDeg >= limits_.maxTiltDeg) {
    setStatus(status_, SafetyState::EmergencyStop, SafetyCause::TiltLimit,
              true, "tilt limit exceeded");
  } else if (inputs.motorCurrentValid &&
             inputs.motorCurrentA >= limits_.maxMotorCurrentA) {
    setStatus(status_, SafetyState::EmergencyStop,
              SafetyCause::MotorCurrentLimit, true, "motor current too high");
  } else if (!inputs.websocketConnected ||
             inputs.nowMs - inputs.lastWebsocketActivityMs >= limits_.websocketTimeoutMs) {
    setStatus(status_, SafetyState::EmergencyStop,
              SafetyCause::WebSocketHeartbeatLost, true,
              "websocket heartbeat lost");
  } else if (inputs.batteryValid && inputs.batteryV <= limits_.criticalBatteryV) {
    setStatus(status_, SafetyState::EmergencyStop, SafetyCause::CriticalBattery,
              true, "battery critically low");
  } else if (inputs.batteryValid && inputs.batteryV <= limits_.lowBatteryV) {
    setStatus(status_, SafetyState::Degraded, SafetyCause::LowBattery, false,
              "battery low");
  }

  return status_;
}

bool SafetySupervisor::shouldStop() const {
  return status_.shouldStop;
}

SafetyState SafetySupervisor::state() const {
  return status_.state;
}

SafetyCause SafetySupervisor::cause() const {
  return status_.cause;
}

const char* SafetySupervisor::reason() const {
  return status_.reason;
}
