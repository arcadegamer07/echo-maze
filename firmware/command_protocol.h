#pragma once

#include <stdint.h>

enum class RoverCommand : uint8_t {
  None,
  Learn,
  Verify,
  RunRoute,
  Explore,
  DriveStraight,
  ScanOnly,
  MotorDiagnostic,
  FailsafeStatus,
  Stop,
  Reset,
};

// Accepts dashboard JSON such as {"cmd":"learn"} and plain command text.
// It intentionally does not depend on ArduinoJson for this tiny protocol.
RoverCommand parseRoverCommand(const char* payload);
const char* roverCommandName(RoverCommand command);
