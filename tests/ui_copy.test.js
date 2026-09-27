import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("EQQQ remains a percentage result with clear SEK wording", () => {
  assert.match(index, /EQQQ Buy &amp; Hold – avkastning beräknad i SEK/);
  assert.match(index, /id="nasdaqChartReturn"/);
  assert.match(app, /formatPercent/);
  assert.match(app, /%/);
  assert.match(app, /EQQQ:s avkastning beräknas i SEK/);
  assert.match(app, /valutaeffekten EUR\/SEK/);
});

test("Telegram invite replaces visible Web Push controls", () => {
  assert.match(index, /Få bytesnotiser i Telegram/);
  assert.match(index, /href="https:\/\/t\.me\/\+Qu5FJ4jS5dswYzE0"/);
  assert.match(index, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(index, /Status Av|Bytesnotiser är inte konfigurerade ännu|Aktivera notiser|Stäng av notiser/);
  assert.doesNotMatch(app, /initPushControls|push_notifications\.js|push_config\.json/);
  assert.doesNotMatch(worker, /push_config\.json|OneSignalSDKWorker/);
});

test("frontend contains no Telegram credentials", () => {
  const frontend = `${index}\n${app}\n${worker}`;
  assert.doesNotMatch(frontend, /TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|chat_id|bot_token/i);
});

test("frontend version and service-worker cache are bumped without changing local storage schema", () => {
  assert.match(index, /Appversion<\/dt><dd>1\.4\.1/);
  assert.match(index, /Build<\/dt><dd>telegram-history-ui/);
  assert.match(app, /APP_VERSION = "1\.4\.1"/);
  assert.match(worker, /app3-tester-v1\.4\.1/);
  assert.match(app, /app3Tester\.portfolio\.v1/);
});
