import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from ml.telemetry_server import handle_connection, schema_validator


VALID_PACKET = {
    "run_id": "test-run-01",
    "timestamp": 1,
    "mode": "learn",
    "source": "live",
    "motor": {"left_speed": 0, "right_speed": 0, "duration_ms": 0},
    "scan": {"angle": 90, "distance_cm": 42.0},
    "imu": {"accel": [0, 0, 9.81], "gyro": [0, 0, 0]},
    "ir": None,
    "temp_c": 25.0,
}


class FakeWebSocket:
    remote_address = ("127.0.0.1", 9999)

    def __init__(self, messages):
        self.messages = iter(messages)
        self.sent = []

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.messages)
        except StopIteration as error:
            raise StopAsyncIteration from error

    async def send(self, message):
        self.sent.append(json.loads(message))


class TelemetryServerTests(unittest.TestCase):
    def test_valid_packet_is_acknowledged_and_logged(self):
        websocket = FakeWebSocket([json.dumps(VALID_PACKET)])
        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(handle_connection(websocket, Path(directory), schema_validator()))
            log_file = Path(directory) / "test-run-01.jsonl"
            logged_packet = json.loads(log_file.read_text(encoding="utf-8"))

        self.assertEqual(websocket.sent, [{"ok": True, "run_id": "test-run-01"}])
        self.assertEqual(logged_packet["run_id"], "test-run-01")
        self.assertEqual(logged_packet["sender_ip"], "127.0.0.1")
        self.assertIn("received_at_utc", logged_packet)
