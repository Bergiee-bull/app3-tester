#!/usr/bin/env python3
"""Promote a validated benchmark only when it is not older than the public copy."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def read_payload(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("is_sample_data") is not False or payload.get("data_quality") != "PASS":
        raise RuntimeError(f"Benchmark candidate is not production-valid: {path}")
    date = payload.get("latest_common_market_date") or payload.get("latest_common_trading_date")
    if not isinstance(date, str):
        raise RuntimeError(f"Benchmark candidate has no common market date: {path}")
    payload["latest_common_market_date"] = date
    payload["latest_common_trading_date"] = date
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    candidate = read_payload(args.candidate)
    current = read_payload(args.target) if args.target.exists() else None
    candidate_date = candidate["latest_common_market_date"]
    current_date = current.get("latest_common_market_date") if current else None
    accepted = current_date is None or candidate_date >= current_date
    if accepted:
        args.target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.candidate, args.target)
    print(json.dumps({
        "accepted": accepted,
        "candidate_date": candidate_date,
        "current_date": current_date,
        "target": str(args.target),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
