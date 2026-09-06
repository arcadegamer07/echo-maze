"""Receive ESP32 WebSocket JSON telemetry and save immutable JSONL run logs.

Run from the repository root:
    .\\.venv\\Scripts\\python.exe -m ml.telemetry_server --port 8765
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from websockets.asyncio.server import ServerConnection, serve


SCHEMA_PATH = Path(__file__).parent / "schemas" / "telemetry.schema.json"


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def schema_validator() -> Draft202012Validator:
    with SCHEMA_PATH.open(encoding="utf-8") as schema_file:
        return Draft202012Validator(json.load(schema_file))


def log_path(output_dir: Path, run_id: str) -> Path:
    safe_run_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in run_id)
    return output_dir / f"{safe_run_id}.jsonl"


async def handle_connection(
    websocket: ServerConnection,
    output_dir: Path,
    validator: Draft202012Validator,
) -> None:
    remote = websocket.remote_address
    sender_ip = remote[0] if remote else "unknown"
    async for raw_message in websocket:
        try:
            packet: dict[str, Any] = json.loads(raw_message)
            if not isinstance(packet, dict):
                raise ValueError("packet must be a JSON object")
        except (json.JSONDecodeError, ValueError) as error:
            await websocket.send(json.dumps({"ok": False, "error": str(error)}))
            print(f"Dropped malformed packet from {sender_ip}: {error}")
            continue

        errors = sorted(validator.iter_errors(packet), key=lambda error: list(error.path))
        if errors:
            message = errors[0].message
            await websocket.send(json.dumps({"ok": False, "error": message}))
            print(f"Dropped invalid packet from {sender_ip}: {message}")
            continue

        packet["received_at_utc"] = utc_now()
        packet["sender_ip"] = sender_ip
        destination = log_path(output_dir, packet["run_id"])
        with destination.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(packet, separators=(",", ":")) + "\n")
        await websocket.send(json.dumps({"ok": True, "run_id": packet["run_id"]}))
        print(
            f"[{packet['mode']}] {packet['run_id']} t={packet['timestamp']} "
            f"from {sender_ip} -> {destination.name}"
        )


async def run_server(host: str, port: int, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    validator = schema_validator()
    print(f"Listening for WebSocket telemetry on ws://{host}:{port}")
    print(f"Writing immutable packet logs under {output_dir.resolve()}")
    async with serve(
        lambda websocket: handle_connection(websocket, output_dir, validator), host, port
    ):
        await asyncio.Future()  # Run until Ctrl+C.


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--output-dir", default="data/runs", type=Path)
    args = parser.parse_args()
    asyncio.run(run_server(args.host, args.port, args.output_dir))


if __name__ == "__main__":
    main()
