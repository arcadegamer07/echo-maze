"""Send one simulated ESP32 telemetry packet to the local WebSocket receiver.

Run in a second terminal while `ml.telemetry_server` is running:
    .\\.venv\\Scripts\\python.exe -m ml.send_test_packet
"""

from __future__ import annotations

import argparse
import asyncio
import json

from websockets.asyncio.client import connect


def test_packet(run_id: str) -> dict:
    return {
        "run_id": run_id,
        "timestamp": 1000,
        "mode": "learn",
        "motor": {"left_speed": 0, "right_speed": 0, "duration_ms": 0},
        "scan": {"angle": 90, "distance_cm": 42.5},
        "imu": {"accel": [0.0, 0.0, 9.81], "gyro": [0.0, 0.0, 0.0]},
        "ir": None,
        "temp_c": 25.0,
    }


async def send(uri: str, run_id: str) -> None:
    packet = test_packet(run_id)
    async with connect(uri) as websocket:
        await websocket.send(json.dumps(packet))
        acknowledgement = json.loads(await websocket.recv())
    print("Sent:")
    print(json.dumps(packet, indent=2))
    print("Server reply:")
    print(json.dumps(acknowledgement, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uri", default="ws://127.0.0.1:8765")
    parser.add_argument("--run-id", default="local-simulation-01")
    args = parser.parse_args()
    asyncio.run(send(args.uri, args.run_id))


if __name__ == "__main__":
    main()
