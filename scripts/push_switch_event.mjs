import fs from "node:fs";
import path from "node:path";
import { assessSignal, validatePublicSignal } from "../src/signal.js";

const APP_URL = "https://bergiee-bull.github.io/app3-tester/";
const ALLOWED_SWITCHES = new Set(["NASDAQ->OMX", "OMX->NASDAQ"]);

export function switchKey(previous, next) {
  return `${previous}->${next}`;
}

export function buildSwitchEvent(payload, registry) {
  const previous = payload?.signal?.previous_asset;
  const next = payload?.signal?.recommended_asset;
  const key = switchKey(previous, next);
  if (payload?.signal?.action !== "SWITCH") return null;
  if (previous === next || !ALLOWED_SWITCHES.has(key)) return null;
  const asset = registry?.[next];
  const from = registry?.[previous];
  if (!asset || !from) return null;
  const eventId = [
    payload.strategy.id,
    payload.signal.signal_date,
    payload.signal.effective_date,
    previous,
    next,
  ].join("_");
  const direction = key === "NASDAQ->OMX" ? "Nasdaq -> OMX" : "OMX -> Nasdaq";
  const date = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(`${payload.signal.effective_date}T12:00:00`));
  return {
    signal_event_id: eventId,
    strategy_id: payload.strategy.id,
    signal_date: payload.signal.signal_date,
    effective_date: payload.signal.effective_date,
    from_position: previous,
    to_position: next,
    title: "App3 - Ny signal",
    body: `Byt ${direction}\nETF: ${asset.instrument_name}\nGäller från ${date}`,
    url: APP_URL,
    data: {
      event_type: "app3_position_switch",
      signal_event_id: eventId,
      from_position: previous,
      to_position: next,
      effective_date: payload.signal.effective_date,
      url: APP_URL,
    },
  };
}

export function verifySignalForPush(payload, registry, { now = new Date(), maxBusinessDays = 3 } = {}) {
  const validation = validatePublicSignal(payload);
  if (!validation.valid) return { eligible: false, reason: validation.errors.join(" ") };
  const assessment = assessSignal(payload, registry, { now, maxBusinessDays });
  if (!assessment.verified) return { eligible: false, reason: assessment.reason };
  const event = buildSwitchEvent(payload, registry);
  if (!event) return { eligible: false, reason: "Ingen verifierad Nasdaq/OMX-positionsförändring." };
  return { eligible: true, event };
}

export function isDuplicateEvent(state, eventId) {
  return state?.last_notified_event_id === eventId;
}

export function markEventSent(state, event, providerResponse, sentAt = new Date().toISOString()) {
  return {
    ...state,
    last_notified_event_id: event.signal_event_id,
    last_success_at: sentAt,
    last_provider_response: providerResponse,
    last_from: event.from_position,
    last_to: event.to_position,
  };
}

export function notificationPayload(event, appId) {
  return {
    app_id: appId,
    target_channel: "push",
    name: event.signal_event_id,
    included_segments: ["Subscribed Users"],
    headings: { sv: event.title, en: event.title },
    contents: { sv: event.body, en: event.body },
    url: event.url,
    data: event.data,
  };
}

export async function sendOneSignalNotification(event, { appId, apiKey, fetchImpl = fetch } = {}) {
  if (!appId) throw new Error("ONESIGNAL_APP_ID saknas.");
  if (!apiKey) throw new Error("ONESIGNAL_REST_API_KEY saknas.");
  const response = await fetchImpl("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(notificationPayload(event, appId)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OneSignal API-fel ${response.status}: ${body.errors || body.message || "okänt fel"}`);
  return { id: body.id || null, recipients: body.recipients ?? null };
}

export function defaultStatePath(home = process.env.HOME || process.cwd()) {
  return path.join(home, "Library", "Application Support", "App3 Tester", "push_notification_state.json");
}

export function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
