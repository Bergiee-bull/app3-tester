const REQUIRED_FIELDS = ["display_name", "default_instrument", "instrument_name", "currency", "theme"];

export function validateAssetRegistry(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) return false;
  const entries = Object.entries(registry);
  if (entries.length === 0) return false;
  return entries.every(([assetId, asset]) => (
    typeof assetId === "string"
    && assetId.length > 0
    && asset
    && typeof asset === "object"
    && REQUIRED_FIELDS.every((field) => typeof asset[field] === "string" && asset[field].trim())
  ));
}

export async function loadAssetRegistry(fetchImpl = fetch) {
  const response = await fetchImpl("./data/asset_registry.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Tillgångsregistret kunde inte laddas.");
  const registry = await response.json();
  if (!validateAssetRegistry(registry)) throw new Error("Tillgångsregistret är ogiltigt.");
  return registry;
}

export function getAsset(registry, assetId) {
  const asset = registry?.[assetId];
  if (!asset) throw new Error(`Okänd tillgång: ${assetId}`);
  return asset;
}
