"""Learn and verify commands for the first Echo-Maze ML baseline.

The pipeline consumes the receiver's immutable JSONL files.  It intentionally
does not mutate raw telemetry: training creates a separate model artifact and
verification writes a separate JSONL result file.

Examples (from the repository root)::

    python -m ml.pipeline learn --input data/runs/baseline-01.jsonl \
        --model data/baseline/isolation_forest.joblib
    python -m ml.pipeline verify --input data/runs/verify-01.jsonl \
        --model data/baseline/isolation_forest.joblib \
        --output data/runs/verify-01.scores.jsonl
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterator, Mapping, Sequence

from .anomaly_model import BaselineAnomalyModel
from .fft_features import InsufficientTelemetryError, extract_window_features


def load_jsonl(path: str | Path) -> list[dict[str, Any]]:
    """Load one receiver JSONL file, reporting the exact bad line if needed."""

    source = Path(path)
    packets: list[dict[str, Any]] = []
    with source.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{source}:{line_number} is not valid JSON: {error}") from error
            if not isinstance(value, dict):
                raise ValueError(f"{source}:{line_number} must contain a JSON object")
            packets.append(value)
    if not packets:
        raise ValueError(f"{source} contains no telemetry packets")
    return packets


def window_packets(
    packets: Sequence[Mapping[str, Any]],
    *,
    window_size: int = 20,
    stride: int = 10,
) -> Iterator[list[Mapping[str, Any]]]:
    """Yield overlapping, timestamp-ordered windows from a packet sequence."""

    if window_size < 1 or stride < 1:
        raise ValueError("window_size and stride must be positive")
    ordered = sorted(packets, key=lambda packet: float(packet.get("timestamp", 0)))
    for start in range(0, max(0, len(ordered) - window_size + 1), stride):
        yield ordered[start : start + window_size]


def _require_mode(packets: Sequence[Mapping[str, Any]], expected_mode: str) -> None:
    if not packets:
        raise ValueError("no packets supplied")
    wrong_mode = [packet.get("mode") for packet in packets if packet.get("mode") != expected_mode]
    if wrong_mode:
        raise ValueError(
            f"all packets for this command must have mode={expected_mode!r}; found {wrong_mode[0]!r}"
        )
    wrong_source = [packet.get("source") for packet in packets if packet.get("source") != "live"]
    if wrong_source:
        raise ValueError("ML learn/verify data must have source='live'; fixture packets are excluded")


def window_feature_rows(
    packets: Sequence[Mapping[str, Any]],
    *,
    window_size: int = 20,
    stride: int = 10,
    sample_rate_hz: float = 10.0,
) -> list[dict[str, float]]:
    """Convert packet windows into named feature rows."""

    rows: list[dict[str, float]] = []
    for window in window_packets(packets, window_size=window_size, stride=stride):
        try:
            rows.append(
                extract_window_features(window, sample_rate_hz=sample_rate_hz, require_imu=True)
            )
        except InsufficientTelemetryError as error:
            raise ValueError(f"cannot build an ML window: {error}") from error
    if not rows:
        raise ValueError(
            f"not enough packets for one window (need at least {window_size}, got {len(packets)})"
        )
    return rows


def train_baseline(
    input_path: str | Path,
    model_path: str | Path,
    *,
    window_size: int = 20,
    stride: int = 10,
    sample_rate_hz: float = 10.0,
) -> BaselineAnomalyModel:
    """Train and save a model from a healthy live ``learn`` run."""

    packets = load_jsonl(input_path)
    _require_mode(packets, "learn")
    rows = window_feature_rows(
        packets,
        window_size=window_size,
        stride=stride,
        sample_rate_hz=sample_rate_hz,
    )
    model = BaselineAnomalyModel().fit(rows)
    model.save(model_path)
    return model


def score_verify(
    input_path: str | Path,
    model_path: str | Path,
    *,
    window_size: int = 20,
    stride: int = 10,
    sample_rate_hz: float = 10.0,
) -> list[dict[str, Any]]:
    """Score a live ``verify`` run and return JSON-serialisable results."""

    packets = load_jsonl(input_path)
    _require_mode(packets, "verify")
    model = BaselineAnomalyModel.load(model_path)
    results: list[dict[str, Any]] = []
    ordered_windows = window_packets(packets, window_size=window_size, stride=stride)
    feature_rows: list[dict[str, float]] = []
    windows: list[list[Mapping[str, Any]]] = []
    for window in ordered_windows:
        windows.append(window)
        try:
            feature_rows.append(
                extract_window_features(window, sample_rate_hz=sample_rate_hz, require_imu=True)
            )
        except InsufficientTelemetryError as error:
            raise ValueError(f"cannot score an ML window: {error}") from error
    if not feature_rows:
        raise ValueError(
            f"not enough packets for one window (need at least {window_size}, got {len(packets)})"
        )

    predictions = model.predict(feature_rows)
    for window, prediction in zip(windows, predictions):
        results.append(
            {
                "start_timestamp": window[0]["timestamp"],
                "end_timestamp": window[-1]["timestamp"],
                "packet_count": len(window),
                **prediction.as_dict(),
            }
        )
    return results


def write_jsonl(path: str | Path, rows: Sequence[Mapping[str, Any]]) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(dict(row), separators=(",", ":")) + "\n")
    return destination


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    learn = subparsers.add_parser("learn", help="fit a baseline from a healthy live run")
    learn.add_argument("--input", required=True, type=Path)
    learn.add_argument("--model", required=True, type=Path)
    verify = subparsers.add_parser("verify", help="score a later live run")
    verify.add_argument("--input", required=True, type=Path)
    verify.add_argument("--model", required=True, type=Path)
    verify.add_argument("--output", required=True, type=Path)
    for command in (learn, verify):
        command.add_argument("--window-size", type=int, default=20)
        command.add_argument("--stride", type=int, default=10)
        command.add_argument("--sample-rate-hz", type=float, default=10.0)
    return parser


def main() -> None:
    args = _parser().parse_args()
    common = {
        "window_size": args.window_size,
        "stride": args.stride,
        "sample_rate_hz": args.sample_rate_hz,
    }
    if args.command == "learn":
        model = train_baseline(args.input, args.model, **common)
        print(
            f"Saved baseline model to {Path(args.model).resolve()} "
            f"(minimum {model.min_samples} windows)"
        )
    else:
        rows = score_verify(args.input, args.model, **common)
        write_jsonl(args.output, rows)
        print(f"Wrote {len(rows)} verification scores to {Path(args.output).resolve()}")


if __name__ == "__main__":
    main()
