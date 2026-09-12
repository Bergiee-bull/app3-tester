const TOP_LEVEL_KEYS = ["schema_version", "generated_at", "is_sample_data", "strategy", "signal", "system"];
const STRATEGY_KEYS = ["id", "display_name", "version"];
const SIGNAL_KEYS = ["recommended_asset", "previous_asset", "action", "signal_date", "effective_date"];
const SYSTEM_KEYS = ["status", "data_quality", "market_date"];
const ACTIONS = new Set(["HOLD", "SWITCH"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.slice().sort().every((key, index) => key === actual[index]);
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function validatePublicSignal(payload) {
  const errors = [];
  if (!exactKeys(payload, TOP_LEVEL_KEYS)) errors.push("Publik signal har oväntade eller saknade huvudfält.");
  if (payload?.schema_version !== 1) errors.push("Signalens schemaversion stöds inte.");
  if (payload?.is_sample_data !== false) errors.push("Produktionssignalen är märkt som demo eller sample.");
  if (typeof payload?.generated_at !== "string" || Number.isNaN(Date.parse(payload.generated_at))) {
    errors.push("Signalens genereringstid saknas eller är ogiltig.");
  }
  if (!exactKeys(payload?.strategy, STRATEGY_KEYS)) errors.push("Strategiinformationen är ogiltig.");
  for (const key of STRATEGY_KEYS) {
    if (typeof payload?.strategy?.[key] !== "string" || !payload.strategy[key].trim()) {
      errors.push(`Strategifältet ${key} saknas.`);
    }
  }
  if (!exactKeys(payload?.signal, SIGNAL_KEYS)) errors.push("Signalobjektet är ogiltigt.");
  if (typeof payload?.signal?.recommended_asset !== "string" || !payload.signal.recommended_asset.trim()) {
    errors.push("Rekommenderad tillgång saknas.");
  }
  if (typeof payload?.signal?.previous_asset !== "string" || !payload.signal.previous_asset.trim()) {
    errors.push("Föregående tillgång saknas.");
  }
  if (!ACTIONS.has(payload?.signal?.action)) errors.push("Signalens action stöds inte.");
  if (!validDate(payload?.signal?.signal_date)) errors.push("Signaldatum är ogiltigt.");
  if (!validDate(payload?.signal?.effective_date)) errors.push("Effektivt datum är ogiltigt.");
  if (!exactKeys(payload?.system, SYSTEM_KEYS)) errors.push("Systemstatus är ogiltig.");
  if (typeof payload?.system?.status !== "string") errors.push("Systemstatus saknas.");
  if (typeof payload?.system?.data_quality !== "string") errors.push("Datakvalitet saknas.");
  if (!validDate(payload?.system?.market_date)) errors.push("Marknadsdatum är ogiltigt.");
  return { valid: errors.length === 0, errors };
}

export function businessDaysOld(marketDate, now = new Date()) {
  const start = new Date(`${marketDate}T12:00:00Z`);
  const end = new Date(now);
  if (Number.isNaN(start.getTime()) || start > end) return Number.POSITIVE_INFINITY;
  let days = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function assessSignal(payload, registry, { now = new Date(), maxBusinessDays = 3 } = {}) {
  const validation = validatePublicSignal(payload);
  if (!validation.valid) return { verified: false, reason: validation.errors.join(" "), stale: false };
  if (payload.system.status !== "OK") {
    return { verified: false, reason: "App3-status kan inte verifieras just nu.", stale: false };
  }
  if (payload.system.data_quality !== "PASS") {
    return { verified: false, reason: "Datakvalitetsproblem. App3-status kan inte verifieras just nu.", stale: false };
  }
  if (!registry?.[payload.signal.recommended_asset] || !registry?.[payload.signal.previous_asset]) {
    return { verified: false, reason: "Signalens tillgång saknas i det publika registret.", stale: false };
  }
  const age = businessDaysOld(payload.system.market_date, now);
  if (age > maxBusinessDays) {
    return { verified: false, reason: "Signaldata är inte uppdaterad. App3-status kan inte verifieras just nu.", stale: true, age };
  }
  return { verified: true, reason: null, stale: false, age };
}

export function signalViewModel(payload, registry) {
  const asset = registry[payload.signal.recommended_asset];
  const previous = registry[payload.signal.previous_asset];
  const isSwitch = payload.signal.action === "SWITCH";
  return {
    strategyLabel: `${payload.strategy.display_name} · ${payload.strategy.id}`,
    strategyVersion: payload.strategy.version,
    assetId: payload.signal.recommended_asset,
    assetName: asset.display_name,
    instrumentName: asset.instrument_name,
    instrumentTicker: asset.default_instrument,
    action: payload.signal.action,
    signalDate: payload.signal.signal_date,
    effectiveDate: payload.signal.effective_date,
    marketDate: payload.system.market_date,
    message: isSwitch
      ? `App3 rekommenderar byte från ${previous.display_name} till ${asset.display_name}.`
      : `App3 rekommenderar fortsatt ${asset.display_name}.`,
    transition: isSwitch ? `${previous.display_name} → ${asset.display_name}` : null,
  };
}
