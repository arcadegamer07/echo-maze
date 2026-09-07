def wall_consistency(wall_a, wall_b):
    return 1 - abs(wall_a - wall_b)

def cell_consistency(cell_a, cell_b, direction):
    if direction == "E":
        return wall_consistency(
            cell_a["E"],
            cell_b["W"]
        )

    elif direction == "W":
        return wall_consistency(
            cell_a["W"],
            cell_b["E"]
        )

    elif direction == "N":
        return wall_consistency(
            cell_a["N"],
            cell_b["S"]
        )

    elif direction == "S":
        return wall_consistency(
            cell_a["S"],
            cell_b["N"]
        )

    else:
        raise ValueError("Direction must be N, E, S, or W")

def map_structural_score(maze_cells):
    scores = []

    for (x, y), cell in maze_cells.items():

        east_neighbor = maze_cells.get((x + 1, y))
        if east_neighbor is not None:
            scores.append(
                cell_consistency(cell, east_neighbor, "E")
            )

        north_neighbor = maze_cells.get((x, y + 1))
        if north_neighbor is not None:
            scores.append(
                cell_consistency(cell, north_neighbor, "N")
            )

    if not scores:
        return 1.0

    return sum(scores) / len(scores)

if __name__ == "__main__":
    maze_cells = {
        (3, 1): {
            "N": 0.5,
            "E": 0.95,
            "S": 0.5,
            "W": 0.5
        },
        (4, 1): {
            "N": 0.5,
            "E": 0.5,
            "S": 0.5,
            "W": 0.92
        }
    }

    score = map_structural_score(maze_cells)

    print("Structural score:", score)