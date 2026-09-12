#!/usr/bin/env python3
"""Export a sanitized, aligned EQQQ/XACT buy-and-hold series for App3 Tester."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "data" / "benchmark_series.json"
START_DATE = "2008-01-01"


def adjusted_close(symbol: str) -> pd.Series:
    frame = yf.download(symbol, start=START_DATE, auto_adjust=False, progress=False, timeout=30)
    if frame.empty or "Adj Close" not in frame:
        raise RuntimeError(f"Yahoo returned no adjusted-close data for {symbol}")
    values = frame["Adj Close"]
    if isinstance(values, pd.DataFrame):
        values = values.iloc[:, 0]
    values = pd.to_numeric(values, errors="coerce").dropna()
    values.index = pd.to_datetime(values.index).tz_localize(None).normalize()
    values = values[~values.index.duplicated(keep="last")].sort_index()
    if len(values) < 260 or (values <= 0).any():
        raise RuntimeError(f"Yahoo data for {symbol} failed row-count or positive-value validation")
    return values


def build_payload() -> dict:
    eqqq_eur = adjusted_close("EQQQ.DE")
    eursek = adjusted_close("EURSEK=X")
    xact_sek = adjusted_close("XACT-OMXS30.ST")
    common = eqqq_eur.index.intersection(eursek.index).intersection(xact_sek.index).sort_values()
    if len(common) < 260:
        raise RuntimeError(f"Only {len(common)} common completed dates are available")

    nasdaq_sek = eqqq_eur.loc[common] * eursek.loc[common]
    omx_sek = xact_sek.loc[common]
    observations = [
        [date.strftime("%Y-%m-%d"), round(float(nasdaq_sek.loc[date]), 6), round(float(omx_sek.loc[date]), 6)]
        for date in common
    ]
    first_date = observations[0][0]
    last_date = observations[-1][0]
    row_count = len(observations)

    return {
        "schema_version": 1,
        "generated_at": datetime.now(ZoneInfo("Europe/Stockholm")).isoformat(timespec="seconds"),
        "is_sample_data": False,
        "data_quality": "PASS",
        "currency": "SEK",
        "return_basis": "adjusted_close_with_provider_reported_distributions",
        "alignment": "common_completed_trading_dates",
        "latest_common_trading_date": last_date,
        "benchmarks": {
            "NASDAQ": {
                "asset": "NASDAQ",
                "instrument_name": "Invesco EQQQ Nasdaq-100 UCITS ETF Dist",
                "symbol": "EQQQ.DE",
                "source": "Yahoo Finance via yfinance",
                "price_field": "Adj Close",
                "currency": "EUR",
                "fx_symbol": "EURSEK=X",
                "fx_source": "Yahoo Finance via yfinance",
                "sek_adjusted": True,
                "adjusted_close_available": True,
                "first_date": first_date,
                "last_date": last_date,
                "row_count": row_count,
            },
            "OMX": {
                "asset": "OMX",
                "instrument_name": "XACT OMXS30 ESG (UCITS ETF)",
                "symbol": "XACT-OMXS30.ST",
                "source": "Yahoo Finance via yfinance",
                "price_field": "Adj Close",
                "currency": "SEK",
                "fx_symbol": None,
                "fx_source": None,
                "sek_adjusted": True,
                "adjusted_close_available": True,
                "first_date": first_date,
                "last_date": last_date,
                "row_count": row_count,
            },
        },
        "observations": observations,
        "warnings": [
            "Benchmarkkurvorna använder Yahoo Adjusted Close och kan avvika från faktisk depåavkastning på grund av avgifter, skatt, spread och leverantörens justeringar."
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    payload = build_payload()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(payload['observations'])} validated common rows "
        f"({payload['observations'][0][0]} to {payload['latest_common_trading_date']}) to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
