import math


def update_pose(x, y, theta, d_left, d_right, wheel_base):
    delta_s = (d_left + d_right) / 2
    delta_theta = (d_right - d_left) / wheel_base

    theta_mid = theta + delta_theta / 2

    delta_x = delta_s * math.cos(theta_mid)
    delta_y = delta_s * math.sin(theta_mid)

    new_x = x + delta_x
    new_y = y + delta_y
    new_theta = theta + delta_theta

    return new_x, new_y, new_theta


if __name__ == "__main__":
    x, y, theta = update_pose(
        0, 0, 0,
        10, 20,
        20
    )

    print(x, y, theta)