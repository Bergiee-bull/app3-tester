const REQUIRED_KEYS = [
  "schema_version",
  "is_sample_data",
  "data_quality",
  "strategy_id",
  "strategy_version",
  "source",
  "positions",
];
const POSITION_KEYS = ["effective_date", "position", "strategy_id", "strategy_version"];
const POSITIONS = new Set(["NASDAQ", "OMX"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}

function exactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.slice().sort().every((key, index) => key === actual[index]);
}

export function validateStrategyHistory(payload) {
  if (!exactKeys(payload, REQUIRED_KEYS)) return false;
  if (payload.schema_version !== 1 || payload.is_sample_data !== false || payload.data_quality !== "PASS") {
    return false;
  }
  if (!payload.strategy_id || !payload.strategy_version || !payload.source) return false;
  if (!Array.isArray(payload.positions) || payload.positions.length === 0) return false;

  let previousDate = "";
  for (const row of payload.positions) {
    if (!exactKeys(row, POSITION_KEYS)) return false;
    if (!validDate(row.effective_date) || row.effective_date <= previousDate) return false;
    if (!POSITIONS.has(row.position)) return false;
    if (row.strategy_id !== payload.strategy_id || row.strategy_version !== payload.strategy_version) {
      return false;
    }
    previousDate = row.effective_date;
  }
  return true;
}

export function buildVisibleStrategyEvents(payload, startDate, registry) {
  if (!validateStrategyHistory(payload) || !validDate(startDate) || !isObject(registry)) return [];

  const positionsAtStart = payload.positions.filter((row) => row.effective_date <= startDate);
  const activeAtStart = positionsAtStart.at(-1);
  if (!activeAtStart) return [];

  const event = (date, fromPosition, toPosition, type) => ({
    date,
    type,
    from_position: fromPosition,
    to_position: toPosition,
    title: type === "START" ? `START – ${toPosition}` : `${fromPosition} → ${toPosition}`,
    instrument: registry[toPosition]?.default_instrument || toPosition,
    instrument_name: registry[toPosition]?.instrument_name || "",
  });

  const events = [event(startDate, null, activeAtStart.position, "START")];
  let currentPosition = activeAtStart.position;
  for (const row of payload.positions) {
    if (row.effective_date <= startDate || row.position === currentPosition) continue;
    events.push(event(row.effective_date, currentPosition, row.position, "SWITCH"));
    currentPosition = row.position;
  }
  return events;
}

export async function loadStrategyHistory(fetchImpl = fetch) {
  const response = await fetchImpl("./data/app3_strategy_history.json", { cache: "no-store" });
  if (!response.ok) throw new Error("App3-strategihistoriken kunde inte laddas.");
  const payload = await response.json();
  if (!validateStrategyHistory(payload)) {
    throw new Error("App3-strategihistoriken är ogiltig eller inte produktionsgodkänd.");
  }
  return payload;
}
