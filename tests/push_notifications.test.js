import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSwitchEvent,
  isDuplicateEvent,
  markEventSent,
  notificationPayload,
  sendOneSignalNotification,
  verifySignalForPush,
} from "../scripts/push_switch_event.mjs";

const registry = {
  NASDAQ: { display_name: "Nasdaq 100", instrument_name: "Invesco EQQQ Nasdaq-100 UCITS ETF Dist" },
  OMX: { display_name: "Sverige / OMX", instrument_name: "XACT OMXS30 ESG (UCITS ETF)" },
};

function signal(overrides = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-09-23T09:15:00+02:00",
    is_sample_data: false,
    strategy: { id: "p13h_077_no_cash", display_name: "App3", version: "v1" },
    signal: {
      recommended_asset: "OMX",
      previous_asset: "NASDAQ",
      action: "SWITCH",
      signal_date: "2026-09-23",
      effective_date: "2026-09-24",
      ...overrides,
    },
    system: { status: "OK", data_quality: "PASS", market_date: "2026-09-23" },
  };
}

test("HOLD and same-position updates produce zero push events", () => {
  assert.equal(buildSwitchEvent(signal({ action: "HOLD", recommended_asset: "NASDAQ" }), registry), null);
  assert.equal(buildSwitchEvent(signal({ recommended_asset: "NASDAQ", previous_asset: "NASDAQ" }), registry), null);
  assert.equal(buildSwitchEvent(signal({ recommended_asset: "OMX", previous_asset: "OMX" }), registry), null);
});

test("NASDAQ to OMX and OMX to NASDAQ produce one strict event", () => {
  const toOmx = buildSwitchEvent(signal(), registry);
  const toNasdaq = buildSwitchEvent(signal({ recommended_asset: "NASDAQ", previous_asset: "OMX" }), registry);
  assert.equal(toOmx.from_position, "NASDAQ");
  assert.equal(toOmx.to_position, "OMX");
  assert.equal(toNasdaq.from_position, "OMX");
  assert.equal(toNasdaq.to_position, "NASDAQ");
  assert.match(toOmx.body, /XACT OMXS30 ESG/);
  assert.match(toNasdaq.body, /Invesco EQQQ Nasdaq-100/);
});

test("signal eligibility blocks bad quality, sample, stale, and invalid identity", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  assert.equal(verifySignalForPush(signal({}), registry, { now }).eligible, true);
  assert.equal(verifySignalForPush({ ...signal(), is_sample_data: true }, registry, { now }).eligible, false);
  assert.equal(verifySignalForPush({ ...signal(), system: { ...signal().system, data_quality: "WARN" } }, registry, { now }).eligible, false);
  assert.equal(verifySignalForPush({ ...signal(), system: { ...signal().system, market_date: "2026-09-15" } }, registry, { now }).eligible, false);
  assert.equal(verifySignalForPush(signal({ recommended_asset: "DEFENSIVE_EQUITY" }), registry, { now }).eligible, false);
});

test("duplicate event is suppressed and only provider success marks state", () => {
  const event = buildSwitchEvent(signal(), registry);
  const initial = {};
  assert.equal(isDuplicateEvent(initial, event.signal_event_id), false);
  const sent = markEventSent(initial, event, { id: "provider-1" }, "2026-09-23T10:00:00Z");
  assert.equal(isDuplicateEvent(sent, event.signal_event_id), true);
  assert.equal(initial.last_notified_event_id, undefined);
});

test("provider failure does not mark the event as sent", async () => {
  const event = buildSwitchEvent(signal(), registry);
  await assert.rejects(
    sendOneSignalNotification(event, {
      appId: "app-id",
      apiKey: "secret-not-written",
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ errors: ["failed"] }) }),
    }),
    /OneSignal API-fel 500/,
  );
});

test("successful provider request contains only public switch data", async () => {
  const event = buildSwitchEvent(signal(), registry);
  let request;
  const response = await sendOneSignalNotification(event, {
    appId: "public-app-id",
    apiKey: "secret-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: "provider-1", recipients: 2 }) };
    },
  });
  assert.deepEqual(response, { id: "provider-1", recipients: 2 });
  assert.equal(request.url, "https://api.onesignal.com/notifications");
  assert.equal(request.options.headers.Authorization, "Key secret-token");
  const body = JSON.parse(request.options.body);
  assert.equal(body.data.event_type, "app3_position_switch");
  assert.equal(body.url, "https://bergiee-bull.github.io/app3-tester/");
  assert.equal(JSON.stringify(body).includes("portfolio"), false);
  assert.equal(JSON.stringify(body).includes("start_value"), false);
});

test("push state file can be persisted without repository data", () => {
  const event = buildSwitchEvent(signal(), registry);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "app3-push-"));
  const state = markEventSent({}, event, { id: "provider-1" });
  const statePath = path.join(tempDir, "push_notification_state.json");
  fs.writeFileSync(statePath, JSON.stringify(state));
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).last_notified_event_id, event.signal_event_id);
});

test("frontend exposes opt-in wording and preserves PWA worker updates", () => {
  const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(index, /Notiser vid byte/i);
  assert.match(index, /Aktivera notiser/);
  assert.match(index, /Stäng av notiser/);
  assert.match(index, /v=1\.4\.0/);
  assert.match(app, /initPushControls/);
  assert.match(worker, /app3-tester-v1\.4\.0/);
  assert.match(worker, /data\/push_config\.json/);
});

test("secrets and personal portfolio fields are absent from the public push implementation", () => {
  const source = fs.readFileSync(new URL("../scripts/push_switch_event.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /purchase_price|current_value|quantity|start_capital|decision_v1|current_position/i);
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|ONESIGNAL_REST_API_KEY\s*=/);
  const worker = fs.readFileSync(new URL("../onesignal/OneSignalSDKWorker.js", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /secret|token\s*=/i);
});
