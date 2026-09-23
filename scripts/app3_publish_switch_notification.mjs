#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  buildSwitchEvent,
  defaultStatePath,
  isDuplicateEvent,
  markEventSent,
  readState,
  sendOneSignalNotification,
  verifySignalForPush,
  writeState,
} from "./push_switch_event.mjs";

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..");
const signalPath = path.join(repoRoot, "data", "app3_signal.json");
const registryPath = path.join(repoRoot, "data", "asset_registry.json");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function parseArgs(argv) {
  return { dryRun: argv.includes("--dry-run"), test: argv.includes("--test-notification") };
}

async function main() {
  loadEnvFile(path.join(repoRoot, ".env"));
  loadEnvFile(path.join(process.env.HOME || "", ".config", "app3-tester", "push.env"));
  const args = parseArgs(process.argv.slice(2));
  const enabled = process.env.APP3_PUSH_NOTIFICATIONS_ENABLED === "true";
  if (!enabled && !args.test) {
    console.log("Push bytesnotiser är avstängda. Ingen push skickades.");
    return;
  }
  const payload = JSON.parse(fs.readFileSync(signalPath, "utf8"));
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (args.test) {
    if (process.env.APP3_PUSH_ALLOW_TEST !== "true") throw new Error("Testnotis kräver APP3_PUSH_ALLOW_TEST=true.");
  }
  const verified = verifySignalForPush(payload, registry);
  if (!verified.eligible && !args.test) {
    console.log(`Ingen push: ${verified.reason}`);
    return;
  }
  const event = args.test
    ? {
      signal_event_id: `test_${new Date().toISOString()}`,
      title: "TEST - App3-notiser fungerar",
      body: "Detta är en explicit testnotis. Ingen strategisignal och ingen order.",
      from_position: null,
      to_position: null,
      data: { event_type: "app3_test_notification" },
      url: "https://bergiee-bull.github.io/app3-tester/",
    }
    : verified.event;
  const stateFile = process.env.APP3_PUSH_STATE_FILE || defaultStatePath();
  const state = readState(stateFile);
  if (!args.test && isDuplicateEvent(state, event.signal_event_id)) {
    console.log(`Ingen push: eventet ${event.signal_event_id} är redan skickat.`);
    return;
  }
  if (args.dryRun) {
    console.log(JSON.stringify({ dry_run: true, event }, null, 2));
    return;
  }
  const providerResponse = await sendOneSignalNotification(event, {
    appId: process.env.ONESIGNAL_APP_ID,
    apiKey: process.env.ONESIGNAL_REST_API_KEY,
  });
  if (!args.test) writeState(stateFile, markEventSent(state, event, providerResponse));
  console.log(`Push skickad: ${providerResponse.id || "provider-id saknas"}`);
}

main().catch((error) => {
  console.error(`Push bytesnotis misslyckades: ${error.message}`);
  process.exitCode = 1;
});
