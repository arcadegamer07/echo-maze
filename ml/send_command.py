"""Send a bounded control command through the local telemetry receiver.

Examples from the repository root::

    .\\.venv\\Scripts\\python.exe -m ml.send_command explore --duration-ms 30000
    .\\.venv\\Scripts\\python.exe -m ml.send_command stop

The receiver relays the command to the connected ESP32.  ``explore`` is
clamped again by the firmware to a hard 30-second maximum, so a bad laptop
argument cannot create an unbounded motor command.
"""

from __future__ import annotations

import argparse
import asyncio
import json

from websockets.asyncio.client import connect


async def send(uri: str, command: str, duration_ms: int | None) -> dict:
    payload: dict[str, object] = {"cmd": command, "source": "ml-command"}
    if command == "explore" and duration_ms is not None:
        payload["duration_ms"] = duration_ms
    async with connect(uri) as websocket:
        await websocket.send(json.dumps(payload))
        return json.loads(await websocket.recv())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("learn", "verify", "explore", "stop", "reset"))
    parser.add_argument("--duration-ms", type=int, help="explore duration; firmware caps it at 30000 ms")
    parser.add_argument("--uri", default="ws://127.0.0.1:8765")
    args = parser.parse_args()
    if args.command == "explore" and args.duration_ms is not None and args.duration_ms <= 0:
        parser.error("--duration-ms must be positive")
    if args.command != "explore" and args.duration_ms is not None:
        parser.error("--duration-ms is only valid with explore")
    reply = asyncio.run(send(args.uri, args.command, args.duration_ms))
    print(json.dumps(reply, indent=2))


if __name__ == "__main__":
    main()
