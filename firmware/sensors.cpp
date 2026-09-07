#include "sensors.h"

#include <Arduino.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>

#include "hardware_config.h"

namespace {

Adafruit_MPU6050 mpu;
DHT dht(EchoPins::DhtData, DHT11);
bool mpuReady = false;
bool dhtStarted = false;
uint32_t lastDhtReadMs = 0;
bool haveTemperature = false;
float lastTemperatureC = 0.0f;

bool finiteNumber(float value) {
  return isfinite(value);
}

float readUltrasonicCm(bool& valid) {
  digitalWrite(EchoPins::UltrasonicTrig, LOW);
  delayMicroseconds(2);
  digitalWrite(EchoPins::UltrasonicTrig, HIGH);
  delayMicroseconds(10);
  digitalWrite(EchoPins::UltrasonicTrig, LOW);

  // 30 ms is approximately the round-trip time for a 5 m return. A timeout
  // is reported as null rather than being turned into a fake zero distance.
  const unsigned long durationUs =
      pulseIn(EchoPins::UltrasonicEcho, HIGH, 30000UL);
  if (durationUs == 0) {
    valid = false;
    return 0.0f;
  }

  const float distanceCm = static_cast<float>(durationUs) * 0.0343f * 0.5f;
  valid = finiteNumber(distanceCm) && distanceCm >= 0.0f;
  return valid ? distanceCm : 0.0f;
}

}  // namespace

SensorSuite::SensorSuite(SensorReadCallback reader) : reader_(reader) {}

void SensorSuite::setReader(SensorReadCallback reader) {
  reader_ = reader;
}

bool SensorSuite::begin() {
  // Keep the motor driver disabled while the rover is on USB power during
  // bring-up. This is intentionally done before any sensor reads.
  pinMode(EchoPins::MotorStandby, OUTPUT);
  digitalWrite(EchoPins::MotorStandby, LOW);

  pinMode(EchoPins::UltrasonicTrig, OUTPUT);
  digitalWrite(EchoPins::UltrasonicTrig, LOW);
  pinMode(EchoPins::UltrasonicEcho, INPUT);
  pinMode(EchoPins::IrAnalog, INPUT);

  Wire.begin(EchoPins::I2cSda, EchoPins::I2cScl);
  mpuReady = mpu.begin(EchoAddresses::Mpu6050, &Wire);
  if (mpuReady) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }

  dht.begin();
  dhtStarted = true;
  lastDhtReadMs = millis() - 2000UL;
  hardwareReady_ = true;
  imuAvailable_ = mpuReady;
  return hardwareReady_;
}

bool SensorSuite::read(SensorReadings& readings) const {
  readings = SensorReadings{};
  if (reader_ != nullptr) {
    return reader_(readings);
  }
  if (!hardwareReady_) {
    return false;
  }

  if (mpuReady) {
    sensors_event_t accelEvent;
    sensors_event_t gyroEvent;
    sensors_event_t temperatureEvent;
    mpu.getEvent(&accelEvent, &gyroEvent, &temperatureEvent);
    readings.accel.x = accelEvent.acceleration.x;
    readings.accel.y = accelEvent.acceleration.y;
    readings.accel.z = accelEvent.acceleration.z;
    readings.gyro.x = gyroEvent.gyro.x;
    readings.gyro.y = gyroEvent.gyro.y;
    readings.gyro.z = gyroEvent.gyro.z;
    readings.imuValid = finiteNumber(readings.accel.x) &&
                        finiteNumber(readings.accel.y) &&
                        finiteNumber(readings.accel.z) &&
                        finiteNumber(readings.gyro.x) &&
                        finiteNumber(readings.gyro.y) &&
                        finiteNumber(readings.gyro.z);
  }

  readings.distanceCm = readUltrasonicCm(readings.distanceValid);

  // The common three-pin IR obstacle modules expose a digital OUT signal.
  // Preserve the raw 0/1 value until the active level is confirmed on the
  // actual module; this avoids pretending it is an analog distance.
  readings.ir = static_cast<float>(digitalRead(EchoPins::IrAnalog));
  readings.irValid = true;

  const uint32_t nowMs = millis();
  if (dhtStarted && nowMs - lastDhtReadMs >= 2000UL) {
    lastDhtReadMs = nowMs;
    const float temperatureC = dht.readTemperature();
    if (finiteNumber(temperatureC)) {
      lastTemperatureC = temperatureC;
      haveTemperature = true;
    }
  }
  readings.tempC = lastTemperatureC;
  readings.tempValid = haveTemperature;
  return readings.imuValid || readings.distanceValid || readings.irValid ||
         readings.tempValid;
}

bool SensorSuite::imuAvailable() const {
  return imuAvailable_;
}
