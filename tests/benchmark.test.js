import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { validateBenchmarkData } from "../src/benchmark_data.js";
import { buildPerformanceComparison } from "../src/charts.js";
import { validateStrategyHistory } from "../src/strategy_history.js";
import { validateMarketStatus } from "../src/market_status.js";

const benchmarks = JSON.parse(fs.readFileSync(new URL("../data/benchmark_series.json", import.meta.url), "utf8"));

function history(positions) {
  return {
    schema_version: 1,
    is_sample_data: false,
    data_quality: "PASS",
    strategy_id: "p13h_077_no_cash",
    strategy_version: "v1",
    source: "test",
    positions: positions.map((position) => ({
      effective_date: position[0],
      position: position[1],
      strategy_id: "p13h_077_no_cash",
      strategy_version: "v1",
    })),
  };
}

test("public benchmark data is validated and never sample data", () => {
  assert.equal(validateBenchmarkData(benchmarks), true);
  assert.equal(benchmarks.is_sample_data, false);
  assert.equal(benchmarks.data_quality, "PASS");
  assert.equal(benchmarks.latest_common_market_date, benchmarks.latest_common_trading_date);
  assert.equal(benchmarks.source_dates["EQQQ.DE_adjusted_close"], benchmarks.benchmarks.NASDAQ.last_date);
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

test("common market date cannot be fabricated by forward fill or mixed dates", () => {
  const mixed = structuredClone(benchmarks);
  mixed.latest_common_market_date = "2099-01-01";
  mixed.latest_common_trading_date = "2099-01-01";
  assert.equal(validateBenchmarkData(mixed), false);

  const missingAlias = structuredClone(benchmarks);
  delete missingAlias.latest_common_market_date;
  assert.equal(validateBenchmarkData(missingAlias), false);
});

test("public market status is explicit and non-sample", () => {
  const status = JSON.parse(fs.readFileSync(new URL("../data/public_market_update_status.json", import.meta.url), "utf8"));
  assert.equal(validateMarketStatus(status), true);
  assert.equal(status.is_sample_data, false);
  assert.ok(status.latest_verified_market_date);
});

test("sample or malformed automatic valuations fail closed", () => {
  const sampleQuote = structuredClone(benchmarks);
  sampleQuote.latest_valuations.NASDAQ.is_sample_data = true;
  assert.equal(validateBenchmarkData(sampleQuote), false);

  const missingFx = structuredClone(benchmarks);
  delete missingFx.latest_valuations.NASDAQ.fx_rate_to_sek;
  assert.equal(validateBenchmarkData(missingFx), false);
});

test("comparison keeps the actual App3 start and bridges to the first market observation", () => {
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
  const result = buildPerformanceComparison(portfolio, data, history([["2025-12-01", "NASDAQ"]]));
  assert.equal(result.comparisonStartDate, "2026-01-03");
  assert.equal(result.firstMarketObservation, "2026-01-05");
  assert.equal(result.nasdaq[0].return_pct, 0);
  assert.equal(result.omx[0].return_pct, 0);
  assert.ok(Math.abs(result.nasdaq[1].return_pct) < 1e-12);
  assert.ok(Math.abs(result.nasdaq[2].return_pct - 10) < 1e-9);
  assert.ok(Math.abs(result.omx[2].return_pct - 15.7894736842) < 1e-8);
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
  }, history([["2025-12-01", "NASDAQ"], ["2026-02-02", "OMX"]]));
  assert.deepEqual(result.app3.map((row) => row.asset), ["NASDAQ", "OMX"]);
  assert.deepEqual(result.switchDates, ["2026-02-02"]);
});

test("NASDAQ-only strategy equals EQQQ buy and hold on every date", () => {
  const portfolio = {
    started_at: "2026-01-02",
    start_capital_sek: 1000,
    transactions: [
      { type: "BUY", asset: "NASDAQ", instrument: "EQQQ", date: "2026-01-02", quantity: 1 },
    ],
    snapshots: [
      { date: "2026-01-02", value_sek: 1025 },
      { date: "2026-01-05", value_sek: 1127.5 },
      { date: "2026-01-06", value_sek: 1200 },
    ],
  };
  const result = buildPerformanceComparison(portfolio, {
    observations: [
      ["2026-01-02", 100, 200],
      ["2026-01-05", 110, 190],
      ["2026-01-06", 120, 220],
    ],
  }, history([["2025-12-01", "NASDAQ"]]));
  assert.equal(result.strategyHistoryValid, true);
  assert.deepEqual(result.app3.map((row) => row.date), ["2026-01-02", "2026-01-05", "2026-01-06"]);
  result.app3.forEach((row, index) => assert.ok(Math.abs(row.return_pct - result.nasdaq[index].return_pct) < 1e-12));
  assert.equal(result.app3[0].return_pct, 0);
});

test("OMX-only strategy equals XACT buy and hold on every date", () => {
  const portfolio = {
    started_at: "2026-01-02",
    start_capital_sek: 1000,
    transactions: [
      { type: "BUY", asset: "NASDAQ", instrument: "EQQQ", date: "2026-01-02", quantity: 1 },
    ],
    snapshots: [
      { date: "2026-01-02", value_sek: 1000 },
      { date: "2026-01-05", value_sek: 1100 },
      { date: "2026-01-06", value_sek: 1200 },
    ],
  };
  const result = buildPerformanceComparison(portfolio, {
    observations: [
      ["2026-01-02", 100, 200],
      ["2026-01-05", 110, 190],
      ["2026-01-06", 120, 220],
    ],
  }, history([["2025-12-01", "OMX"]]));
  result.app3.forEach((row, index) => assert.ok(Math.abs(row.return_pct - result.omx[index].return_pct) < 1e-12));
  assert.equal(result.app3[0].return_pct, 0);
});

test("A strategy switch chains returns without rebasing", () => {
  const result = buildPerformanceComparison(
    { started_at: "2026-01-02" },
    {
      observations: [
        ["2026-01-02", 100, 200],
        ["2026-01-05", 110, 190],
        ["2026-01-06", 121, 200],
      ],
    },
    history([["2025-12-01", "NASDAQ"], ["2026-01-06", "OMX"]]),
  );
  assert.deepEqual(result.app3.map((row) => row.asset), ["NASDAQ", "NASDAQ", "OMX"]);
  assert.ok(Math.abs(result.app3[1].return_pct - 10) < 1e-12);
  assert.ok(Math.abs(result.app3[2].return_pct - ((1.1 * (200 / 190) - 1) * 100)) < 1e-12);
  result.nasdaq.forEach((row, index) => assert.ok(Math.abs(row.return_pct - [0, 10, 21][index]) < 1e-12));
});

test("Personal purchase data does not affect strategy equity", () => {
  const benchmarkData = {
    observations: [
      ["2026-01-02", 100, 200],
      ["2026-01-05", 110, 190],
    ],
  };
  const strategyHistory = history([["2025-12-01", "NASDAQ"]]);
  const first = buildPerformanceComparison(
    { started_at: "2026-01-02", start_capital_sek: 1000, snapshots: [{ date: "2026-01-02", value_sek: 1000 }] },
    benchmarkData,
    strategyHistory,
  );
  const second = buildPerformanceComparison(
    { started_at: "2026-01-02", start_capital_sek: 999999, snapshots: [{ date: "2026-01-02", value_sek: 123456 }] },
    benchmarkData,
    strategyHistory,
  );
  assert.deepEqual(second.strategy, first.strategy);
  assert.deepEqual(second.nasdaq, first.nasdaq);
});

test("Invalid or missing strategy history blocks the comparison", () => {
  const result = buildPerformanceComparison(
    { started_at: "2026-01-02" },
    { observations: [["2026-01-02", 100, 200], ["2026-01-05", 110, 190]] },
    null,
  );
  assert.equal(result.strategyHistoryValid, false);
  assert.deepEqual(result.strategy, []);
});
