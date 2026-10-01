#!/usr/bin/env python3
"""Export sanitized EQQQ/XACT benchmarks and current ETF valuations."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, time as wall_time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf
import exchange_calendars as xcals


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "data" / "benchmark_series.json"
START_DATE = "2008-01-01"
MARKET_TIMEZONE = ZoneInfo("Europe/Stockholm")
COMPLETED_SESSION_CUTOFF = wall_time(18, 0)
SYMBOLS = ("EQQQ.DE", "XACT-OMXS30.ST", "EURSEK=X")
CALENDARS = {"EQQQ.DE": "XETR", "XACT-OMXS30.ST": "XSTO", "EURSEK=X": "24/5"}


class MarketDataUnavailable(RuntimeError):
    def __init__(self, diagnostics):
        self.diagnostics = diagnostics
        super().__init__("MARKET_DATA_FAIL: " + ", ".join(diagnostics["blocking_series"]))


def expected_sessions(symbol: str, now: datetime) -> pd.DatetimeIndex:
    cutoff = latest_completed_market_date(now, symbol=symbol)
    start = cutoff - timedelta(days=40)
    calendar = xcals.get_calendar(CALENDARS[symbol], start=str(start - timedelta(days=10)), end=str(cutoff + timedelta(days=10)))
    return calendar.sessions_in_range(str(start), str(cutoff)).tz_localize(None)


def expected_dates(now: datetime) -> tuple[dict, str]:
    sessions = {symbol: expected_sessions(symbol, now) for symbol in SYMBOLS}
    common = sessions[SYMBOLS[0]].intersection(sessions[SYMBOLS[1]]).intersection(sessions[SYMBOLS[2]])
    dates = {symbol: rows[-1].strftime("%Y-%m-%d") for symbol, rows in sessions.items()}
    # FX is needed on shared ETF sessions, not on a standalone exchange holiday.
    dates["EURSEK=X"] = common[-1].strftime("%Y-%m-%d")
    return dates, common[-1].strftime("%Y-%m-%d")


def latest_completed_market_date(now: datetime | None = None, *, symbol: str = "EQQQ.DE") -> date:
    local_now = now.astimezone(MARKET_TIMEZONE) if now else datetime.now(MARKET_TIMEZONE)
    # Yahoo FX daily bars remain provisional during their UTC calendar day.
    if symbol == "EURSEK=X":
        return local_now.astimezone(timezone.utc).date() - timedelta(days=1)
    if local_now.timetz().replace(tzinfo=None) < COMPLETED_SESSION_CUTOFF:
        return local_now.date() - timedelta(days=1)
    return local_now.date()


def normalize_prices(frame: pd.DataFrame, symbol: str, completed_through: date) -> dict:
    if frame.empty:
        raise ValueError("empty_response")
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
        values = values[values.index.date <= completed_through]
        if len(values) < 260 or (values <= 0).any() or values.isin([float("inf"), -float("inf")]).any():
            raise RuntimeError(f"Yahoo {field} data for {symbol} failed validation")
        result[field] = values
    return result


def market_prices(symbol: str, completed_through: date, *, expected_date: str | None = None,
                  diagnostics: dict | None = None, now: datetime | None = None) -> dict:
    """Retry the same verified ticker; fallback is another Yahoo request, not an independent source."""
    info = {"symbol": symbol, "source": "Yahoo Finance via yfinance", "fetch_timestamp": (now or datetime.now(MARKET_TIMEZONE)).isoformat(),
            "expected_latest_completed_market_date": expected_date, "latest_raw_date": None,
            "latest_processed_date": None, "latest_close": None, "freshness": "FAIL", "attempts": []}
    selected = None
    for transport in ("download", "history"):
        attempt = {"source": "Yahoo Finance via yfinance", "transport": transport}
        try:
            if transport == "download":
                frame = yf.download(symbol, start=START_DATE, auto_adjust=False, progress=False, timeout=30)
            else:
                frame = yf.Ticker(symbol).history(start=START_DATE, auto_adjust=False, timeout=30)
            raw = frame["Close"].squeeze().dropna()
            attempt["latest_raw_date"] = pd.Timestamp(raw.index[-1]).date().isoformat()
            result = normalize_prices(frame, symbol, completed_through)
            valid_dates = result["Close"].index.intersection(result["Adj Close"].index)
            if valid_dates.empty:
                raise ValueError("no_common_close_adjusted_close_dates")
            last = valid_dates[-1].date().isoformat()
            attempt.update(latest_processed_date=last, status="PASS" if not expected_date or last >= expected_date else "STALE")
            if selected is None or last > info["latest_processed_date"]:
                selected = result
                info.update(latest_raw_date=attempt["latest_raw_date"], latest_processed_date=last,
                            latest_close=float(result["Close"].loc[last]), selected_transport=transport,
                            fallback_used=transport == "history", freshness=attempt["status"])
            if attempt["status"] == "PASS":
                info["attempts"].append(attempt)
                break
        except Exception as error:
            # Provider exception text may contain URLs or local paths. Keep public diagnostics bounded.
            attempt.update(status="FAIL", error=type(error).__name__)
        info["attempts"].append(attempt)
    if diagnostics is not None:
        diagnostics[symbol] = info
    if selected is None:
        raise RuntimeError(f"No validated EOD history for {symbol}; both Yahoo request methods failed")
    return selected


def build_payload(now: datetime | None = None) -> dict:
    now = now or datetime.now(MARKET_TIMEZONE)
    expected, expected_common = expected_dates(now)
    diagnostics = {"status": "PASS", "expected_latest_completed_market_date": expected_common,
                   "latest_common_date": None, "blocking_series": [], "series": {},
                   "calendar_source": "exchange_calendars XETR/XSTO; FX completed UTC days",
                   "independent_fallback_available": False}
    fetched = {}
    for symbol in SYMBOLS:
        try:
            fetched[symbol] = market_prices(symbol, latest_completed_market_date(now, symbol=symbol),
                                           expected_date=expected[symbol], diagnostics=diagnostics["series"], now=now)
        except RuntimeError:
            diagnostics["blocking_series"].append(symbol)
    if diagnostics["blocking_series"]:
        diagnostics["status"] = "FAIL"
        raise MarketDataUnavailable(diagnostics)
    eqqq, xact, eursek = (fetched[symbol] for symbol in SYMBOLS)
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
    common_quote_date = common[-1]
    diagnostics["latest_common_date"] = last_date
    for symbol, values in fetched.items():
        info = diagnostics["series"][symbol]
        required = pd.Timestamp(expected_common)
        info["blocks_common_date"] = any(required not in series.index for series in values.values())
        if info["blocks_common_date"]:
            diagnostics["blocking_series"].append(symbol)
        if info["freshness"] != "PASS" or info["blocks_common_date"]:
            diagnostics["status"] = "WARN"

    return {
        "schema_version": 2,
        "generated_at": now.isoformat(timespec="seconds"),
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
        "market_data_diagnostics": diagnostics,
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
                "date": common_quote_date.strftime("%Y-%m-%d"),
                "price": round(float(eqqq["Close"].loc[common_quote_date]), 6),
                "currency": "EUR",
                "fx_rate_to_sek": round(float(eursek["Close"].loc[common_quote_date]), 6),
                "fx_symbol": "EURSEK=X",
                "source": "Yahoo Finance via yfinance",
                "is_sample_data": False,
            },
            "OMX": {
                "asset": "OMX",
                "instrument": "XACT OMXS30",
                "provider_symbol": "XACT-OMXS30.ST",
                "date": common_quote_date.strftime("%Y-%m-%d"),
                "price": round(float(xact["Close"].loc[common_quote_date]), 6),
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
    parser.add_argument("--doctor", action="store_true", help="Read-only fetch/status; no benchmark file written")
    args = parser.parse_args()
    try:
        payload = build_payload()
    except MarketDataUnavailable as error:
        print(json.dumps(error.diagnostics, ensure_ascii=False, indent=2))
        return 2
    if args.doctor:
        report = payload["market_data_diagnostics"]
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["status"] == "PASS" else 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(payload['observations'])} validated common rows "
        f"({payload['observations'][0][0]} to {payload['latest_common_trading_date']}) to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
