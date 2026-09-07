#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>

#include "secrets.h"
#include "telemetry.h"

WebSocketsClient webSocket;
bool webSocketConnected = false;

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

void setup() {
  Serial.begin(115200);
  delay(1000);

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
    if (Serial.read() == 'p') {
      sendConnectivityTest();
    }
  }
}
