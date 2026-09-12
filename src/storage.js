export const STORAGE_KEY = "app3Tester.portfolio.v1";
export const CURRENT_SCHEMA_VERSION = 1;

export function emptyPortfolio() {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    started_at: null,
    display_currency: "SEK",
    start_capital_sek: null,
    transactions: [],
    valuations: [],
    snapshots: [],
    signal_history: [],
    settings: { theme: "system" },
  };
}

export function migratePortfolio(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Backupfilen är ogiltig.");
  if (payload.schema_version === CURRENT_SCHEMA_VERSION) {
    return { ...emptyPortfolio(), ...payload, settings: { ...emptyPortfolio().settings, ...(payload.settings || {}) } };
  }
  if (payload.schema_version === 0) {
    return {
      ...emptyPortfolio(),
      ...payload,
      schema_version: CURRENT_SCHEMA_VERSION,
      signal_history: payload.signal_history || [],
      settings: { theme: payload.theme || "system" },
    };
  }
  throw new Error("Backupfilens version stöds inte.");
}

export function createPortfolioStore(storage) {
  if (!storage || typeof storage.getItem !== "function") throw new Error("Lokal lagring är inte tillgänglig.");
  return {
    load() {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyPortfolio();
      return migratePortfolio(JSON.parse(raw));
    },
    save(payload) {
      const migrated = migratePortfolio(payload);
      storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    },
    reset() {
      storage.removeItem(STORAGE_KEY);
      return emptyPortfolio();
    },
    exportJson() {
      return JSON.stringify(this.load(), null, 2);
    },
    importJson(text) {
      const parsed = JSON.parse(text);
      return this.save(migratePortfolio(parsed));
    },
  };
}
