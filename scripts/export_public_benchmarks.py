#!/usr/bin/env python3
"""Export sanitized EQQQ/XACT benchmarks and current ETF valuations."""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "data" / "benchmark_series.json"
START_DATE = "2008-01-01"


def market_prices(symbol: str) -> dict[str, pd.Series]:
    frame = pd.DataFrame()
    last_error = None
    for attempt in range(3):
        try:
            frame = yf.download(symbol, start=START_DATE, auto_adjust=False, progress=False, timeout=30)
            if not frame.empty:
                break
        except Exception as error:  # pragma: no cover - network/provider dependent
            last_error = error
        if attempt < 2:
            time.sleep(2**attempt)
    if frame.empty:
        detail = f": {last_error}" if last_error else ""
        raise RuntimeError(f"Yahoo returned no market data for {symbol}{detail}")

    result: dict[str, pd.Series] = {}
    for field in ("Adj Close", "Close"):
        if field not in frame:
            raise RuntimeError(f"Yahoo returned no {field} data for {symbol}")
        values = frame[field]
        if isinstance(values, pd.DataFrame):
            values = values.iloc[:, 0]
        values = pd.to_numeric(values, errors="coerce").dropna()
        values.index = pd.to_datetime(values.index).tz_localize(None).normalize()
        values = values[~values.index.duplicated(keep="last")].sort_index()
        if len(values) < 260 or (values <= 0).any():
            raise RuntimeError(f"Yahoo {field} data for {symbol} failed validation")
        result[field] = values
    return result


def build_payload() -> dict:
    eqqq = market_prices("EQQQ.DE")
    eursek = market_prices("EURSEK=X")
    xact = market_prices("XACT-OMXS30.ST")
    common = (
        eqqq["Adj Close"].index
        .intersection(eqqq["Close"].index)
        .intersection(eursek["Close"].index)
        .intersection(xact["Adj Close"].index)
        .intersection(xact["Close"].index)
        .sort_values()
    )
    if len(common) < 260:
        raise RuntimeError(f"Only {len(common)} common completed dates are available")

    nasdaq_sek = eqqq["Adj Close"].loc[common] * eursek["Close"].loc[common]
    omx_sek = xact["Adj Close"].loc[common]
    observations = [
        [date.strftime("%Y-%m-%d"), round(float(nasdaq_sek.loc[date]), 6), round(float(omx_sek.loc[date]), 6)]
        for date in common
    ]
    first_date = observations[0][0]
    last_date = observations[-1][0]
    row_count = len(observations)
    eqqq_quote_dates = eqqq["Close"].index.intersection(eursek["Close"].index).sort_values()
    omx_quote_dates = xact["Close"].index.sort_values()
    eqqq_quote_date = eqqq_quote_dates[-1]
    omx_quote_date = omx_quote_dates[-1]

    return {
        "schema_version": 2,
        "generated_at": datetime.now(ZoneInfo("Europe/Stockholm")).isoformat(timespec="seconds"),
        "is_sample_data": False,
        "data_quality": "PASS",
        "currency": "SEK",
        "return_basis": "adjusted_close_with_provider_reported_distributions",
        "alignment": "common_completed_trading_dates",
        "latest_common_market_date": last_date,
        "latest_common_trading_date": last_date,
        "source_dates": {
            "EQQQ.DE_adjusted_close": eqqq["Adj Close"].index[-1].strftime("%Y-%m-%d"),
            "XACT-OMXS30.ST_adjusted_close": xact["Adj Close"].index[-1].strftime("%Y-%m-%d"),
            "EURSEK=X_close": eursek["Close"].index[-1].strftime("%Y-%m-%d"),
        },
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
        "latest_valuations": {
            "NASDAQ": {
                "asset": "NASDAQ",
                "instrument": "EQQQ",
                "provider_symbol": "EQQQ.DE",
                "date": eqqq_quote_date.strftime("%Y-%m-%d"),
                "price": round(float(eqqq["Close"].loc[eqqq_quote_date]), 6),
                "currency": "EUR",
                "fx_rate_to_sek": round(float(eursek["Close"].loc[eqqq_quote_date]), 6),
                "fx_symbol": "EURSEK=X",
                "source": "Yahoo Finance via yfinance",
                "is_sample_data": False,
            },
            "OMX": {
                "asset": "OMX",
                "instrument": "XACT OMXS30",
                "provider_symbol": "XACT-OMXS30.ST",
                "date": omx_quote_date.strftime("%Y-%m-%d"),
                "price": round(float(xact["Close"].loc[omx_quote_date]), 6),
                "currency": "SEK",
                "fx_rate_to_sek": 1.0,
                "fx_symbol": None,
                "source": "Yahoo Finance via yfinance",
                "is_sample_data": False,
            },
        },
        "observations": observations,
        "warnings": [
            "Benchmarkkurvorna använder Yahoo Adjusted Close och kan avvika från faktisk depåavkastning på grund av avgifter, skatt, spread och leverantörens justeringar.",
            "EQQQ-värderingen använder senaste gemensamma stängningskurs i EUR multiplicerad med EUR/SEK. Kontantutdelningar måste registreras lokalt för att ingå i den faktiska portföljens värde.",
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
