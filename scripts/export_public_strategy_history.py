#!/usr/bin/env python3
"""Export a strict public App3 position history from production observations."""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path


POSITIONS = {"NASDAQ", "OMX"}


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def next_weekday(value: date) -> date:
    result = value + timedelta(days=1)
    while result.weekday() >= 5:
        result += timedelta(days=1)
    return result


def next_market_date(value: date, market_dates: list[date]) -> date:
    for market_date in market_dates:
        if market_date > value:
            return market_date
    return next_weekday(value)


def build_history(feedback: dict, decision: dict, market_series: Path) -> dict:
    strategy_id = str(decision.get("strategy_id", "")).strip()
    strategy_version = str(decision.get("strategy_version", "")).strip()
    if not strategy_id or not strategy_version:
        raise ValueError("Production decision does not contain a strategy identity")

    dates: list[date] = []
    with market_series.open(encoding="utf-8") as handle:
        next(handle, None)
        for line in handle:
            raw = line.split(",", 1)[0].strip()
            try:
                dates.append(date.fromisoformat(raw))
            except ValueError:
                continue
    dates = sorted(set(dates))

    observations = feedback.get("signals", [])
    if not isinstance(observations, list):
        raise ValueError("Production feedback signals are not a list")

    candidates: list[tuple[date, str]] = []
    for observation in observations:
        if not isinstance(observation, dict) or observation.get("signal_origin") != "production_observed":
            continue
        if observation.get("production_decision_allowed") is not True:
            continue
        try:
            decision_date = date.fromisoformat(str(observation.get("decision_date")))
        except ValueError:
            continue
        position = str(observation.get("recommended_position") or observation.get("current_position") or "").upper()
        if position not in POSITIONS:
            continue
        candidates.append((decision_date, position))

    if not candidates:
        raise ValueError("No validated production observations available for public strategy history")

    candidates.sort()
    positions: list[dict[str, str]] = []
    last_position = None
    for decision_date, position in candidates:
        if position == last_position:
            continue
        effective_date = next_market_date(decision_date, dates)
        positions.append(
            {
                "effective_date": effective_date.isoformat(),
                "position": position,
                "strategy_id": strategy_id,
                "strategy_version": strategy_version,
            }
        )
        last_position = position

    if not positions:
        raise ValueError("No position transitions available for public strategy history")

    return {
        "schema_version": 1,
        "is_sample_data": False,
        "data_quality": "PASS",
        "strategy_id": strategy_id,
        "strategy_version": strategy_version,
        "source": "sanitized_production_signal_history",
        "positions": positions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--feedback", type=Path, required=True)
    parser.add_argument("--decision", type=Path, required=True)
    parser.add_argument("--market-series", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    payload = build_history(
        load_json(args.feedback),
        load_json(args.decision),
        args.market_series,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(payload['positions'])} sanitized strategy position event(s) to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
