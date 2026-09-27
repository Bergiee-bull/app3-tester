import assert from "node:assert/strict";
import test from "node:test";
import { buildVisibleStrategyEvents } from "../src/strategy_history.js";

const registry = {
  NASDAQ: {
    default_instrument: "EQQQ",
    instrument_name: "Invesco EQQQ Nasdaq-100 UCITS ETF Dist",
  },
  OMX: {
    default_instrument: "XACT OMXS30",
    instrument_name: "XACT OMXS30 ESG (UCITS ETF)",
  },
};

function history() {
  const positions = [
    ["2026-08-17", "NASDAQ"],
    ["2026-09-10", "NASDAQ"],
    ["2026-10-14", "OMX"],
    ["2026-10-15", "OMX"],
    ["2026-12-03", "NASDAQ"],
  ];
  return {
    schema_version: 1,
    is_sample_data: false,
    data_quality: "PASS",
    strategy_id: "p13h_077_no_cash",
    strategy_version: "v1",
    source: "test",
    positions: positions.map(([effective_date, position]) => ({
      effective_date,
      position,
      strategy_id: "p13h_077_no_cash",
      strategy_version: "v1",
    })),
  };
}

test("visible history starts with the canonical position at the user's start date", () => {
  const events = buildVisibleStrategyEvents(history(), "2026-09-08", registry);
  assert.deepEqual(events[0], {
    date: "2026-09-08",
    type: "START",
    from_position: null,
    to_position: "NASDAQ",
    title: "START – NASDAQ",
    instrument: "EQQQ",
    instrument_name: "Invesco EQQQ Nasdaq-100 UCITS ETF Dist",
  });
});

test("same-position HOLD rows are hidden and each real switch appears once", () => {
  const raw = history();
  const rawBefore = structuredClone(raw);
  const events = buildVisibleStrategyEvents(raw, "2026-09-08", registry);

  assert.deepEqual(events.map((event) => event.title), [
    "START – NASDAQ",
    "NASDAQ → OMX",
    "OMX → NASDAQ",
  ]);
  assert.equal(events.filter((event) => event.title === "NASDAQ → OMX").length, 1);
  assert.equal(events.filter((event) => event.title === "OMX → NASDAQ").length, 1);
  assert.equal(events.some((event) => event.title.includes("HOLD")), false);
  assert.deepEqual(raw, rawBefore);
});

test("START uses OMX when OMX is canonical at a later user start", () => {
  const events = buildVisibleStrategyEvents(history(), "2026-11-01", registry);
  assert.equal(events[0].title, "START – OMX");
  assert.equal(events[0].instrument, "XACT OMXS30");
});
