#include <Arduino.h>
#include "motor_control.h"

// =====================================================
// TEMPORARY MOTOR PINS
// CHANGE THESE WHEN HARDWARE TEAM GIVES ACTUAL WIRING
// =====================================================

#define LEFT_IN1 25
#define LEFT_IN2 26
#define LEFT_PWM 32

#define RIGHT_IN1 27
#define RIGHT_IN2 14
#define RIGHT_PWM 33

MotorControl motors(
    LEFT_IN1,
    LEFT_IN2,
    LEFT_PWM,

    RIGHT_IN1,
    RIGHT_IN2,
    RIGHT_PWM);

int motorSpeed = 180;

void printMovement()
{

  MovementRecord record =
      motors.getLastMovement();

  if (!record.valid)
  {
    return;
  }

  Serial.println();

  Serial.println("----- MOVEMENT RECORD -----");

  Serial.print("Start: ");
  Serial.print(record.startTime);
  Serial.println(" ms");

  Serial.print("End: ");
  Serial.print(record.endTime);
  Serial.println(" ms");

  Serial.print("Duration: ");
  Serial.print(record.duration);
  Serial.println(" ms");

  Serial.print("Left Speed: ");
  Serial.println(record.leftSpeed);

  Serial.print("Right Speed: ");
  Serial.println(record.rightSpeed);

  Serial.println("---------------------------");
}

void printHelp()
{

  Serial.println();
  Serial.println("Echo-Maze Motor Test");

  Serial.println("f = forward");
  Serial.println("b = reverse");
  Serial.println("l = turn left");
  Serial.println("r = turn right");
  Serial.println("s = stop");

  Serial.println();
}

void setup()
{

  Serial.begin(115200);

  delay(1000);

  motors.begin();

  Serial.println("Echo-Maze firmware started");

  printHelp();
}

void loop()
{

  if (Serial.available())
  {

    char command = Serial.read();

    switch (command)
    {

    case 'f':

      Serial.println("FORWARD");

      motors.drive(
          motorSpeed,
          motorSpeed);

      break;

    case 'b':

      Serial.println("REVERSE");

      motors.drive(
          -motorSpeed,
          -motorSpeed);

      break;

    case 'l':

      Serial.println("LEFT");

      motors.drive(
          -motorSpeed,
          motorSpeed);

      break;

    case 'r':

      Serial.println("RIGHT");

      motors.drive(
          motorSpeed,
          -motorSpeed);

      break;

    case 's':

      Serial.println("STOP");

      motors.stop();

      printMovement();

      break;
    }
  }
}