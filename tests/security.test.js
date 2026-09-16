import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const signalText = fs.readFileSync(new URL("data/app3_signal.json", root), "utf8");
const benchmarkText = fs.readFileSync(new URL("data/benchmark_series.json", root), "utf8");
const signal = JSON.parse(signalText);
const appSource = fs.readFileSync(new URL("src/app.js", root), "utf8");
const index = fs.readFileSync(new URL("index.html", root), "utf8");
const css = fs.readFileSync(new URL("src/styles.css", root), "utf8");
const publisher = fs.readFileSync(new URL("scripts/update_and_publish_daily.sh", root), "utf8");
const launchd = fs.readFileSync(new URL("launchd/com.app3tester.daily-update.plist.template", root), "utf8");

test("public signal has no private fields", () => {
  const forbidden = [
    "quantity", "purchase_price", "starting_value_sek", "current_value_sek", "account_value",
    "personal_return", "telegram", "token", "api_key", "secret", "current_position_path", "local_path",
  ];
  const lower = signalText.toLowerCase();
  forbidden.forEach((field) => assert.equal(lower.includes(`\"${field}\"`), false, field));
  assert.deepEqual(Object.keys(signal).sort(), ["generated_at", "is_sample_data", "schema_version", "signal", "strategy", "system"]);
});

test("public benchmark export has no private portfolio data or paths", () => {
  const lower = benchmarkText.toLowerCase();
  ["/users/", "quantity", "purchase_price", "starting_value_sek", "current_value_sek", "telegram", "token", "secret"]
    .forEach((term) => assert.equal(lower.includes(term), false, term));
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

test("UI exposes App3 and two buy-and-hold comparison series", () => {
  assert.match(index, /App3: grön Nasdaq \/ röd OMX/);
  assert.match(index, /EQQQ buy &amp; hold/);
  assert.match(index, /XACT OMX buy &amp; hold/);
  assert.match(appSource, /loadBenchmarkData/);
});

test("daily updater is scheduled for 09:15 and 22:00 Europe/Stockholm", () => {
  assert.match(launchd, /<key>Hour<\/key>\s*<integer>9<\/integer>[\s\S]*?<key>Minute<\/key>\s*<integer>15<\/integer>/);
  assert.match(launchd, /<key>Hour<\/key>\s*<integer>22<\/integer>[\s\S]*?<key>Minute<\/key>\s*<integer>0<\/integer>/);
  assert.match(launchd, /Europe\/Stockholm/);
  assert.match(publisher, /app3_export_public_signal\.py/);
  assert.match(publisher, /export_public_benchmarks\.py/);
  assert.match(publisher, /npm|NPM_BIN/);
  assert.match(publisher, /data\/app3_signal\.json\|data\/benchmark_series\.json/);
});

test("automatic market valuation is displayed with EUR/SEK provenance", () => {
  assert.match(index, /Dagligen 09:15 och 22:00/);
  assert.match(index, /valuationSource/);
  assert.match(appSource, /EUR\/SEK/);
  assert.match(appSource, /applyAutomaticValuations/);
});

test("privacy statement matches local-only implementation", () => {
  assert.match(index, /lagras lokalt i din webbläsare/);
  assert.match(appSource, /window\.localStorage/);
  assert.doesNotMatch(appSource, /fetch\([^\n]*(portfolio|transaction)/i);
});

test("local reset uses an in-app confirmation without touching production", () => {
  assert.match(index, /id="resetDialog"/);
  assert.match(index, /Radera lokal data/);
  assert.match(appSource, /confirmResetPortfolio/);
  assert.doesNotMatch(appSource, /\bconfirm\(/);
});
