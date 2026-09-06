import math


def scan_to_world_point(robot_x, robot_y, robot_theta, servo_angle, distance_cm):
    world_angle = robot_theta + math.radians(servo_angle)

    obstacle_x = robot_x + distance_cm * math.cos(world_angle)
    obstacle_y = robot_y + distance_cm * math.sin(world_angle)

    return obstacle_x, obstacle_y

if __name__ == "__main__":
    obstacle_x, obstacle_y = scan_to_world_point(
        100, 50, math.radians(30),
        45, 40
    )

    print(obstacle_x, obstacle_y)