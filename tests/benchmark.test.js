import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { validateBenchmarkData } from "../src/benchmark_data.js";
import { buildPerformanceComparison } from "../src/charts.js";

const benchmarks = JSON.parse(fs.readFileSync(new URL("../data/benchmark_series.json", import.meta.url), "utf8"));

test("public benchmark data is validated and never sample data", () => {
  assert.equal(validateBenchmarkData(benchmarks), true);
  assert.equal(benchmarks.is_sample_data, false);
  assert.equal(benchmarks.data_quality, "PASS");
  assert.equal(benchmarks.benchmarks.NASDAQ.adjusted_close_available, true);
  assert.equal(benchmarks.benchmarks.OMX.adjusted_close_available, true);
  assert.equal(benchmarks.latest_valuations.NASDAQ.currency, "EUR");
  assert.ok(benchmarks.latest_valuations.NASDAQ.fx_rate_to_sek > 0);
  assert.equal(benchmarks.latest_valuations.OMX.currency, "SEK");
  assert.equal(benchmarks.latest_valuations.OMX.fx_rate_to_sek, 1);
});

test("sample benchmark data fails closed", () => {
  const sample = structuredClone(benchmarks);
  sample.is_sample_data = true;
  assert.equal(validateBenchmarkData(sample), false);
});

test("sample or malformed automatic valuations fail closed", () => {
  const sampleQuote = structuredClone(benchmarks);
  sampleQuote.latest_valuations.NASDAQ.is_sample_data = true;
  assert.equal(validateBenchmarkData(sampleQuote), false);

  const missingFx = structuredClone(benchmarks);
  delete missingFx.latest_valuations.NASDAQ.fx_rate_to_sek;
  assert.equal(validateBenchmarkData(missingFx), false);
});

test("benchmarks start together from the first common date on or after the App3 purchase", () => {
  const data = {
    observations: [
      ["2026-01-02", 100, 200],
      ["2026-01-05", 110, 190],
      ["2026-01-06", 121, 220],
    ],
  };
  const portfolio = {
    started_at: "2026-01-03",
    start_capital_sek: 1000,
    transactions: [
      { type: "BUY", asset: "NASDAQ", instrument: "EQQQ", date: "2026-01-03", quantity: 1 },
    ],
    snapshots: [
      { date: "2026-01-05", value_sek: 1000 },
      { date: "2026-01-06", value_sek: 1100 },
    ],
  };
  const result = buildPerformanceComparison(portfolio, data);
  assert.equal(result.comparisonStartDate, "2026-01-05");
  assert.equal(result.nasdaq[0].return_pct, 0);
  assert.equal(result.omx[0].return_pct, 0);
  assert.ok(Math.abs(result.nasdaq[1].return_pct - 10) < 1e-9);
  assert.ok(Math.abs(result.omx[1].return_pct - 15.7894736842) < 1e-8);
});

test("App3 chart segments retain the held asset and switch markers", () => {
  const portfolio = {
    started_at: "2026-01-02",
    start_capital_sek: 1000,
    transactions: [
      { type: "BUY", asset: "NASDAQ", instrument: "EQQQ", date: "2026-01-02", quantity: 1 },
      { type: "SELL", asset: "NASDAQ", instrument: "EQQQ", date: "2026-02-02", quantity: 1 },
      { type: "BUY", asset: "OMX", instrument: "XACT OMXS30", date: "2026-02-02", quantity: 1 },
    ],
    snapshots: [
      { date: "2026-01-02", value_sek: 1000 },
      { date: "2026-02-02", value_sek: 1050 },
      { date: "2026-03-02", value_sek: 1100 },
    ],
  };
  const result = buildPerformanceComparison(portfolio, {
    observations: [["2026-01-02", 100, 100], ["2026-03-02", 110, 105]],
  });
  assert.deepEqual(result.app3.map((row) => row.asset), ["NASDAQ", "OMX", "OMX"]);
  assert.deepEqual(result.switchDates, ["2026-02-02"]);
});
