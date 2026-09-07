#include "sensors.h"

SensorSuite::SensorSuite(SensorReadCallback reader) : reader_(reader) {}

void SensorSuite::setReader(SensorReadCallback reader) {
  reader_ = reader;
}

bool SensorSuite::read(SensorReadings& readings) const {
  readings = SensorReadings{};
  if (reader_ == nullptr) {
    return false;
  }
  return reader_(readings);
}
