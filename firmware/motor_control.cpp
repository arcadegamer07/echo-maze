#include "motor_control.h"

MotorControl::MotorControl(
    int leftIN1,
    int leftIN2,
    int leftPWM,
    int rightIN1,
    int rightIN2,
    int rightPWM)
{
  _leftIN1 = leftIN1;
  _leftIN2 = leftIN2;
  _leftPWM = leftPWM;

  _rightIN1 = rightIN1;
  _rightIN2 = rightIN2;
  _rightPWM = rightPWM;

  _movementActive = false;

  _lastMovement.valid = false;
}

void MotorControl::begin()
{

  pinMode(_leftIN1, OUTPUT);
  pinMode(_leftIN2, OUTPUT);

  pinMode(_rightIN1, OUTPUT);
  pinMode(_rightIN2, OUTPUT);

  // ESP32 PWM
  ledcSetup(_leftChannel, 20000, 8);
  ledcSetup(_rightChannel, 20000, 8);

  ledcAttachPin(_leftPWM, _leftChannel);
  ledcAttachPin(_rightPWM, _rightChannel);

  stop();
}

void MotorControl::setMotor(
    int in1,
    int in2,
    int channel,
    int speed)
{

  speed = constrain(speed, -255, 255);

  if (speed > 0)
  {

    digitalWrite(in1, HIGH);
    digitalWrite(in2, LOW);

    ledcWrite(channel, speed);
  }
  else if (speed < 0)
  {

    digitalWrite(in1, LOW);
    digitalWrite(in2, HIGH);

    ledcWrite(channel, abs(speed));
  }
  else
  {

    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);

    ledcWrite(channel, 0);
  }
}

void MotorControl::drive(
    int leftSpeed,
    int rightSpeed)
{

  // Finish previous movement before starting another
  if (_movementActive)
  {
    finishCurrentMovement();
  }

  leftSpeed = constrain(leftSpeed, -255, 255);
  rightSpeed = constrain(rightSpeed, -255, 255);

  setMotor(
      _leftIN1,
      _leftIN2,
      _leftChannel,
      leftSpeed);

  setMotor(
      _rightIN1,
      _rightIN2,
      _rightChannel,
      rightSpeed);

  _currentMovement.startTime = millis();

  _currentMovement.leftSpeed = leftSpeed;
  _currentMovement.rightSpeed = rightSpeed;

  _currentMovement.valid = true;

  _movementActive = true;
}

void MotorControl::finishCurrentMovement()
{

  if (!_movementActive)
  {
    return;
  }

  _currentMovement.endTime = millis();

  _currentMovement.duration =
      _currentMovement.endTime -
      _currentMovement.startTime;

  _lastMovement = _currentMovement;

  _lastMovement.valid = true;

  _movementActive = false;
}

void MotorControl::stop()
{

  if (_movementActive)
  {
    finishCurrentMovement();
  }

  ledcWrite(_leftChannel, 0);
  ledcWrite(_rightChannel, 0);

  digitalWrite(_leftIN1, LOW);
  digitalWrite(_leftIN2, LOW);

  digitalWrite(_rightIN1, LOW);
  digitalWrite(_rightIN2, LOW);
}

MovementRecord MotorControl::getLastMovement()
{
  return _lastMovement;
}