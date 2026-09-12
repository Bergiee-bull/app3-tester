import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const signalText = fs.readFileSync(new URL("data/app3_signal.json", root), "utf8");
const signal = JSON.parse(signalText);
const appSource = fs.readFileSync(new URL("src/app.js", root), "utf8");
const index = fs.readFileSync(new URL("index.html", root), "utf8");
const css = fs.readFileSync(new URL("src/styles.css", root), "utf8");

test("public signal has no private fields", () => {
  const forbidden = [
    "quantity", "purchase_price", "starting_value_sek", "current_value_sek", "account_value",
    "personal_return", "telegram", "token", "api_key", "secret", "current_position_path", "local_path",
  ];
  const lower = signalText.toLowerCase();
  forbidden.forEach((field) => assert.equal(lower.includes(`\"${field}\"`), false, field));
  assert.deepEqual(Object.keys(signal).sort(), ["generated_at", "is_sample_data", "schema_version", "signal", "strategy", "system"]);
});

test("frontend contains no strategy engine or production mutation path", () => {
  const lower = appSource.toLowerCase();
  ["decision_v1.json", "app3_position_state", "set_current_position", "telegram", "place_order", "localhost"].forEach((term) => {
    assert.equal(lower.includes(term), false, term);
  });
  assert.equal(/p13h_077/.test(appSource), false);
});

test("PWA and responsive accessibility hooks exist", () => {
  assert.match(index, /rel="manifest"/);
  assert.match(index, /aria-live="polite"/);
  assert.match(index, /skip-link/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /min-height: 44px/);
});

test("UI exposes the exact selectable ETF for each market", () => {
  assert.match(index, /ETF att äga enligt signalen/);
  assert.match(index, /ETF\/instrument/);
  assert.match(appSource, /asset\.instrument_name/);
});

test("privacy statement matches local-only implementation", () => {
  assert.match(index, /lagras lokalt i din webbläsare/);
  assert.match(appSource, /window\.localStorage/);
  assert.doesNotMatch(appSource, /fetch\([^\n]*(portfolio|transaction)/i);
});
