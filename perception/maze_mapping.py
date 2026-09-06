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

def cells_along_ray(x, y, direction, distance_cm, cell_size):
    cells = []
    step = cell_size / 10

    distance = 0.0

    while distance < distance_cm:
        point_x = x + distance * math.cos(direction)
        point_y = y + distance * math.sin(direction)

        cell = world_to_cell(point_x, point_y, cell_size)

        if cell not in cells:
            cells.append(cell)

        distance += step

    # Always include the exact sensor endpoint
    point_x = x + distance_cm * math.cos(direction)
    point_y = y + distance_cm * math.sin(direction)

    cell = world_to_cell(point_x, point_y, cell_size)

    if cell not in cells:
        cells.append(cell)

    return cells

def create_cell():
    return {
        "occupancy": 0.5,
        "N": 0.5,
        "E": 0.5,
        "S": 0.5,
        "W": 0.5
    }

def sensor_endpoint_cell(x, y, direction, distance_cm, cell_size):
    endpoint_x, endpoint_y = scan_endpoint(
        x,
        y,
        direction,
        distance_cm
    )

    return world_to_cell(
        endpoint_x,
        endpoint_y,
        cell_size
    )

def update_occupancy(cell, occupied):
    if occupied:
        cell["occupancy"] = bayesian_update(
            cell["occupancy"],
            False
        )
    else:
        cell["occupancy"] = bayesian_update(
            cell["occupancy"],
            True
        )

    return cell

def mark_free_cells(maze, ray_cells, obstacle_cell):
    for cell_coords in ray_cells:
        if cell_coords == obstacle_cell:
            break

        cell_x, cell_y = cell_coords
        cell = maze.get_cell(cell_x, cell_y)

        update_occupancy(cell, False)

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

        wall = None
        boundary_distance = None
        ray_cells = []

        cell_x, cell_y = robot_cell(
            robot_x,
            robot_y,
            cell_size
        )

        cell = self.get_cell(cell_x, cell_y)

        if distance_cm is not None:
            wall, boundary_distance = find_boundary_hit(
                robot_x,
                robot_y,
                direction,
                distance_cm,
                cell_size
            )

            obstacle_cell = sensor_endpoint_cell(
                robot_x,
                robot_y,
                direction,
                distance_cm,
                cell_size
            )

            ray_cells = cells_along_ray(
                robot_x,
                robot_y,
                direction,
                distance_cm,
                cell_size
            )

            mark_free_cells(
                self,
                ray_cells,
                obstacle_cell
            )

            obstacle_x, obstacle_y = obstacle_cell
            obstacle = self.get_cell(obstacle_x, obstacle_y)

            update_occupancy(obstacle, True)

        if wall is not None:
            update_cell_bayesian(cell, wall, True)

        return cell_x, cell_y, direction, wall, boundary_distance, cell, ray_cells

           
if __name__ == "__main__":
    maze = MazeMap()

    for i in range(3):
        result = maze.process_scan(
            100,
            50,
            0,
            45,
            20,
            30
        )

        cell = result[5]

        print("Observation", i + 1)
        print("Occupancy:", cell["occupancy"])
        print("North wall:", cell["N"])
        print()