#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <WebSocketsClient.h>
#include <ESP32Servo.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include "command_protocol.h"
#include "secrets.h"
#include "hardware_config.h"
#include "health.h"
#include "motor_control.h"
#include "sensors.h"
#include "telemetry.h"

// Every motor-capable command is bounded and requires a live receiver link.
// A lost heartbeat, receiver disconnect, obstacle, or operator stop converges
// on stopRover(), which emits a machine-readable rover_status event.

WebSocketsClient webSocket;
MotorController motorController;
SensorSuite sensorSuite;
SafetySupervisor safety;
Servo turretServo;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

enum class RuntimeMode : uint8_t {
  Idle, Route, Explore, DriveStraight, ScanOnly, MotorDiagnostic,
};

enum class StopReason : uint8_t {
  None,
  OperatorStop,
  CommandSuperseded,
  UltrasonicObstacle,
  IrObstacle,
  WebSocketLoss,
  RouteComplete,
  ExploreComplete,
  DriveComplete,
  ScanComplete,
  MotorDiagnosticComplete,
  BatteryCritical,
  TiltLimit,
  MotorCurrentLimit,
  Reset,
  DiagnosticWatchdog,
};

enum class ExplorePhase : uint8_t { Forward, Reverse, Turn };

struct RouteStep { int16_t left; int16_t right; uint32_t durationMs; };
struct DiagnosticStep { int16_t left; int16_t right; uint32_t durationMs; };

bool webSocketConnected = false;
bool oledReady = false;
// Inbound traffic only. Outbound telemetry must not masquerade as a heartbeat.
uint32_t lastWebSocketActivityMs = 0;
uint32_t lastTelemetryMs = 0;
int16_t commandedLeft = 0;
int16_t commandedRight = 0;
uint32_t commandDurationMs = 0;
String activeRunId;
String lastFinishedRunId;
TelemetryMode activeMode = TelemetryMode::Test;
RuntimeMode activeRuntimeMode = RuntimeMode::Idle;
StopReason lastStopReason = StopReason::None;
String lastStopDetail = "ready";
uint32_t lastStopAtMs = 0;
int16_t lastTurretAngle = -1;

bool routeActive = false;
uint8_t routeStep = 0;
uint32_t routeStepStartedMs = 0;

bool exploreActive = false;
ExplorePhase explorePhase = ExplorePhase::Forward;
uint32_t exploreDeadlineMs = 0;
uint32_t explorePhaseStartedMs = 0;
uint32_t lastExploreCheckMs = 0;
uint8_t exploreInvalidDistanceReads = 0;
bool exploreTurnRight = true;

bool driveStraightActive = false;
uint32_t driveStraightDeadlineMs = 0;

bool scanOnlyActive = false;
uint8_t scanIndex = 0;
uint8_t scanFramesSent = 0;

bool motorDiagnosticActive = false;
uint8_t diagnosticStep = 0;
uint32_t diagnosticStepStartedMs = 0;
uint32_t diagnosticDeadlineMs = 0;

constexpr uint32_t kTelemetryPeriodMs = 100UL;
constexpr uint32_t kWebSocketTimeoutMs = 2000UL;
constexpr uint32_t kServoSettleMs = 60UL;
constexpr uint8_t kSweepFrameCount = 13U;  // 0, 15, ..., 180.

constexpr uint32_t kExploreMaxDurationMs = 30000UL;
constexpr uint32_t kExploreDefaultDurationMs = 10000UL;
constexpr uint32_t kExploreCheckPeriodMs = 120UL;
constexpr uint32_t kExploreReverseMs = 400UL;
constexpr uint32_t kExploreTurnMs = 560UL;
constexpr float kExploreObstacleCm = 22.0f;
constexpr uint8_t kExploreInvalidReadLimit = 3U;

constexpr uint32_t kDriveStraightDefaultDurationMs = 2000UL;
constexpr uint32_t kDriveStraightMaxDurationMs = 10000UL;
constexpr int16_t kDriveForwardSpeed = 230;
constexpr int16_t kDriveReverseSpeed = -220;
constexpr int16_t kDriveTurnSpeed = 220;
constexpr int16_t kDriveStraightMinSpeed = 180;
constexpr int16_t kDriveStraightMaxSpeed = 245;
constexpr int16_t kDiagnosticSpeed = 210;

// Repeatable Learn / Verify survey route.
const RouteStep kRoute[] = {
    {0, 0, 700},
    {kDriveForwardSpeed, kDriveForwardSpeed, 600}, {0, 0, 450}, {kDriveTurnSpeed, -kDriveTurnSpeed, 330}, {0, 0, 450},
    {kDriveForwardSpeed, kDriveForwardSpeed, 600}, {0, 0, 450}, {kDriveTurnSpeed, -kDriveTurnSpeed, 330}, {0, 0, 450},
    {kDriveForwardSpeed, kDriveForwardSpeed, 600}, {0, 0, 450}, {kDriveTurnSpeed, kDriveTurnSpeed, 330}, {0, 0, 450},
    {kDriveForwardSpeed, kDriveForwardSpeed, 600}, {0, 0, 450}, {kDriveTurnSpeed, kDriveTurnSpeed, 330}, {0, 0, 450},
    {kDriveReverseSpeed, kDriveReverseSpeed, 420}, {0, 0, 600}, {kDriveTurnSpeed, -kDriveTurnSpeed, 330}, {0, 0, 650},
};
constexpr uint8_t kRouteLength = sizeof(kRoute) / sizeof(kRoute[0]);

// Non-blocking wheel-up test. Every powered interval is followed by a pause,
// and its watchdog is shorter than the maximum normal command duration.
const DiagnosticStep kDiagnostic[] = {
    {kDiagnosticSpeed, 0, 350}, {0, 0, 250},
    {-kDiagnosticSpeed, 0, 350}, {0, 0, 250},
    {0, kDiagnosticSpeed, 350}, {0, 0, 250},
    {0, -kDiagnosticSpeed, 350},
};
constexpr uint8_t kDiagnosticLength = sizeof(kDiagnostic) / sizeof(kDiagnostic[0]);
constexpr uint32_t kDiagnosticWatchdogMs = 4000UL;

const char* runtimeModeName(RuntimeMode mode) {
  switch (mode) {
    case RuntimeMode::Route: return activeMode == TelemetryMode::Verify ? "verify" : "learn";
    case RuntimeMode::Explore: return "explore";
    case RuntimeMode::DriveStraight: return "drive_straight";
    case RuntimeMode::ScanOnly: return "scan_only";
    case RuntimeMode::MotorDiagnostic: return "motor_diagnostic";
    case RuntimeMode::Idle:
    default: return "idle";
  }
}

const char* stopReasonName(StopReason reason) {
  switch (reason) {
    case StopReason::OperatorStop: return "operator_stop";
    case StopReason::CommandSuperseded: return "command_superseded";
    case StopReason::UltrasonicObstacle: return "ultrasonic_obstacle";
    case StopReason::IrObstacle: return "ir_obstacle";
    case StopReason::WebSocketLoss: return "websocket_loss";
    case StopReason::RouteComplete: return "route_complete";
    case StopReason::ExploreComplete: return "explore_complete";
    case StopReason::DriveComplete: return "drive_complete";
    case StopReason::ScanComplete: return "scan_complete";
    case StopReason::MotorDiagnosticComplete: return "motor_diagnostic_complete";
    case StopReason::BatteryCritical: return "battery_critical";
    case StopReason::TiltLimit: return "tilt_limit";
    case StopReason::MotorCurrentLimit: return "motor_current_limit";
    case StopReason::Reset: return "reset";
    case StopReason::DiagnosticWatchdog: return "diagnostic_watchdog";
    case StopReason::None:
    default: return "none";
  }
}

const char* recommendedAction(StopReason reason) {
  switch (reason) {
    case StopReason::UltrasonicObstacle:
    case StopReason::IrObstacle:
      return "clear path or reposition rover before retrying";
    case StopReason::WebSocketLoss:
      return "restore receiver link before starting another motion command";
    case StopReason::BatteryCritical:
      return "charge or replace battery before retrying";
    case StopReason::TiltLimit:
      return "place rover on a stable surface and inspect its orientation";
    case StopReason::MotorCurrentLimit:
      return "inspect drivetrain for a jam before retrying";
    case StopReason::DiagnosticWatchdog:
      return "keep wheels lifted and inspect motor driver wiring";
    case StopReason::RouteComplete:
    case StopReason::ExploreComplete:
    case StopReason::DriveComplete:
    case StopReason::ScanComplete:
    case StopReason::MotorDiagnosticComplete:
      return "review captured data; rover is safe and stopped";
    case StopReason::OperatorStop:
    case StopReason::CommandSuperseded:
    case StopReason::Reset:
      return "await the next operator command";
    case StopReason::None:
    default:
      return "continue supervised operation";
  }
}

bool runtimeActive() {
  return routeActive || exploreActive || driveStraightActive || scanOnlyActive || motorDiagnosticActive;
}

bool usesForwardTurret() {
  return exploreActive || driveStraightActive || motorDiagnosticActive;
}

String jsonEscape(const String& value) {
  String escaped;
  escaped.reserve(value.length() + 8);
  for (uint16_t index = 0; index < value.length(); ++index) {
    const char valueChar = value.charAt(index);
    if (valueChar == '\\' || valueChar == '\"') escaped += '\\';
    if (valueChar == '\n' || valueChar == '\r') escaped += ' ';
    else escaped += valueChar;
  }
  return escaped;
}

void showStatus(const char* title, const char* detail = nullptr) {
  if (!oledReady) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("ECHO-MAZE");
  oled.setTextSize(2);
  oled.setCursor(0, 16);
  oled.println(title);
  oled.setTextSize(1);
  oled.setCursor(0, 48);
  if (detail != nullptr) oled.println(detail);
  oled.display();
}

void sendAck(bool ok, const String& message) {
  if (!webSocketConnected) return;
  String ack = String("{\"ok\":") + (ok ? "true" : "false") +
               ",\"message\":\"" + jsonEscape(message) + "\"}";
  webSocket.sendTXT(ack);
}

// Status frames are intentionally separate from immutable telemetry packets.
// The receiver can whitelist/broadcast event=rover_status without loosening
// the existing telemetry JSON schema or mutating raw run logs.
void sendRuntimeStatus(const char* state, StopReason reason, const String& runId,
                       RuntimeMode runtimeMode, const String& detail) {
  if (!webSocketConnected) return;
  String event = "{\"ok\":true,\"event\":\"rover_status\",\"state\":\"";
  event += state;
  event += "\",\"reason\":\"";
  event += stopReasonName(reason);
  event += "\",\"detail\":\"";
  event += jsonEscape(detail);
  event += "\",\"recommended_action\":\"";
  event += recommendedAction(reason);
  event += "\",\"run_id\":\"";
  event += jsonEscape(runId);
  event += "\",\"runtime_mode\":\"";
  event += runtimeModeName(runtimeMode);
  event += "\",\"timestamp\":";
  event += String(millis());
  event += "}";
  webSocket.sendTXT(event);
}

void setMotors(int16_t left, int16_t right, uint32_t durationMs) {
  commandedLeft = left;
  commandedRight = right;
  commandDurationMs = durationMs;
  motorController.setSpeeds(left, right);
}

void orientTurret(uint8_t angle) {
  if (lastTurretAngle == static_cast<int16_t>(angle)) return;
  turretServo.write(angle);
  lastTurretAngle = angle;
  delay(kServoSettleMs);
}

void sendTelemetryFor(const String& runId, TelemetryMode mode, uint8_t angle,
                      int16_t leftSpeed, int16_t rightSpeed, uint32_t durationMs) {
  if (!webSocketConnected || runId.length() == 0) return;
  SensorReadings readings;
  sensorSuite.read(readings);
  TelemetrySample sample;
  sample.runId = runId.c_str();
  sample.timestampMs = millis();
  sample.mode = mode;
  sample.leftSpeed = leftSpeed;
  sample.rightSpeed = rightSpeed;
  sample.motorDurationMs = durationMs;
  sample.scanAngleDeg = static_cast<float>(angle);
  sample.distanceValid = readings.distanceValid;
  sample.distanceCm = readings.distanceCm;
  // Do not invent IMU data before the physical board is validated.
  sample.imuValid = false;
  sample.irValid = readings.irValid;
  sample.ir = readings.ir;
  sample.tempValid = readings.tempValid;
  sample.tempC = readings.tempC;
  if (telemetrySampleValid(sample)) {
    String packet = buildTelemetryJson(sample);
    webSocket.sendTXT(packet);
  }
}

void sendTerminalTelemetry(const String& runId, TelemetryMode mode) {
  const uint8_t angle = lastTurretAngle >= 0 ? static_cast<uint8_t>(lastTurretAngle) : 90U;
  sendTelemetryFor(runId, mode, angle, 0, 0, 0);
}

void stopRover(StopReason reason, const char* detail = nullptr) {
  const bool wasActive = runtimeActive();
  const String stoppedRunId = activeRunId;
  const TelemetryMode stoppedTelemetryMode = activeMode;
  const RuntimeMode stoppedRuntimeMode = activeRuntimeMode;
  motorController.stop();
  commandedLeft = 0;
  commandedRight = 0;
  commandDurationMs = 0;
  routeActive = false;
  exploreActive = false;
  driveStraightActive = false;
  scanOnlyActive = false;
  motorDiagnosticActive = false;
  activeRuntimeMode = RuntimeMode::Idle;
  lastStopReason = reason;
  lastStopDetail = detail != nullptr ? String(detail) : String(stopReasonName(reason));
  lastStopAtMs = millis();
  if (stoppedRunId.length() > 0) lastFinishedRunId = stoppedRunId;
  if (wasActive && webSocketConnected && stoppedRunId.length() > 0) {
    // Legacy viewers see the zero-motion terminal packet even before they
    // adopt rover_status events.
    sendTerminalTelemetry(stoppedRunId, stoppedTelemetryMode);
  }
  showStatus("STOPPED", lastStopDetail.c_str());
  Serial.print("ROVER STOPPED [");
  Serial.print(stopReasonName(reason));
  Serial.print("]: ");
  Serial.println(lastStopDetail);
  if (webSocketConnected) {
    sendRuntimeStatus("stopped", reason, stoppedRunId, stoppedRuntimeMode, lastStopDetail);
    sendAck(true, String("stopped: ") + stopReasonName(reason));
  }
  activeRunId = "";
}

bool prepareRuntime(const char* requestedMode) {
  if (!webSocketConnected) {
    motorController.stop();
    lastStopReason = StopReason::WebSocketLoss;
    lastStopDetail = "receiver link required before motion";
    showStatus("OFFLINE", "link required");
    Serial.print("Rejected ");
    Serial.print(requestedMode);
    Serial.println(": WebSocket receiver is not connected");
    return false;
  }
  if (runtimeActive()) stopRover(StopReason::CommandSuperseded, "replaced by new command");
  return true;
}

void markRuntimeStarted(const String& runId, RuntimeMode runtimeMode,
                        TelemetryMode telemetryMode, const char* displayTitle,
                        const char* displayDetail) {
  activeRunId = runId;
  activeRuntimeMode = runtimeMode;
  activeMode = telemetryMode;
  lastStopReason = StopReason::None;
  lastStopDetail = "runtime active";
  showStatus(displayTitle, displayDetail);
  sendRuntimeStatus("started", StopReason::None, activeRunId, activeRuntimeMode, displayDetail);
  sendAck(true, String(runtimeModeName(activeRuntimeMode)) + " started");
}

uint32_t durationFromCommand(const String& payload, const char* key, uint32_t fallback, uint32_t maximum) {
  const String needle = String("\"") + key + "\"";
  const int keyAt = payload.indexOf(needle);
  if (keyAt < 0) return fallback;
  const int colonAt = payload.indexOf(':', keyAt + needle.length());
  if (colonAt < 0) return fallback;
  const long requested = payload.substring(colonAt + 1).toInt();
  if (requested <= 0) return fallback;
  const uint32_t duration = static_cast<uint32_t>(requested);
  return duration > maximum ? maximum : duration;
}

int16_t forwardSpeedFromCommand(const String& payload) {
  const int keyAt = payload.indexOf("\"speed\"");
  if (keyAt < 0) return kDriveForwardSpeed;
  const int colonAt = payload.indexOf(':', keyAt + 7);
  if (colonAt < 0) return kDriveForwardSpeed;
  const long requested = payload.substring(colonAt + 1).toInt();
  if (requested < kDriveStraightMinSpeed) return kDriveStraightMinSpeed;
  if (requested > kDriveStraightMaxSpeed) return kDriveStraightMaxSpeed;
  return static_cast<int16_t>(requested);
}

bool booleanTrueFromCommand(const String& payload, const char* key) {
  const String needle = String("\"") + key + "\"";
  const int keyAt = payload.indexOf(needle);
  if (keyAt < 0) return false;
  const int colonAt = payload.indexOf(':', keyAt + needle.length());
  if (colonAt < 0) return false;
  String value = payload.substring(colonAt + 1);
  value.trim();
  return value.startsWith("true");
}

void startRun(TelemetryMode mode) {
  if (!prepareRuntime(mode == TelemetryMode::Learn ? "learn" : "verify")) return;
  routeActive = true;
  routeStep = 0;
  routeStepStartedMs = millis();
  scanIndex = 0;
  markRuntimeStarted(String(mode == TelemetryMode::Learn ? "learn-" : "verify-") + String(millis()),
                     RuntimeMode::Route, mode,
                     mode == TelemetryMode::Learn ? "LEARN" : "VERIFY", "route active");
  setMotors(kRoute[0].left, kRoute[0].right, kRoute[0].durationMs);
}

void startExplore(uint32_t durationMs) {
  if (!prepareRuntime("explore")) return;
  const uint32_t boundedDuration = durationMs > kExploreMaxDurationMs ? kExploreMaxDurationMs : durationMs;
  exploreActive = true;
  explorePhase = ExplorePhase::Forward;
  explorePhaseStartedMs = millis();
  exploreDeadlineMs = explorePhaseStartedMs + boundedDuration;
  lastExploreCheckMs = explorePhaseStartedMs;
  exploreInvalidDistanceReads = 0;
  markRuntimeStarted(String("explore-") + String(millis()), RuntimeMode::Explore,
                     TelemetryMode::Explore, "EXPLORE", "forward / guarded");
  orientTurret(90);
  setMotors(kDriveForwardSpeed, kDriveForwardSpeed, 0);
}

void startDriveStraight(uint32_t durationMs, int16_t speed) {
  if (!prepareRuntime("drive_straight")) return;
  driveStraightActive = true;
  driveStraightDeadlineMs = millis() + durationMs;
  markRuntimeStarted(String("drive-") + String(millis()), RuntimeMode::DriveStraight,
                     TelemetryMode::Explore, "DRIVE", "straight / guarded");
  orientTurret(90);
  setMotors(speed, speed, durationMs);
}

void startScanOnly() {
  if (!prepareRuntime("scan_only")) return;
  scanOnlyActive = true;
  scanIndex = 0;
  scanFramesSent = 0;
  markRuntimeStarted(String("scan-") + String(millis()), RuntimeMode::ScanOnly,
                     TelemetryMode::Explore, "SCAN ONLY", "stationary sweep");
  motorController.stop();
  commandedLeft = 0;
  commandedRight = 0;
  commandDurationMs = 0;
}

void startMotorDiagnostic() {
  if (!prepareRuntime("motor_diagnostic")) return;
  motorDiagnosticActive = true;
  diagnosticStep = 0;
  diagnosticStepStartedMs = millis();
  diagnosticDeadlineMs = diagnosticStepStartedMs + kDiagnosticWatchdogMs;
  markRuntimeStarted(String("motor-diagnostic-") + String(millis()), RuntimeMode::MotorDiagnostic,
                     TelemetryMode::Explore, "MOTOR TEST", "wheels lifted");
  orientTurret(90);
  setMotors(kDiagnostic[0].left, kDiagnostic[0].right, kDiagnostic[0].durationMs);
}

StopReason stopReasonFromSafety(SafetyCause cause) {
  switch (cause) {
    case SafetyCause::UltrasonicObstacle: return StopReason::UltrasonicObstacle;
    case SafetyCause::IrObstacle: return StopReason::IrObstacle;
    case SafetyCause::WebSocketHeartbeatLost: return StopReason::WebSocketLoss;
    case SafetyCause::CriticalBattery: return StopReason::BatteryCritical;
    case SafetyCause::TiltLimit: return StopReason::TiltLimit;
    case SafetyCause::MotorCurrentLimit: return StopReason::MotorCurrentLimit;
    case SafetyCause::LowBattery:
    case SafetyCause::None:
    default: return StopReason::WebSocketLoss;
  }
}

bool stopIfUnsafeForStraightMotion(uint32_t now) {
  SensorReadings readings;
  sensorSuite.read(readings);
  HealthInputs inputs;
  inputs.obstacleValid = readings.distanceValid;
  inputs.obstacleDistanceCm = readings.distanceCm;
  inputs.irValid = readings.irValid;
  inputs.irObstacle = readings.irValid && readings.ir < 0.5f;
  inputs.websocketConnected = webSocketConnected;
  inputs.nowMs = now;
  inputs.lastWebsocketActivityMs = lastWebSocketActivityMs;
  const HealthStatus health = safety.evaluate(inputs);
  if (!health.shouldStop) return false;
  stopRover(stopReasonFromSafety(health.cause), health.reason);
  return true;
}

void beginExploreAvoidance(uint32_t now, StopReason reason, const char* detail) {
  explorePhase = ExplorePhase::Reverse;
  explorePhaseStartedMs = now;
  exploreInvalidDistanceReads = 0;
  setMotors(kDriveReverseSpeed, kDriveReverseSpeed, kExploreReverseMs);
  showStatus("EXPLORE", "obstacle / reverse");
  sendRuntimeStatus("avoiding", reason, activeRunId, activeRuntimeMode, detail);
  Serial.print("Explore avoidance: ");
  Serial.println(detail);
}

void updateRoute(uint32_t now) {
  if (!routeActive) return;
  if (stopIfUnsafeForStraightMotion(now)) return;
  if (now - routeStepStartedMs < kRoute[routeStep].durationMs) return;
  ++routeStep;
  if (routeStep >= kRouteLength) {
    stopRover(StopReason::RouteComplete, "repeatable route complete");
    return;
  }
  routeStepStartedMs = now;
  setMotors(kRoute[routeStep].left, kRoute[routeStep].right, kRoute[routeStep].durationMs);
}

void updateExplore(uint32_t now) {
  if (!exploreActive) return;
  if (static_cast<int32_t>(now - exploreDeadlineMs) >= 0) {
    stopRover(StopReason::ExploreComplete, "bounded explore complete");
    return;
  }
  if (explorePhase == ExplorePhase::Forward && now - lastExploreCheckMs >= kExploreCheckPeriodMs) {
    lastExploreCheckMs = now;
    SensorReadings readings;
    sensorSuite.read(readings);
    const bool irObstacle = readings.irValid && readings.ir < 0.5f;
    if (!readings.distanceValid) {
      if (exploreInvalidDistanceReads < 255U) ++exploreInvalidDistanceReads;
    } else {
      exploreInvalidDistanceReads = 0;
    }
    const bool ultrasonicObstacle =
        (readings.distanceValid && readings.distanceCm <= kExploreObstacleCm) ||
        exploreInvalidDistanceReads >= kExploreInvalidReadLimit;
    if (irObstacle) {
      beginExploreAvoidance(now, StopReason::IrObstacle, "IR obstacle detected");
      return;
    }
    if (ultrasonicObstacle) {
      beginExploreAvoidance(now, StopReason::UltrasonicObstacle,
                            readings.distanceValid ? "ultrasonic obstacle" : "ultrasonic no-echo guard");
      return;
    }
  }
  if (explorePhase == ExplorePhase::Reverse && now - explorePhaseStartedMs >= kExploreReverseMs) {
    explorePhase = ExplorePhase::Turn;
    explorePhaseStartedMs = now;
    exploreTurnRight = !exploreTurnRight;
    setMotors(exploreTurnRight ? kDriveTurnSpeed : -kDriveTurnSpeed,
              exploreTurnRight ? -kDriveTurnSpeed : kDriveTurnSpeed, kExploreTurnMs);
    showStatus("EXPLORE", exploreTurnRight ? "turn right" : "turn left");
    return;
  }
  if (explorePhase == ExplorePhase::Turn && now - explorePhaseStartedMs >= kExploreTurnMs) {
    explorePhase = ExplorePhase::Forward;
    explorePhaseStartedMs = now;
    lastExploreCheckMs = now;
    exploreInvalidDistanceReads = 0;
    setMotors(kDriveForwardSpeed, kDriveForwardSpeed, 0);
    showStatus("EXPLORE", "forward / guarded");
  }
}

void updateDriveStraight(uint32_t now) {
  if (!driveStraightActive) return;
  if (static_cast<int32_t>(now - driveStraightDeadlineMs) >= 0) {
    stopRover(StopReason::DriveComplete, "bounded straight drive complete");
    return;
  }
  stopIfUnsafeForStraightMotion(now);
}

void updateMotorDiagnostic(uint32_t now) {
  if (!motorDiagnosticActive) return;
  if (static_cast<int32_t>(now - diagnosticDeadlineMs) >= 0) {
    stopRover(StopReason::DiagnosticWatchdog, "motor diagnostic watchdog expired");
    return;
  }
  if (now - diagnosticStepStartedMs < kDiagnostic[diagnosticStep].durationMs) return;
  ++diagnosticStep;
  if (diagnosticStep >= kDiagnosticLength) {
    stopRover(StopReason::MotorDiagnosticComplete, "motor diagnostic complete");
    return;
  }
  diagnosticStepStartedMs = now;
  setMotors(kDiagnostic[diagnosticStep].left, kDiagnostic[diagnosticStep].right,
            kDiagnostic[diagnosticStep].durationMs);
}

void updateConnectionFailSafe(uint32_t now) {
  if (!runtimeActive()) return;
  if (!webSocketConnected || now - lastWebSocketActivityMs >= kWebSocketTimeoutMs) {
    stopRover(StopReason::WebSocketLoss, "websocket heartbeat lost");
  }
}

void sendTelemetry() {
  if (!webSocketConnected || !runtimeActive() || activeRunId.length() == 0) return;
  const uint8_t angle = usesForwardTurret() ? 90U : static_cast<uint8_t>(scanIndex * 15U);
  orientTurret(angle);
  sendTelemetryFor(activeRunId, activeMode, angle, commandedLeft, commandedRight, commandDurationMs);
  if (scanOnlyActive) {
    ++scanFramesSent;
    if (scanFramesSent >= kSweepFrameCount) {
      stopRover(StopReason::ScanComplete, "stationary ultrasonic sweep complete");
      return;
    }
    ++scanIndex;
  } else if (!usesForwardTurret()) {
    scanIndex = static_cast<uint8_t>((scanIndex + 1U) % kSweepFrameCount);
  }
}

void sendConnectivityTest() {
  if (!webSocketConnected) {
    Serial.println("Cannot send: WebSocket is not connected");
    return;
  }
  TelemetrySample sample;
  sample.runId = "connectivity-test-01";
  sample.timestampMs = millis();
  sample.mode = TelemetryMode::Test;
  sample.scanAngleDeg = 90.0f;
  String packet = buildTelemetryJson(sample);
  webSocket.sendTXT(packet);
  Serial.println("Sent connectivity-test-01 (fixture)");
}

void sendFailSafeStatus() {
  const String runId = runtimeActive() ? activeRunId : lastFinishedRunId;
  const String detail = runtimeActive() ? String("runtime active") : lastStopDetail;
  sendRuntimeStatus(runtimeActive() ? "running" : "stopped", lastStopReason,
                    runId, activeRuntimeMode, detail);
  sendAck(true, "failsafe status sent");
}

void handleCommand(const String& payload) {
  // Ignore acknowledgements and reflected rover_status frames.
  if (payload.indexOf("\"ok\"") >= 0 || payload.indexOf("\"cmd\"") < 0) return;
  switch (parseRoverCommand(payload.c_str())) {
    case RoverCommand::Stop:
      stopRover(StopReason::OperatorStop, "operator stop"); return;
    case RoverCommand::Reset:
      stopRover(StopReason::Reset, "operator reset"); activeMode = TelemetryMode::Test; return;
    case RoverCommand::Learn:
    case RoverCommand::RunRoute:
      startRun(TelemetryMode::Learn); return;
    case RoverCommand::Verify:
      startRun(TelemetryMode::Verify); return;
    case RoverCommand::Explore:
      startExplore(durationFromCommand(payload, "duration_ms", kExploreDefaultDurationMs, kExploreMaxDurationMs)); return;
    case RoverCommand::DriveStraight:
      startDriveStraight(durationFromCommand(payload, "duration_ms", kDriveStraightDefaultDurationMs,
                                              kDriveStraightMaxDurationMs), forwardSpeedFromCommand(payload)); return;
    case RoverCommand::ScanOnly:
      startScanOnly(); return;
    case RoverCommand::MotorDiagnostic:
      // This is deliberately a remote opt-in. The physical wheels must be
      // lifted before sending {"cmd":"motor_diagnostic","wheels_lifted":true}.
      if (!booleanTrueFromCommand(payload, "wheels_lifted")) {
        sendAck(false, "motor_diagnostic requires wheels_lifted=true");
        return;
      }
      startMotorDiagnostic(); return;
    case RoverCommand::FailsafeStatus:
      sendFailSafeStatus(); return;
    case RoverCommand::None:
    default:
      sendAck(false, "unknown command"); return;
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      webSocketConnected = false;
      stopRover(StopReason::WebSocketLoss, "websocket disconnected");
      Serial.println("WebSocket DISCONNECTED");
      break;
    case WStype_CONNECTED:
      webSocketConnected = true;
      lastWebSocketActivityMs = millis();
      showStatus("ONLINE", "receiver linked");
      Serial.println("WebSocket CONNECTED");
      if (lastStopReason != StopReason::None) sendFailSafeStatus();
      break;
    case WStype_TEXT: {
      lastWebSocketActivityMs = millis();
      String command;
      command.reserve(length);
      for (size_t index = 0; index < length; ++index) command += static_cast<char>(payload[index]);
      Serial.print("WebSocket frame: ");
      Serial.println(command);
      handleCommand(command);
      break;
    }
    case WStype_ERROR:
      Serial.println("WebSocket ERROR");
      break;
    default:
      break;
  }
}

void printI2cScan() {
  Serial.println("I2C scan (SDA=21, SCL=22):");
  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  found 0x%02X\n", address);
      ++found;
    }
  }
  if (!found) Serial.println("  no I2C devices found");
}

void printSnapshot() {
  SensorReadings readings;
  sensorSuite.read(readings);
  Serial.printf("IMU: %s (gyro intentionally skipped)\n", readings.imuValid ? "available" : "not available");
  Serial.printf("Ultrasonic: %s\n", readings.distanceValid ? String(readings.distanceCm, 2).c_str() : "no echo");
  Serial.printf("IR raw: %s\n", readings.irValid ? String(readings.ir, 0).c_str() : "invalid");
  Serial.printf("Temperature: %s\n", readings.tempValid ? String(readings.tempC, 2).c_str() : "not ready");
  Serial.printf("Runtime: %s; last stop: %s (%s)\n", runtimeModeName(activeRuntimeMode),
                stopReasonName(lastStopReason), lastStopDetail.c_str());
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  sensorSuite.begin();
  motorController.begin();
  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, EchoAddresses::Oled);
  turretServo.setPeriodHertz(50);
  turretServo.attach(EchoPins::ServoSignal, 500, 2400);
  orientTurret(90);
  showStatus("READY", "safe standby");
  Serial.println("Echo-Maze fail-safe runtime firmware");
  Serial.println(sensorSuite.imuAvailable() ? "MPU6050 detected (not used)" : "MPU6050 absent; using gyro-free mode");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ECHO_WIFI_SSID, ECHO_WIFI_PASSWORD);
  Serial.print("Connecting to hotspot");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  Serial.print("Wi-Fi connected, ESP32 IP: ");
  Serial.println(WiFi.localIP());
  webSocket.begin(ECHO_RECEIVER_IP, ECHO_RECEIVER_PORT, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void loop() {
  webSocket.loop();
  const uint32_t now = millis();
  updateConnectionFailSafe(now);
  updateRoute(now);
  updateExplore(now);
  updateDriveStraight(now);
  updateMotorDiagnostic(now);
  if (runtimeActive() && now - lastTelemetryMs >= kTelemetryPeriodMs) {
    lastTelemetryMs = now;
    sendTelemetry();
  }
  if (!Serial.available()) return;
  const char command = Serial.read();
  if (command == 'p') sendConnectivityTest();
  else if (command == 'a') printI2cScan();
  else if (command == 'i') printSnapshot();
  else if (command == 's') stopRover(StopReason::OperatorStop, "serial stop");
  else if (command == 'l') startRun(TelemetryMode::Learn);
  else if (command == 'v') startRun(TelemetryMode::Verify);
  else if (command == 'e') startExplore(kExploreDefaultDurationMs);
  else if (command == 'd') startDriveStraight(kDriveStraightDefaultDurationMs, kDriveForwardSpeed);
  else if (command == 'c') startScanOnly();
  else if (command == 'm') startMotorDiagnostic();
  else if (command == 'f') sendFailSafeStatus();
}
