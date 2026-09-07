#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <WebSocketsClient.h>
#include <ESP32Servo.h>

#include "secrets.h"
#include "hardware_config.h"
#include "health.h"
#include "motor_control.h"
#include "sensors.h"
#include "telemetry.h"

WebSocketsClient webSocket;
MotorController motorController;
SensorSuite sensorSuite;
SafetySupervisor safety;
bool webSocketConnected = false;
bool sensorSuiteReady = false;
uint32_t lastWebSocketActivityMs = 0;
uint32_t lastTelemetryMs = 0;
int16_t commandedLeft = 0;
int16_t commandedRight = 0;
uint32_t commandDurationMs = 0;
String activeRunId;
Servo turretServo;
uint8_t scanIndex = 0;
TelemetryMode activeMode = TelemetryMode::Test;
bool routeActive = false;
uint8_t routeStep = 0;
uint32_t routeStepStartedMs = 0;

struct RouteStep { int16_t left; int16_t right; uint32_t durationMs; };
// A deliberately short, slow, repeatable route. Commands are explicit and
// the rover remains stopped until the dashboard sends learn or verify.
const RouteStep kRoute[] = {
    {0, 0, 600}, {80, 80, 1400}, {0, 0, 600},
    {75, -75, 550}, {0, 0, 600}, {80, 80, 1400}, {0, 0, 500},
};
constexpr uint8_t kRouteLength = sizeof(kRoute) / sizeof(kRoute[0]);

void stopRover(const char* reason) {
  motorController.stop();
  commandedLeft = 0;
  commandedRight = 0;
  commandDurationMs = 0;
  routeActive = false;
  Serial.print("ROVER STOPPED: ");
  Serial.println(reason);
}

void setMotors(int16_t left, int16_t right, uint32_t durationMs) {
  commandedLeft = left;
  commandedRight = right;
  commandDurationMs = durationMs;
  motorController.setSpeeds(left, right);
}

void sendAck(bool ok, const char* message) {
  if (!webSocketConnected) return;
  String ack = String("{\"ok\":") + (ok ? "true" : "false") +
               ",\"message\":\"" + message + "\"}";
  webSocket.sendTXT(ack);
}

void startRun(TelemetryMode mode) {
  activeMode = mode;
  activeRunId = String(mode == TelemetryMode::Learn ? "learn-" : "verify-") + String(millis());
  routeActive = true;
  routeStep = 0;
  routeStepStartedMs = millis();
  scanIndex = 0;
  setMotors(kRoute[0].left, kRoute[0].right, kRoute[0].durationMs);
  Serial.print("Run started: "); Serial.println(activeRunId);
  sendAck(true, mode == TelemetryMode::Learn ? "learn started" : "verify started");
}

void handleCommand(const String& payload) {
  // Ignore receiver acknowledgements and any non-command frames. Without
  // this guard an ACK would be echoed forever between the two endpoints.
  if (payload.indexOf("\"cmd\"") < 0) return;
  if (payload.indexOf("\"cmd\":\"stop\"") >= 0) {
    stopRover("operator stop"); sendAck(true, "stopped"); return;
  }
  if (payload.indexOf("\"cmd\":\"reset\"") >= 0) {
    stopRover("reset"); activeMode = TelemetryMode::Test; sendAck(true, "reset"); return;
  }
  if (payload.indexOf("\"cmd\":\"learn\"") >= 0) { startRun(TelemetryMode::Learn); return; }
  if (payload.indexOf("\"cmd\":\"verify\"") >= 0) { startRun(TelemetryMode::Verify); return; }
  if (payload.indexOf("\"cmd\":\"run_route\"") >= 0) { startRun(TelemetryMode::Learn); return; }
  sendAck(false, "unknown command");
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      webSocketConnected = false;
      stopRover("websocket disconnected");
      Serial.println("WebSocket DISCONNECTED");
      break;
    case WStype_CONNECTED:
      webSocketConnected = true;
      lastWebSocketActivityMs = millis();
      Serial.println("WebSocket CONNECTED");
      break;
    case WStype_TEXT: {
      lastWebSocketActivityMs = millis();
      String command;
      for (size_t i = 0; i < length; ++i) command += static_cast<char>(payload[i]);
      Serial.print("Command: "); Serial.println(command);
      handleCommand(command);
      break;
    }
    case WStype_ERROR: Serial.println("WebSocket ERROR"); break;
    default: break;
  }
}

void sendTelemetry() {
  if (!webSocketConnected || activeMode == TelemetryMode::Test) return;
  SensorReadings readings;
  const uint8_t angle = static_cast<uint8_t>(scanIndex * 15U);
  turretServo.write(angle);
  delay(60); // let the servo settle before the ultrasonic ping
  sensorSuite.read(readings);
  TelemetrySample sample;
  sample.runId = activeRunId.c_str();
  sample.timestampMs = millis();
  sample.mode = activeMode;
  sample.leftSpeed = commandedLeft;
  sample.rightSpeed = commandedRight;
  sample.motorDurationMs = commandDurationMs;
  sample.scanAngleDeg = static_cast<float>(angle);
  sample.distanceValid = readings.distanceValid;
  sample.distanceCm = readings.distanceCm;
  sample.imuValid = false; // MPU6050 is not installed in this build.
  sample.irValid = readings.irValid;
  sample.ir = readings.ir;
  sample.tempValid = readings.tempValid;
  sample.tempC = readings.tempC;
  if (telemetrySampleValid(sample)) {
    String packet = buildTelemetryJson(sample);
    webSocket.sendTXT(packet);
    lastWebSocketActivityMs = millis();
  }
  scanIndex = static_cast<uint8_t>((scanIndex + 1U) % 13U);
}

void updateRoute(uint32_t now) {
  if (!routeActive) return;
  SensorReadings readings;
  sensorSuite.read(readings);
  HealthInputs inputs;
  inputs.obstacleValid = readings.distanceValid;
  inputs.obstacleDistanceCm = readings.distanceCm;
  inputs.websocketConnected = webSocketConnected;
  inputs.nowMs = now;
  inputs.lastWebsocketActivityMs = lastWebSocketActivityMs;
  if (safety.evaluate(inputs).shouldStop) { stopRover(safety.reason()); return; }
  if (now - routeStepStartedMs < kRoute[routeStep].durationMs) return;
  ++routeStep;
  if (routeStep >= kRouteLength) { stopRover("route complete"); sendAck(true, "route complete"); return; }
  routeStepStartedMs = now;
  setMotors(kRoute[routeStep].left, kRoute[routeStep].right, kRoute[routeStep].durationMs);
}

void sendConnectivityTest() {
  if (!webSocketConnected) { Serial.println("Cannot send: WebSocket is not connected"); return; }
  TelemetrySample sample;
  sample.runId = "connectivity-test-01"; sample.timestampMs = millis();
  sample.mode = TelemetryMode::Test; sample.scanAngleDeg = 90.0f;
  String packet = buildTelemetryJson(sample);
  webSocket.sendTXT(packet);
  Serial.println("Sent connectivity-test-01 (fixture)");
}

void printI2cScan() {
  Serial.println("I2C scan (SDA=21, SCL=22):"); uint8_t found = 0;
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address); if (Wire.endTransmission() == 0) {
      Serial.printf("  found 0x%02X\n", address); ++found;
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
}

void setup() {
  Serial.begin(115200); delay(1000);
  sensorSuiteReady = sensorSuite.begin();
  motorController.begin();
  turretServo.setPeriodHertz(50);
  turretServo.attach(EchoPins::ServoSignal, 500, 2400);
  turretServo.write(90);
  Serial.println("Echo-Maze gyro-free firmware");
  Serial.println(sensorSuite.imuAvailable() ? "MPU6050 detected (not used)" : "MPU6050 absent; using gyro-free mode");
  WiFi.mode(WIFI_STA); WiFi.begin(ECHO_WIFI_SSID, ECHO_WIFI_PASSWORD);
  Serial.print("Connecting to hotspot");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print('.'); }
  Serial.println(); Serial.print("Wi-Fi connected, ESP32 IP: "); Serial.println(WiFi.localIP());
  webSocket.begin(ECHO_RECEIVER_IP, ECHO_RECEIVER_PORT, "/");
  webSocket.onEvent(webSocketEvent); webSocket.setReconnectInterval(2000);
}

void loop() {
  webSocket.loop();
  const uint32_t now = millis();
  updateRoute(now);
  if (routeActive && now - lastTelemetryMs >= 100) { lastTelemetryMs = now; sendTelemetry(); }
  if (Serial.available()) {
    const char command = Serial.read();
    if (command == 'p') sendConnectivityTest();
    else if (command == 'a') printI2cScan();
    else if (command == 'm') motorController.runDiagnostic();
    else if (command == 'i') printSnapshot();
    else if (command == 's') stopRover("serial stop");
    else if (command == 'l') startRun(TelemetryMode::Learn);
    else if (command == 'v') startRun(TelemetryMode::Verify);
  }
}
