import assert from "node:assert/strict";
import test from "node:test";
import {
  addValuation,
  calculatePortfolio,
  holdingsFromTransactions,
  normalizeTransaction,
  rememberSignal,
} from "../src/portfolio.js";
import { emptyPortfolio } from "../src/storage.js";

const strategy = { id: "any_strategy", version: "1" };

function buy(overrides = {}) {
  return normalizeTransaction({
    id: "buy-1",
    type: "BUY",
    asset: "NASDAQ",
    instrument: "TEST.ETF",
    date: "2026-09-12",
    quantity: 10,
    price: 100,
    currency: "SEK",
    fx_rate_to_sek: 1,
    fee_sek: 10,
    ...overrides,
  }, strategy);
}

test("transaction calculation includes quantity price FX and fee", () => {
  let portfolio = { ...emptyPortfolio(), started_at: "2026-09-12", start_capital_sek: 1010, transactions: [buy()] };
  portfolio = addValuation(portfolio, { instrument: "TEST.ETF", date: "2026-09-13", price: 110, currency: "SEK" });
  const result = calculatePortfolio(portfolio);
  assert.equal(result.currentValueSek, 1100);
  assert.ok(result.totalReturnPct > 8 && result.totalReturnPct < 10);
});

test("BUY and SELL update holdings without automatic orders", () => {
  const transactions = [buy(), buy({ id: "sell-1", type: "SELL", quantity: 4, date: "2026-09-13" })];
  assert.equal(holdingsFromTransactions(transactions)[0].quantity, 6);
});

test("selling more than local holdings is rejected", () => {
  const transactions = [buy(), buy({ id: "sell-1", type: "SELL", quantity: 11, date: "2026-09-13" })];
  assert.throws(() => holdingsFromTransactions(transactions), /överstiger innehavet/);
});

test("signal history preserves strategy identity across migration", () => {
  const first = {
    strategy: { id: "strategy_a", version: "1" },
    signal: { signal_date: "2026-09-12", effective_date: "2026-09-14", action: "HOLD", previous_asset: "NASDAQ", recommended_asset: "NASDAQ" },
  };
  const second = structuredClone(first);
  second.strategy = { id: "strategy_b", version: "2" };
  second.signal.signal_date = "2027-01-04";
  let portfolio = rememberSignal(emptyPortfolio(), first);
  portfolio = rememberSignal(portfolio, second);
  assert.deepEqual(portfolio.signal_history.map((row) => row.strategy_id), ["strategy_b", "strategy_a"]);
});

test("missing market valuation never fabricates current value", () => {
  const result = calculatePortfolio({ ...emptyPortfolio(), started_at: "2026-09-12", start_capital_sek: 1010, transactions: [buy()] });
  assert.equal(result.currentValueSek, null);
  assert.equal(result.totalReturnPct, null);
});
