#include "command_protocol.h"

#include <stdio.h>
#include <string.h>

namespace {

bool hasCommand(const char* payload, const char* command) {
  if (payload == nullptr || command == nullptr) {
    return false;
  }
  char jsonNeedle[32];
  snprintf(jsonNeedle, sizeof(jsonNeedle), "\"cmd\":\"%s\"", command);
  return strcmp(payload, command) == 0 || strstr(payload, jsonNeedle) != nullptr;
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
    case RoverCommand::Stop:
      return "stop";
    case RoverCommand::Reset:
      return "reset";
    case RoverCommand::None:
    default:
      return "none";
  }
}
