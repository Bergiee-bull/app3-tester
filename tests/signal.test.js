import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { assessSignal, signalViewModel, validatePublicSignal } from "../src/signal.js";

const signal = JSON.parse(fs.readFileSync(new URL("../data/app3_signal.json", import.meta.url), "utf8"));
const registry = JSON.parse(fs.readFileSync(new URL("../data/asset_registry.json", import.meta.url), "utf8"));

test("public signal schema is valid", () => {
  assert.equal(validatePublicSignal(signal).valid, true);
});

test("rendering is strategy agnostic", () => {
  const future = structuredClone(signal);
  future.strategy = { id: "future_strategy", display_name: "App3 Next", version: "2030.1" };
  assert.equal(validatePublicSignal(future).valid, true);
  assert.match(signalViewModel(future, registry).strategyLabel, /future_strategy/);
});

test("NASDAQ HOLD renders an explicit recommendation", () => {
  const view = signalViewModel(signal, registry);
  assert.equal(view.assetName, "Nasdaq 100");
  assert.equal(view.action, "HOLD");
  assert.match(view.message, /fortsatt Nasdaq 100/);
});

test("OMX SWITCH renders source and destination", () => {
  const switched = structuredClone(signal);
  switched.signal = { ...switched.signal, previous_asset: "NASDAQ", recommended_asset: "OMX", action: "SWITCH" };
  const view = signalViewModel(switched, registry);
  assert.equal(view.assetName, "Sverige / OMX");
  assert.equal(view.transition, "Nasdaq 100 → Sverige / OMX");
});

test("stale signal fails closed", () => {
  const status = assessSignal(signal, registry, { now: new Date("2026-10-01T12:00:00Z"), maxBusinessDays: 3 });
  assert.equal(status.verified, false);
  assert.equal(status.stale, true);
  assert.match(status.reason, /inte uppdaterad/);
});

test("data quality failure hides actionable signal", () => {
  const failed = structuredClone(signal);
  failed.system.data_quality = "FAIL";
  const status = assessSignal(failed, registry, { now: new Date("2026-09-12T12:00:00Z") });
  assert.equal(status.verified, false);
  assert.match(status.reason, /Datakvalitetsproblem/);
});

test("sample signal fails closed", () => {
  const sample = structuredClone(signal);
  sample.is_sample_data = true;
  const status = assessSignal(sample, registry, { now: new Date("2026-09-12T12:00:00Z") });
  assert.equal(status.verified, false);
  assert.match(status.reason, /sample/);
});
