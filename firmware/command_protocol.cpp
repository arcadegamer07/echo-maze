#include "command_protocol.h"

#include <stdio.h>
#include <string.h>
#include <ctype.h>

namespace {

bool hasCommand(const char* payload, const char* command) {
  if (payload == nullptr || command == nullptr) {
    return false;
  }
  if (strcmp(payload, command) == 0) {
    return true;
  }

  // Accept normal JSON whitespace too, e.g. { "cmd" : "explore" }.
  // This intentionally remains tiny and dependency-free; it only needs to
  // identify the one command field rather than parse arbitrary JSON.
  const char* key = strstr(payload, "\"cmd\"");
  if (key == nullptr) {
    return false;
  }
  key += strlen("\"cmd\"");
  while (*key != '\0' && isspace(static_cast<unsigned char>(*key))) ++key;
  if (*key++ != ':') {
    return false;
  }
  while (*key != '\0' && isspace(static_cast<unsigned char>(*key))) ++key;
  if (*key++ != '\"') {
    return false;
  }
  const size_t commandLength = strlen(command);
  return strncmp(key, command, commandLength) == 0 &&
         key[commandLength] == '\"';
}

}  // namespace

RoverCommand parseRoverCommand(const char* payload) {
  if (hasCommand(payload, "stop")) {
    return RoverCommand::Stop;
  }
  if (hasCommand(payload, "learn")) {
    return RoverCommand::Learn;
  }
  if (hasCommand(payload, "verify")) {
    return RoverCommand::Verify;
  }
  if (hasCommand(payload, "run_route")) {
    return RoverCommand::RunRoute;
  }
  if (hasCommand(payload, "explore")) {
    return RoverCommand::Explore;
  }
  if (hasCommand(payload, "drive_straight")) {
    return RoverCommand::DriveStraight;
  }
  if (hasCommand(payload, "scan_only")) {
    return RoverCommand::ScanOnly;
  }
  if (hasCommand(payload, "motor_diagnostic")) {
    return RoverCommand::MotorDiagnostic;
  }
  if (hasCommand(payload, "failsafe_status") ||
      hasCommand(payload, "rover_status")) {
    return RoverCommand::FailsafeStatus;
  }
  if (hasCommand(payload, "reset")) {
    return RoverCommand::Reset;
  }
  return RoverCommand::None;
}

const char* roverCommandName(RoverCommand command) {
  switch (command) {
    case RoverCommand::Learn:
      return "learn";
    case RoverCommand::Verify:
      return "verify";
    case RoverCommand::RunRoute:
      return "run_route";
    case RoverCommand::Explore:
      return "explore";
    case RoverCommand::DriveStraight:
      return "drive_straight";
    case RoverCommand::ScanOnly:
      return "scan_only";
    case RoverCommand::MotorDiagnostic:
      return "motor_diagnostic";
    case RoverCommand::FailsafeStatus:
      return "failsafe_status";
    case RoverCommand::Stop:
      return "stop";
    case RoverCommand::Reset:
      return "reset";
    case RoverCommand::None:
    default:
      return "none";
  }
}
