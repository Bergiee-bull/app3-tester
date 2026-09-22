#!/usr/bin/env python3
"""Write a public, privacy-safe status for the read-only market refresh."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def payload_date(payload: dict | None) -> str | None:
    if not payload:
        return None
    return payload.get("latest_common_market_date") or payload.get("latest_common_trading_date")


def read_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def safe_error(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"/(?:Users|private|var)/[^\s:]+", "[local-path]", value)
    return cleaned[:500]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--benchmark", type=Path, required=True)
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--status", choices=["auto", "fresh", "waiting_for_complete_market_day", "stale"], default="auto")
    parser.add_argument("--error")
    args = parser.parse_args()

    candidate = read_json(args.benchmark)
    current = read_json(args.current)
    candidate_date = payload_date(candidate)
    current_date = payload_date(current)
    status = args.status
    if status == "auto":
        status = "fresh" if candidate_date and (not current_date or candidate_date >= current_date) else "waiting_for_complete_market_day"
    latest_verified = candidate_date if status == "fresh" else (current_date or candidate_date)
    source_dates = (candidate or {}).get("source_dates", {})
    if not source_dates and candidate:
        source_dates = {
            "EQQQ.DE_adjusted_close": (candidate.get("benchmarks", {}).get("NASDAQ", {}).get("last_date")),
            "XACT-OMXS30.ST_adjusted_close": (candidate.get("benchmarks", {}).get("OMX", {}).get("last_date")),
        }
    payload = {
        "schema_version": 1,
        "source": "public_market_update",
        "status": status,
        "attempted_at": datetime.now(ZoneInfo("Europe/Stockholm")).isoformat(timespec="seconds"),
        "latest_verified_market_date": latest_verified,
        "candidate_market_date": candidate_date,
        "latest_source_dates": source_dates,
        "is_sample_data": False,
        "error": safe_error(args.error),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
