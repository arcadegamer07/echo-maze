#include "route.h"

RoutePlan::RoutePlan(const RouteStep* steps, size_t count)
    : steps_(steps), count_(count), index_(0) {}

void RoutePlan::setSteps(const RouteStep* steps, size_t count) {
  steps_ = steps;
  count_ = count;
  reset();
}

void RoutePlan::reset() {
  index_ = 0;
}

bool RoutePlan::next(RouteStep& step) {
  if (steps_ == nullptr || index_ >= count_) {
    return false;
  }
  step = steps_[index_++];
  return true;
}

bool RoutePlan::complete() const {
  return steps_ == nullptr || index_ >= count_;
}
