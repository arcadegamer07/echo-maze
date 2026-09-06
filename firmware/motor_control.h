#pragma once

#include <Arduino.h>

struct MovementRecord
{
  unsigned long startTime;
  unsigned long endTime;
  unsigned long duration;

  int leftSpeed;
  int rightSpeed;

  bool valid;
};

class MotorControl
{
public:
  MotorControl(
      int leftIN1,
      int leftIN2,
      int leftPWM,
      int rightIN1,
      int rightIN2,
      int rightPWM);

  void begin();

  // Speed range: -255 to +255
  void drive(int leftSpeed, int rightSpeed);

  void stop();

  MovementRecord getLastMovement();

private:
  int _leftIN1;
  int _leftIN2;
  int _leftPWM;

  int _rightIN1;
  int _rightIN2;
  int _rightPWM;

  const int _leftChannel = 0;
  const int _rightChannel = 1;

  MovementRecord _currentMovement;
  MovementRecord _lastMovement;

  bool _movementActive;

  void setMotor(
      int in1,
      int in2,
      int channel,
      int speed);

  void finishCurrentMovement();
};