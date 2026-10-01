"""Offline regression tests. Fixtures never write production or public data."""
import importlib.util
import json
from datetime import datetime
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("exporter", ROOT / "scripts/export_public_benchmarks.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class BenchmarkExportTests(unittest.TestCase):
    def frame(self, symbol):
        dates = pd.bdate_range("2025-01-01", "2026-09-30")
        if symbol == "EQQQ.DE":
            dates = dates[dates != pd.Timestamp("2026-09-29")]
        return pd.DataFrame({"Close": 100.0, "Adj Close": 99.0}, index=dates)

    def payload(self):
        with patch.object(exporter.yf, "download", side_effect=lambda symbol, **kw: self.frame(symbol)):
            with patch.object(exporter.yf, "Ticker") as ticker:
                ticker.return_value.history.return_value = self.frame("EQQQ.DE")
                return exporter.build_payload(datetime.fromisoformat("2026-09-30T16:00:00+02:00"))

    def test_missing_eqqq_day_is_not_filled_and_valuations_share_common_date(self):
        payload = self.payload()
        self.assertEqual(payload["latest_common_market_date"], "2026-09-28")
        self.assertEqual(payload["source_dates"], {
            "EQQQ.DE_adjusted_close": "2026-09-28",
            "XACT-OMXS30.ST_adjusted_close": "2026-09-29",
            "EURSEK=X_close": "2026-09-29",
        })
        self.assertEqual({v["date"] for v in payload["latest_valuations"].values()}, {"2026-09-28"})
        self.assertNotIn("2026-09-29", [row[0] for row in payload["observations"]])
        self.assertEqual(payload["market_data_diagnostics"]["blocking_series"], ["EQQQ.DE"])
        self.assertEqual(payload["market_data_diagnostics"]["status"], "WARN")

    def test_current_intraday_row_is_excluded(self):
        self.assertNotIn("2026-09-30", [row[0] for row in self.payload()["observations"]])

    def test_fx_daily_bar_is_not_final_during_its_utc_day(self):
        now = datetime.fromisoformat("2026-09-30T22:15:00+02:00")
        self.assertEqual(str(exporter.latest_completed_market_date(now)), "2026-09-30")
        self.assertEqual(str(exporter.latest_completed_market_date(now, symbol="EURSEK=X")), "2026-09-29")

    def test_failed_fetch_uses_explicit_same_provider_fallback(self):
        diagnostics = {}
        with patch.object(exporter.yf, "download", side_effect=RuntimeError("offline")):
            with patch.object(exporter.yf, "Ticker") as ticker:
                ticker.return_value.history.return_value = self.frame("EQQQ.DE")
                result = exporter.market_prices("EQQQ.DE", datetime(2026, 9, 29).date(), diagnostics=diagnostics)
        self.assertEqual(str(result["Close"].index[-1].date()), "2026-09-28")
        self.assertTrue(diagnostics["EQQQ.DE"]["fallback_used"])
        self.assertEqual(diagnostics["EQQQ.DE"]["selected_transport"], "history")
        self.assertEqual(diagnostics["EQQQ.DE"]["source"], "Yahoo Finance via yfinance")

    def test_both_requests_fail_without_fabricated_data(self):
        with patch.object(exporter.yf, "download", side_effect=RuntimeError("offline")):
            with patch.object(exporter.yf, "Ticker") as ticker:
                ticker.return_value.history.side_effect = RuntimeError("offline")
                with self.assertRaises(exporter.MarketDataUnavailable) as error:
                    exporter.build_payload(datetime.fromisoformat("2026-10-01T09:00:00+02:00"))
        report = error.exception.diagnostics
        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(set(report["blocking_series"]), set(exporter.SYMBOLS))
        self.assertIsNone(report["latest_common_date"])

    def test_complete_day_advances_graph_and_valuation(self):
        with patch.object(exporter.yf, "download", return_value=self.frame("XACT-OMXS30.ST")):
            payload = exporter.build_payload(datetime.fromisoformat("2026-10-01T09:00:00+02:00"))
        self.assertEqual(payload["latest_common_market_date"], "2026-09-30")
        self.assertEqual(payload["market_data_diagnostics"]["status"], "PASS")
        self.assertEqual(payload["latest_valuations"]["NASDAQ"]["date"], "2026-09-30")
        self.assertEqual(payload["benchmarks"]["OMX"]["symbol"], "XACT-OMXS30.ST")
        self.assertEqual(payload["benchmarks"]["OMX"]["instrument_name"], "XACT OMXS30 ESG (UCITS ETF)")

    def test_weekend_expects_friday(self):
        dates, common = exporter.expected_dates(datetime.fromisoformat("2026-10-04T12:00:00+02:00"))
        self.assertEqual(set(dates.values()), {"2026-10-02"})
        self.assertEqual(common, "2026-10-02")

    def test_exchange_holiday_calendars_differ(self):
        dates, common = exporter.expected_dates(datetime.fromisoformat("2026-06-20T12:00:00+02:00"))
        self.assertEqual(dates["EQQQ.DE"], "2026-06-19")
        self.assertEqual(dates["XACT-OMXS30.ST"], "2026-06-18")
        self.assertEqual(common, "2026-06-18")

    def test_shared_christmas_holiday_does_not_require_trading(self):
        dates, common = exporter.expected_dates(datetime.fromisoformat("2026-12-26T12:00:00+01:00"))
        self.assertEqual(common, "2026-12-23")
        self.assertEqual(dates["XACT-OMXS30.ST"], "2026-12-23")

    def test_calendar_difference_is_not_a_stale_warning_or_forward_fill(self):
        def download(symbol, **kwargs):
            frame = self.frame(symbol)
            if symbol == "XACT-OMXS30.ST":
                frame = frame.drop(pd.Timestamp("2026-06-19"))
            return frame
        with patch.object(exporter.yf, "download", side_effect=download):
            payload = exporter.build_payload(datetime.fromisoformat("2026-06-20T12:00:00+02:00"))
        self.assertEqual(payload["latest_common_market_date"], "2026-06-18")
        self.assertEqual(payload["market_data_diagnostics"]["status"], "PASS")
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "data.json"
            output = Path(folder) / "status.json"
            source.write_text(json.dumps(payload))
            subprocess.run(["python3", str(ROOT / "scripts/write_public_market_status.py"), "--output", str(output), "--benchmark", str(source), "--current", str(source)], check=True, capture_output=True)
            self.assertEqual(json.loads(output.read_text())["status"], "fresh")

    def test_new_public_signal_can_advance_independently_of_benchmark(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            signal = json.loads((ROOT / "data/app3_signal.json").read_text())
            signal["signal"].update(signal_date="2026-09-29", effective_date="2026-09-30")
            signal["system"]["market_date"] = "2026-09-29"
            (folder / "signal.json").write_text(json.dumps(signal))
            (folder / "benchmark.json").write_text(json.dumps(self.payload()))
            result = subprocess.run(["node", str(ROOT / "scripts/validate-data.mjs"), str(folder / "signal.json"), str(folder / "benchmark.json")], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_status_explains_later_source_rows_without_advancing_common_date(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            source = folder / "benchmark.json"
            source.write_text(json.dumps(self.payload()))
            output = folder / "status.json"
            subprocess.run(["python3", str(ROOT / "scripts/write_public_market_status.py"), "--output", str(output), "--benchmark", str(source), "--current", str(source)], check=True, capture_output=True)
            status = json.loads(output.read_text())
            self.assertEqual(status["status"], "waiting_for_complete_market_day")
            self.assertEqual(status["latest_verified_market_date"], "2026-09-28")


if __name__ == "__main__":
    unittest.main()
