import math


def world_to_cell(x, y, cell_size):
    cell_x = math.floor(x / cell_size)
    cell_y = math.floor(y / cell_size)

    return cell_x, cell_y


if __name__ == "__main__":
    print(world_to_cell(75, 45, 30))

def closest_wall(x, y, cell_x, cell_y, cell_size):
    left = cell_x * cell_size
    right = (cell_x + 1) * cell_size
    bottom = cell_y * cell_size
    top = (cell_y + 1) * cell_size

    distances = {
        "W": abs(x - left),
        "E": abs(right - x),
        "S": abs(y - bottom),
        "N": abs(top - y)
    }

    return min(distances, key=distances.get)

def detect_wall(x, y, cell_x, cell_y, cell_size, tolerance):
    left = cell_x * cell_size
    right = (cell_x + 1) * cell_size
    bottom = cell_y * cell_size
    top = (cell_y + 1) * cell_size

    distances = {
        "W": abs(x - left),
        "E": abs(right - x),
        "S": abs(y - bottom),
        "N": abs(top - y)
    }

    wall = min(distances, key=distances.get)

    if distances[wall] <= tolerance:
        return wall

    return None

def create_cell():
    return {
        "N": 0.5,
        "E": 0.5,
        "S": 0.5,
        "W": 0.5
    }

def update_wall_probability(cell, wall, wall_detected):
    if wall_detected:
        cell[wall] = min(1.0, cell[wall] + 0.1)
    else:
        cell[wall] = max(0.0, cell[wall] - 0.1)

    cell[wall] = round(cell[wall], 2)
    return cell

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

def process_observation(x, y, cell_size, tolerance, observation):
    cell_x, cell_y = world_to_cell(x, y, cell_size)

    wall = detect_wall(
        x, y,
        cell_x, cell_y,
        cell_size,
        tolerance
    )

    cell = create_cell()

    if wall is not None:
        update_cell_bayesian(cell, wall, observation)

    return cell_x, cell_y, wall, cell

if __name__ == "__main__":
    cell_x, cell_y, wall, cell = process_observation(
        58, 75,
        30,
        3,
        True
    )

    print("Cell:", cell_x, cell_y)
    print("Wall:", wall)
    print("Confidence:", cell)