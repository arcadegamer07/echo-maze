import math

def world_to_cell(x, y, cell_size):
    cell_x = math.floor(x / cell_size)
    cell_y = math.floor(y / cell_size)

    return cell_x, cell_y

def robot_cell(x, y, cell_size):
    return world_to_cell(x, y, cell_size)

def scan_direction(robot_theta, servo_angle):
    return robot_theta + math.radians(servo_angle)

def scan_endpoint(robot_x, robot_y, direction, distance_cm):
    end_x = robot_x + distance_cm * math.cos(direction)
    end_y = robot_y + distance_cm * math.sin(direction)

    return end_x, end_y

def distance_to_boundary(x, y, direction, cell_size):
    cell_x, cell_y = world_to_cell(x, y, cell_size)

    if math.cos(direction) > 0:
        next_x = (cell_x + 1) * cell_size
        dx = (next_x - x) / math.cos(direction)
    elif math.cos(direction) < 0:
        next_x = cell_x * cell_size
        dx = (next_x - x) / math.cos(direction)
    else:
        dx = float("inf")

    if math.sin(direction) > 0:
        next_y = (cell_y + 1) * cell_size
        dy = (next_y - y) / math.sin(direction)
    elif math.sin(direction) < 0:
        next_y = cell_y * cell_size
        dy = (next_y - y) / math.sin(direction)
    else:
        dy = float("inf")

    return min(dx, dy)

def boundary_direction(x, y, direction, cell_size):
    cell_x, cell_y = world_to_cell(x, y, cell_size)

    cos_dir = math.cos(direction)
    sin_dir = math.sin(direction)

    if cos_dir > 0:
        next_x = (cell_x + 1) * cell_size
        dx = (next_x - x) / cos_dir
    elif cos_dir < 0:
        next_x = cell_x * cell_size
        dx = (next_x - x) / cos_dir
    else:
        dx = float("inf")

    if sin_dir > 0:
        next_y = (cell_y + 1) * cell_size
        dy = (next_y - y) / sin_dir
    elif sin_dir < 0:
        next_y = cell_y * cell_size
        dy = (next_y - y) / sin_dir
    else:
        dy = float("inf")

    if dx < dy:
        return "E" if cos_dir > 0 else "W"
    else:
        return "N" if sin_dir > 0 else "S"

def find_boundary_hit(x, y, direction, sensor_distance, cell_size):
    distance = distance_to_boundary(
        x, y, direction, cell_size
    )

    if sensor_distance < distance:
        return None, distance

    wall = boundary_direction(
        x, y, direction, cell_size
    )

    return wall, distance

def create_cell():
    return {
        "N": 0.5,
        "E": 0.5,
        "S": 0.5,
        "W": 0.5
    }

def bayesian_update(prior, observation, p_detection_given_wall=0.9,
                    p_detection_given_no_wall=0.1):
    if observation:
        likelihood_wall = p_detection_given_wall
        likelihood_no_wall = p_detection_given_no_wall
    else:
        likelihood_wall = 1 - p_detection_given_wall
        likelihood_no_wall = 1 - p_detection_given_no_wall

    numerator = likelihood_wall * prior

    denominator = (
        likelihood_wall * prior
        + likelihood_no_wall * (1 - prior)
    )

    return numerator / denominator

def update_cell_bayesian(cell, wall, observation):
    cell[wall] = bayesian_update(cell[wall], observation)
    return cell

class MazeMap:
    def __init__(self):
        self.cells = {}

    def get_cell(self, cell_x, cell_y):
        if (cell_x, cell_y) not in self.cells:
            self.cells[(cell_x, cell_y)] = create_cell()

        return self.cells[(cell_x, cell_y)]

    def process_scan(self, robot_x, robot_y, robot_theta,
                     servo_angle, distance_cm, cell_size):
        direction = scan_direction(
            robot_theta,
            servo_angle
        )

        wall, boundary_distance = find_boundary_hit(
            robot_x,
            robot_y,
            direction,
            distance_cm,
            cell_size
        )

        cell_x, cell_y = robot_cell(
            robot_x,
            robot_y,
            cell_size
        )

        cell = self.get_cell(cell_x, cell_y)

        if wall is not None:
            update_cell_bayesian(cell, wall, True)

        return cell_x, cell_y, direction, wall, boundary_distance, cell

if __name__ == "__main__":
    maze = MazeMap()

    cell_x, cell_y, direction, wall, boundary_distance, cell = maze.process_scan(
        100,   # robot x
        50,    # robot y
        0,     # robot heading
        45,     # servo angle → East
        20,    # sensor distance
        30     # cell size
    )

    print("Cell:", cell_x, cell_y)
    print("Scan direction:", math.degrees(direction))
    print("Wall:", wall)
    print("Boundary distance:", boundary_distance)
    print("Confidence:", cell)