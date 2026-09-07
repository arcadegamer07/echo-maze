#pragma once

#include <Arduino.h>

// A small, hardware-independent representation of one contract packet.
// Sensor drivers fill this structure; the serializer below produces the JSON
// sent over the existing WebSocketsClient connection.
struct Vector3f {
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
};

enum class TelemetryMode : uint8_t {
  Test,
  Learn,
  Verify,
};

struct TelemetrySample {
  const char* runId = nullptr;
  uint32_t timestampMs = 0;
  TelemetryMode mode = TelemetryMode::Test;

  int32_t leftSpeed = 0;
  int32_t rightSpeed = 0;
  uint32_t motorDurationMs = 0;

  float scanAngleDeg = 90.0f;
  bool distanceValid = false;
  float distanceCm = 0.0f;

  bool imuValid = false;
  Vector3f accel;
  Vector3f gyro;

  bool irValid = false;
  float ir = 0.0f;
  bool tempValid = false;
  float tempC = 0.0f;
};

const char* telemetryModeName(TelemetryMode mode);
const char* telemetrySourceName(TelemetryMode mode);

// Returns false when the sample would violate a basic contract invariant.
// IMU is optional in every mode; a missing board is represented as JSON null.
bool telemetrySampleValid(const TelemetrySample& sample);

// Build one compact JSON object matching ml/schemas/telemetry.schema.json.
// Call telemetrySampleValid() before sending a learn/verify sample.
String buildTelemetryJson(const TelemetrySample& sample);
