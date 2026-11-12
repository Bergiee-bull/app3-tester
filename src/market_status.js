const REQUIRED_KEYS = [
  "schema_version",
  "source",
  "status",
  "attempted_at",
  "latest_verified_market_date",
  "latest_source_dates",
  "is_sample_data",
  "error",
];

const STATUSES = new Set(["fresh", "waiting_for_complete_market_day", "stale"]);

function validDate(value) {
  return value === null || (typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

export function validateMarketStatus(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (!REQUIRED_KEYS.every((key) => Object.hasOwn(payload, key))) return false;
  if (payload.schema_version !== 1
    || payload.source !== "public_market_update"
    || !STATUSES.has(payload.status)
    || payload.is_sample_data !== false
    || typeof payload.attempted_at !== "string"
    || Number.isNaN(Date.parse(payload.attempted_at))
    || !validDate(payload.latest_verified_market_date)
    || (payload.error !== null && typeof payload.error !== "string")) return false;
  if (!payload.latest_source_dates || typeof payload.latest_source_dates !== "object") return false;
  return Object.values(payload.latest_source_dates).every((value) => validDate(value));
}

export async function loadMarketStatus(fetchImpl = fetch) {
  const response = await fetchImpl("./data/public_market_update_status.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Marknadsuppdateringens status kunde inte laddas.");
  const payload = await response.json();
  if (!validateMarketStatus(payload)) throw new Error("Marknadsuppdateringens status är ogiltig.");
  return payload;
}
