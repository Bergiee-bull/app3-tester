const REQUIRED_KEYS = [
  "schema_version",
  "generated_at",
  "is_sample_data",
  "data_quality",
  "currency",
  "return_basis",
  "latest_common_trading_date",
  "benchmarks",
  "latest_valuations",
  "observations",
];

function validDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validProvenance(value, asset) {
  return value
    && value.asset === asset
    && typeof value.instrument_name === "string"
    && value.instrument_name.trim()
    && typeof value.symbol === "string"
    && value.symbol.trim()
    && typeof value.source === "string"
    && value.source.trim()
    && value.adjusted_close_available === true
    && validDate(value.first_date)
    && validDate(value.last_date)
    && Number.isInteger(value.row_count)
    && value.row_count > 1;
}

function validValuation(value, asset, instrument, currency) {
  return value
    && value.asset === asset
    && value.instrument === instrument
    && typeof value.provider_symbol === "string"
    && value.provider_symbol.trim()
    && validDate(value.date)
    && Number.isFinite(value.price)
    && value.price > 0
    && value.currency === currency
    && Number.isFinite(value.fx_rate_to_sek)
    && value.fx_rate_to_sek > 0
    && typeof value.source === "string"
    && value.source.trim()
    && value.is_sample_data === false;
}

export function validateBenchmarkData(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (!REQUIRED_KEYS.every((key) => Object.hasOwn(payload, key))) return false;
  if (payload.schema_version !== 2 || payload.is_sample_data !== false) return false;
  if (payload.data_quality !== "PASS" || payload.currency !== "SEK") return false;
  if (typeof payload.generated_at !== "string" || Number.isNaN(Date.parse(payload.generated_at))) return false;
  if (!validDate(payload.latest_common_trading_date)) return false;
  if (!validProvenance(payload.benchmarks?.NASDAQ, "NASDAQ")) return false;
  if (!validProvenance(payload.benchmarks?.OMX, "OMX")) return false;
  if (!validValuation(payload.latest_valuations?.NASDAQ, "NASDAQ", "EQQQ", "EUR")) return false;
  if (!validValuation(payload.latest_valuations?.OMX, "OMX", "XACT OMXS30", "SEK")) return false;
  if (!Array.isArray(payload.observations) || payload.observations.length < 2) return false;
  if (payload.benchmarks.NASDAQ.row_count !== payload.observations.length) return false;
  if (payload.benchmarks.OMX.row_count !== payload.observations.length) return false;

  let previousDate = "";
  for (const row of payload.observations) {
    if (!Array.isArray(row) || row.length !== 3 || !validDate(row[0])) return false;
    if (row[0] <= previousDate) return false;
    if (!Number.isFinite(row[1]) || row[1] <= 0 || !Number.isFinite(row[2]) || row[2] <= 0) return false;
    previousDate = row[0];
  }
  const firstDate = payload.observations[0][0];
  const lastDate = payload.observations.at(-1)[0];
  return lastDate === payload.latest_common_trading_date
    && payload.benchmarks.NASDAQ.first_date === firstDate
    && payload.benchmarks.OMX.first_date === firstDate
    && payload.benchmarks.NASDAQ.last_date === lastDate
    && payload.benchmarks.OMX.last_date === lastDate
    && payload.latest_valuations.NASDAQ.date >= lastDate
    && payload.latest_valuations.OMX.date >= lastDate;
}

export async function loadBenchmarkData(fetchImpl = fetch) {
  const response = await fetchImpl("./data/benchmark_series.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Jämförelsedatan kunde inte laddas.");
  const payload = await response.json();
  if (!validateBenchmarkData(payload)) throw new Error("Jämförelsedatan är ogiltig eller inte produktionsgodkänd.");
  return payload;
}
