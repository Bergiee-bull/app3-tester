import assert from "node:assert/strict";
import test from "node:test";
import { createPortfolioStore, emptyPortfolio, migratePortfolio, STORAGE_KEY } from "../src/storage.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("portfolio persists only through injected browser-local storage", () => {
  const storage = memoryStorage();
  const store = createPortfolioStore(storage);
  const portfolio = { ...emptyPortfolio(), started_at: "2026-09-12", start_capital_sek: 10000 };
  store.save(portfolio);
  assert.equal(store.load().start_capital_sek, 10000);
  assert.equal(storage.values.has(STORAGE_KEY), true);
});

test("version zero backup migrates without losing transactions", () => {
  const migrated = migratePortfolio({ schema_version: 0, transactions: [{ id: "old" }], theme: "dark" });
  assert.equal(migrated.schema_version, 1);
  assert.equal(migrated.transactions[0].id, "old");
  assert.equal(migrated.settings.theme, "dark");
});

test("backup export import and reset round-trip", () => {
  const store = createPortfolioStore(memoryStorage());
  store.save({ ...emptyPortfolio(), started_at: "2026-09-12", start_capital_sek: 12500 });
  const backup = store.exportJson();
  store.reset();
  assert.equal(store.load().started_at, null);
  store.importJson(backup);
  assert.equal(store.load().start_capital_sek, 12500);
});

test("unsupported backup fails closed", () => {
  assert.throws(() => migratePortfolio({ schema_version: 99 }), /version stöds inte/);
});
