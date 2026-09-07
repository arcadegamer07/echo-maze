#pragma once

#include <stddef.h>
#include <stdint.h>

enum class RouteActionType : uint8_t {
  Move,
  Scan,
};

struct RouteStep {
  RouteActionType type = RouteActionType::Move;
  int16_t leftSpeed = 0;
  int16_t rightSpeed = 0;
  uint32_t durationMs = 0;
  uint16_t scanAngleDeg = 90;
};

// A deterministic iterator over a pre-programmed route. Motor and servo
// drivers execute each returned step; this class itself touches no hardware.
class RoutePlan {
 public:
  RoutePlan(const RouteStep* steps = nullptr, size_t count = 0);

  void setSteps(const RouteStep* steps, size_t count);
  void reset();
  bool next(RouteStep& step);
  bool complete() const;

 private:
  const RouteStep* steps_;
  size_t count_;
  size_t index_;
};
