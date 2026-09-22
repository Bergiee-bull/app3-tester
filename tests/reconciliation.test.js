import assert from "node:assert/strict";
import test from "node:test";
import {
  assertComparisonReconciles,
  buildComparisonReconciliation,
} from "../src/reconciliation.js";
import { buildPerformanceComparison } from "../src/charts.js";

function history(position = "NASDAQ") {
  return {
    schema_version: 1,
    is_sample_data: false,
    data_quality: "PASS",
    strategy_id: "p13h_077_no_cash",
    strategy_version: "v1",
    source: "test",
    positions: [{
      effective_date: "2025-12-01",
      position,
      strategy_id: "p13h_077_no_cash",
      strategy_version: "v1",
    }],
  };
}

function portfolio(overrides = {}) {
  return {
    started_at: "2026-01-03",
    start_capital_sek: 1000,
    transactions: [{
      type: "BUY",
      asset: "NASDAQ",
      instrument: "EQQQ",
      date: "2026-01-03",
      quantity: 1,
      price: 100,
      currency: "EUR",
      fx_rate_to_sek: 10,
      fee_sek: 0,
    }],
    valuations: [{ instrument: "EQQQ", date: "2026-01-06", price: 110, currency: "EUR", fx_rate_to_sek: 10 }],
    ...overrides,
  };
}

function benchmark() {
  return {
    schema_version: 2,
    is_sample_data: false,
    data_quality: "PASS",
    return_basis: "adjusted_close_with_provider_reported_distributions",
    benchmarks: {
      NASDAQ: { price_field: "Adj Close", fx_symbol: "EURSEK=X", fx_source: "test" },
      OMX: { price_field: "Adj Close", fx_symbol: null, fx_source: null },
    },
    latest_common_trading_date: "2026-01-06",
    observations: [
      ["2026-01-05", 1100, 200],
      ["2026-01-06", 1210, 220],
    ],
  };
}

test("actual EQQQ execution is used as the bridge to adjusted close", () => {
  const result = buildPerformanceComparison(portfolio(), benchmark(), history());
  assert.deepEqual(result.strategy.map((row) => row.date), ["2026-01-03", "2026-01-05", "2026-01-06"]);
  assert.equal(result.strategy[0].return_pct, 0);
  assert.ok(Math.abs(result.strategy[1].return_pct - 10) < 1e-12);
  assert.ok(Math.abs(result.strategy.at(-1).return_pct - 21) < 1e-12);
  assert.deepEqual(result.strategy.map((row) => row.asset), ["NASDAQ", "NASDAQ", "NASDAQ"]);
});

test("no-switch EQQQ gross portfolio, App3, and EQQQ B&H reconcile", () => {
  const p = portfolio();
  const curves = buildPerformanceComparison(p, benchmark(), history());
  const result = buildComparisonReconciliation(p, benchmark(), history(), curves);
  assert.equal(result.comparison_start, "2026-01-03");
  assert.equal(result.comparison_end, "2026-01-06");
  assert.ok(Math.abs(result.personal.comparable_gross_return_pct - 21) < 1e-12);
  assert.ok(Math.abs(result.current.app3_strategy_return_pct - 21) < 1e-12);
  assert.ok(Math.abs(result.current.eqqq_buy_and_hold_return_pct - 21) < 1e-12);
  assert.equal(result.reconciliation_passed, true);
  assert.doesNotThrow(() => assertComparisonReconciles(result));
});

test("fees are shown separately from the gross comparison", () => {
  const p = portfolio({
    start_capital_sek: 1000,
    transactions: [{
      type: "BUY", asset: "NASDAQ", instrument: "EQQQ", date: "2026-01-03", quantity: 1,
      price: 100, currency: "EUR", fx_rate_to_sek: 10, fee_sek: 10,
    }],
  });
  const curves = buildPerformanceComparison(p, benchmark(), history());
  const result = buildComparisonReconciliation(p, benchmark(), history(), curves);
  assert.ok(Math.abs(result.personal.comparable_gross_return_pct - 21) < 1e-12);
  assert.ok(Math.abs(result.personal.comparable_net_return_pct - 20) < 1e-12);
  assert.ok(Math.abs(result.breakdown.fees_pp + 1) < 1e-12);
  assert.ok(Math.abs(result.breakdown.unexplained_residual_pp) < 1e-12);
});

test("dividend cash is not double-counted against adjusted close", () => {
  const p = portfolio({
    transactions: [
      { type: "BUY", asset: "NASDAQ", instrument: "EQQQ", date: "2026-01-03", quantity: 1, price: 100, currency: "EUR", fx_rate_to_sek: 10, fee_sek: 0 },
      { type: "DIVIDEND", asset: "NASDAQ", instrument: "EQQQ", date: "2026-01-06", quantity: 1, price: 10, currency: "SEK", fx_rate_to_sek: 1, fee_sek: 0 },
    ],
  });
  const data = { ...benchmark(), observations: [["2026-01-05", 1100, 200], ["2026-01-06", 1210, 220]] };
  const curves = buildPerformanceComparison(p, data, history());
  const result = buildComparisonReconciliation(p, data, history(), curves);
  assert.ok(Math.abs(result.personal.comparable_net_return_pct - 21) < 1e-12);
  assert.match(result.warnings.join(" "), /Utdelning/);
});

test("a later personal valuation is not compared as if it were the benchmark end date", () => {
  const p = portfolio({ valuations: [{ instrument: "EQQQ", date: "2026-01-07", price: 120, currency: "EUR", fx_rate_to_sek: 10 }] });
  const curves = buildPerformanceComparison(p, benchmark(), history());
  const result = buildComparisonReconciliation(p, benchmark(), history(), curves);
  assert.equal(result.portfolio_as_of_date, "2026-01-07");
  assert.equal(result.latest_common_comparison_date, "2026-01-06");
  assert.notEqual(result.portfolio_as_of_date, result.latest_common_comparison_date);
  assert.notEqual(result.breakdown.date_cut_pp, 0);
});

test("assertComparisonReconciles fails for a residual outside tolerance", () => {
  const p = portfolio();
  const curves = buildPerformanceComparison(p, benchmark(), history());
  const corrupted = buildComparisonReconciliation(p, benchmark(), history(), {
    ...curves,
    strategy: curves.strategy.map((row, index) => index === curves.strategy.length - 1 ? { ...row, return_pct: 30 } : row),
  });
  assert.equal(corrupted.reconciliation_passed, false);
  assert.throws(() => assertComparisonReconciles(corrupted), /reconcileras/);
});
