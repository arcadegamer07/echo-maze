#pragma once

#include "telemetry.h"

// The physical sensor drivers will populate this structure once the team
// confirms board models and pins. Keeping the data contract separate means
// telemetry and ML code can be tested before those libraries are installed.
struct SensorReadings {
  bool imuValid = false;
  Vector3f accel;
  Vector3f gyro;
  bool distanceValid = false;
  float distanceCm = 0.0f;
  bool irValid = false;
  float ir = 0.0f;
  bool tempValid = false;
  float tempC = 0.0f;
};

using SensorReadCallback = bool (*)(SensorReadings& readings);

class SensorSuite {
 public:
  explicit SensorSuite(SensorReadCallback reader = nullptr);

  void setReader(SensorReadCallback reader);
  // Initializes the physical sensor drivers. Returns true when initialization
  // completed; each sensor reports validity per sample because some devices
  // (DHT11, ultrasonic, and IR) have no discovery handshake.
  bool begin();
  bool read(SensorReadings& readings) const;
  bool imuAvailable() const;

 private:
  SensorReadCallback reader_;
  bool hardwareReady_ = false;
  bool imuAvailable_ = false;
};
