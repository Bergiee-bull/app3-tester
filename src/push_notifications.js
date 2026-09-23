const PUSH_OPT_IN_KEY = "app3-tester-push-opt-in";
const SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

let sdkPromise = null;

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isIosHomeScreenRequired() {
  if (!isIosDevice()) return false;
  const standalone = navigator.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

export function isPushConfigured(config) {
  return config?.enabled === true
    && config.provider === "onesignal"
    && typeof config.app_id === "string"
    && /^[0-9a-f-]{20,}$/i.test(config.app_id)
    && typeof config.service_worker_path === "string"
    && typeof config.service_worker_scope === "string";
}

export function readPushOptIn(storage = window.localStorage) {
  return storage.getItem(PUSH_OPT_IN_KEY) === "true";
}

export function writePushOptIn(value, storage = window.localStorage) {
  storage.setItem(PUSH_OPT_IN_KEY, value ? "true" : "false");
}

function loadOneSignalSdk(config) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId: config.app_id,
          serviceWorkerPath: config.service_worker_path,
          serviceWorkerParam: { scope: config.service_worker_scope },
          notifyButton: { enable: false },
        });
        resolve(OneSignal);
      } catch (error) {
        reject(error);
      }
    });
    if (document.querySelector(`script[src="${SDK_URL}"]`)) return;
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error("OneSignal-SDK kunde inte laddas."));
    document.head.append(script);
  });
  return sdkPromise;
}

async function hasPermission(OneSignal) {
  if (typeof OneSignal.Notifications?.permission === "boolean") {
    return OneSignal.Notifications.permission;
  }
  if (typeof OneSignal.Notifications?.hasPermission === "function") {
    return Boolean(await OneSignal.Notifications.hasPermission());
  }
  return Boolean(OneSignal.User?.PushSubscription?.optedIn);
}

export async function enablePush(config, storage = window.localStorage) {
  if (!isPushConfigured(config)) {
    throw new Error("Bytesnotiser är inte konfigurerade ännu.");
  }
  if (isIosHomeScreenRequired()) {
    throw new Error("På iPhone/iPad måste App3 Tester först läggas till på hemskärmen.");
  }
  const OneSignal = await loadOneSignalSdk(config);
  await OneSignal.Notifications.requestPermission();
  const enabled = await hasPermission(OneSignal);
  writePushOptIn(enabled, storage);
  return enabled;
}

export async function disablePush(config, storage = window.localStorage) {
  if (isPushConfigured(config)) {
    const OneSignal = await loadOneSignalSdk(config);
    const subscription = OneSignal.User?.PushSubscription;
    if (typeof subscription?.optOut === "function") await subscription.optOut();
  }
  writePushOptIn(false, storage);
}

function setPushStatus({ status, message, enabled, configured }) {
  const statusNode = document.getElementById("pushStatus");
  const messageNode = document.getElementById("pushMessage");
  const enableButton = document.getElementById("enablePushButton");
  const disableButton = document.getElementById("disablePushButton");
  const iosHint = document.getElementById("pushIosHint");
  if (!statusNode) return;
  statusNode.textContent = status;
  statusNode.dataset.state = enabled ? "on" : "off";
  messageNode.textContent = message;
  enableButton.hidden = enabled;
  enableButton.disabled = !configured;
  disableButton.hidden = !enabled;
  iosHint.hidden = !configured || !isIosHomeScreenRequired();
}

export async function initPushControls({ configUrl = "./data/push_config.json", storage = window.localStorage } = {}) {
  const enableButton = document.getElementById("enablePushButton");
  const disableButton = document.getElementById("disablePushButton");
  if (!enableButton || !disableButton) return;
  let config;
  try {
    const response = await fetch(configUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Push-konfiguration kunde inte laddas (${response.status}).`);
    config = await response.json();
  } catch (error) {
    setPushStatus({ status: "Av", message: error.message, enabled: false, configured: false });
    return;
  }
  const configured = isPushConfigured(config);
  if (!configured) {
    setPushStatus({
      status: "Av",
      message: "Bytesnotiser är inte konfigurerade ännu.",
      enabled: false,
      configured: false,
    });
    return;
  }
  try {
    await loadOneSignalSdk(config);
  } catch (error) {
    setPushStatus({ status: "Av", message: error.message, enabled: false, configured: true });
    return;
  }
  setPushStatus({
    status: readPushOptIn(storage) ? "På" : "Av",
    message: readPushOptIn(storage) ? "Bytesnotiser aktiverade." : "Du får endast en notis när App3 byter mellan Nasdaq och OMX.",
    enabled: readPushOptIn(storage),
    configured: true,
  });
  enableButton.addEventListener("click", async () => {
    enableButton.disabled = true;
    try {
      const enabled = await enablePush(config, storage);
      setPushStatus({
        status: enabled ? "På" : "Av",
        message: enabled ? "Bytesnotiser aktiverade." : "Notiser nekades eller är inte aktiverade i webbläsaren.",
        enabled,
        configured: true,
      });
    } catch (error) {
      setPushStatus({ status: "Av", message: error.message, enabled: false, configured: true });
    } finally {
      enableButton.disabled = false;
    }
  });
  disableButton.addEventListener("click", async () => {
    disableButton.disabled = true;
    try {
      await disablePush(config, storage);
      setPushStatus({
        status: "Av",
        message: "Bytesnotiser avstängda.",
        enabled: false,
        configured: true,
      });
    } catch (error) {
      setPushStatus({ status: "På", message: error.message, enabled: true, configured: true });
    } finally {
      disableButton.disabled = false;
    }
  });
}
