#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <WebSocketsClient.h>

#include "secrets.h"
#include "sensors.h"
#include "telemetry.h"

WebSocketsClient webSocket;
bool webSocketConnected = false;
SensorSuite sensorSuite;
bool sensorSuiteReady = false;

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      webSocketConnected = false;
      Serial.println("WebSocket DISCONNECTED");
      break;
    case WStype_CONNECTED:
      webSocketConnected = true;
      Serial.println("WebSocket CONNECTED");
      break;
    case WStype_TEXT:
      Serial.print("Server reply: ");
      Serial.write(payload, length);
      Serial.println();
      break;
    case WStype_ERROR:
      Serial.println("WebSocket ERROR");
      break;
    default:
      break;
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

  Serial.println("Sending connectivity-test-01...");
  String packet = buildTelemetryJson(sample);
  webSocket.sendTXT(packet);
}

void printI2cScan() {
  Serial.println("I2C scan (SDA=21, SCL=22):");
  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    const uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.printf("  found 0x%02X\n", address);
      ++found;
    }
  }
  if (found == 0) {
    Serial.println("  no I2C devices found");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  sensorSuiteReady = sensorSuite.begin();
  Serial.print("Sensor bring-up: MPU6050 ");
  Serial.println(sensorSuite.imuAvailable() ? "detected" : "NOT detected");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ECHO_WIFI_SSID, ECHO_WIFI_PASSWORD);

  Serial.print("Connecting to hotspot");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("Wi-Fi connected");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("WebSocket target: ");
  Serial.print(ECHO_RECEIVER_IP);
  Serial.print(":");
  Serial.println(ECHO_RECEIVER_PORT);

  webSocket.begin(ECHO_RECEIVER_IP, ECHO_RECEIVER_PORT, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void loop() {
  webSocket.loop();

  if (Serial.available()) {
    const char command = Serial.read();
    if (command == 'p') {
      sendConnectivityTest();
    } else if (command == 'a') {
      printI2cScan();
    } else if (command == 'i') {
      SensorReadings readings;
      if (!sensorSuiteReady || !sensorSuite.read(readings)) {
        Serial.println("Sensor snapshot unavailable");
      } else {
        Serial.print("IMU valid: ");
        Serial.println(readings.imuValid ? "yes" : "no");
        if (readings.imuValid) {
          Serial.printf("accel m/s2: %.3f, %.3f, %.3f\n", readings.accel.x,
                        readings.accel.y, readings.accel.z);
          Serial.printf("gyro rad/s: %.3f, %.3f, %.3f\n", readings.gyro.x,
                        readings.gyro.y, readings.gyro.z);
        }
        Serial.print("Ultrasonic cm: ");
        if (readings.distanceValid) {
          Serial.println(readings.distanceCm, 2);
        } else {
          Serial.println("no echo");
        }
        Serial.print("IR raw: ");
        Serial.println(readings.irValid ? String(readings.ir, 0) : "invalid");
        Serial.print("Temperature C: ");
        if (readings.tempValid) {
          Serial.println(readings.tempC, 2);
        } else {
          Serial.println("not ready");
        }
      }
    }
  }
}
