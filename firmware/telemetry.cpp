#include "telemetry.h"

#include <math.h>

namespace {

bool finiteNumber(float value) {
  return isfinite(value);
}

String jsonEscape(const char* text) {
  String escaped;
  if (text == nullptr) {
    return escaped;
  }
  for (const char* cursor = text; *cursor != '\0'; ++cursor) {
    if (*cursor == '\\' || *cursor == '"') {
      escaped += '\\';
    }
    escaped += *cursor;
  }
  return escaped;
}

String optionalNumber(bool valid, float value) {
  if (!valid || !finiteNumber(value)) {
    return "null";
  }
  return String(value, 4);
}

}  // namespace

const char* telemetryModeName(TelemetryMode mode) {
  switch (mode) {
    case TelemetryMode::Learn:
      return "learn";
    case TelemetryMode::Verify:
      return "verify";
    case TelemetryMode::Explore:
      return "explore";
    case TelemetryMode::Test:
    default:
      return "test";
  }
}

const char* telemetrySourceName(TelemetryMode mode) {
  return mode == TelemetryMode::Test ? "fixture" : "live";
}

bool telemetrySampleValid(const TelemetrySample& sample) {
  if (sample.runId == nullptr || sample.runId[0] == '\0') {
    return false;
  }
  if (!finiteNumber(sample.scanAngleDeg) || sample.scanAngleDeg < 0.0f ||
      sample.scanAngleDeg > 180.0f) {
    return false;
  }
  if (sample.distanceValid &&
      (!finiteNumber(sample.distanceCm) || sample.distanceCm < 0.0f)) {
    return false;
  }
  if (sample.irValid && !finiteNumber(sample.ir)) {
    return false;
  }
  if (sample.tempValid && !finiteNumber(sample.tempC)) {
    return false;
  }
  return true;
}

String buildTelemetryJson(const TelemetrySample& sample) {
  String json;
  json.reserve(320);
  json += "{\"run_id\":\"";
  json += jsonEscape(sample.runId);
  json += "\",\"timestamp\":";
  json += String(sample.timestampMs);
  json += ",\"mode\":\"";
  json += telemetryModeName(sample.mode);
  json += "\",\"source\":\"";
  json += telemetrySourceName(sample.mode);
  json += "\",\"motor\":{";
  json += "\"left_speed\":";
  json += String(sample.leftSpeed);
  json += ",\"right_speed\":";
  json += String(sample.rightSpeed);
  json += ",\"duration_ms\":";
  json += String(sample.motorDurationMs);
  json += "},\"scan\":{";
  json += "\"angle\":";
  json += String(sample.scanAngleDeg, 4);
  json += ",\"distance_cm\":";
  json += optionalNumber(sample.distanceValid, sample.distanceCm);
  json += "},\"imu\":";
  if (!sample.imuValid) {
    json += "null";
  } else {
    json += "{\"accel\":[";
    json += String(sample.accel.x, 5);
    json += ",";
    json += String(sample.accel.y, 5);
    json += ",";
    json += String(sample.accel.z, 5);
    json += "],\"gyro\":[";
    json += String(sample.gyro.x, 5);
    json += ",";
    json += String(sample.gyro.y, 5);
    json += ",";
    json += String(sample.gyro.z, 5);
    json += "]}";
  }
  json += ",\"ir\":";
  json += optionalNumber(sample.irValid, sample.ir);
  json += ",\"temp_c\":";
  json += optionalNumber(sample.tempValid, sample.tempC);
  json += "}";
  return json;
}
