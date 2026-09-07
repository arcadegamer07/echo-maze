def detect_change(previous_value, current_value, threshold=0.2):
    difference = abs(current_value - previous_value)

    return difference >= threshold

def compare_walls(previous_cell, current_cell, threshold=0.2):
    changes = {}

    for wall in ["N", "E", "S", "W"]:
        changes[wall] = detect_change(
            previous_cell[wall],
            current_cell[wall],
            threshold
        )

    return changes

def compare_maps(previous_map, current_map, threshold=0.2):
    changes = {}

    common_cells = set(previous_map.keys()) & set(current_map.keys())

    for cell_coords in common_cells:
        wall_changes = compare_walls(
            previous_map[cell_coords],
            current_map[cell_coords],
            threshold
        )

        if any(wall_changes.values()):
            changes[cell_coords] = wall_changes

    return changes

if __name__ == "__main__":
    previous_map = {
        (3, 1): {
            "N": 0.9,
            "E": 0.5,
            "S": 0.1,
            "W": 0.5
        },
        (4, 1): {
            "N": 0.5,
            "E": 0.5,
            "S": 0.5,
            "W": 0.5
        }
    }

    current_map = {
        (3, 1): {
            "N": 0.1,
            "E": 0.5,
            "S": 0.1,
            "W": 0.5
        },
        (4, 1): {
            "N": 0.5,
            "E": 0.5,
            "S": 0.5,
            "W": 0.5
        }
    }

    changes = compare_maps(previous_map, current_map)

    print("Map changes:", changes)