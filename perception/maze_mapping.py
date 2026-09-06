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

if __name__ == "__main__":
    cell = create_cell()

    print("Initial:", cell)

    for i in range(5):
        update_wall_probability(cell, "E", True)

    print("After 5 wall detections:", cell)

    for i in range(3):
        update_wall_probability(cell, "E", False)

    print("After 3 no-wall observations:", cell)