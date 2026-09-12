const SUPPORTED_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "CASH_ADJUSTMENT"]);

function number(value, label, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) throw new Error(`${label} är ogiltigt.`);
  return parsed;
}

export function normalizeTransaction(input, strategy) {
  const type = String(input.type || "").toUpperCase();
  if (!SUPPORTED_TYPES.has(type)) throw new Error("Transaktionstypen stöds inte.");
  const date = String(input.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error("Transaktionsdatum är ogiltigt.");
  }
  const currency = String(input.currency || "SEK").toUpperCase();
  const fxRateToSek = currency === "SEK" ? 1 : number(input.fx_rate_to_sek, "Valutakurs");
  return {
    id: input.id || crypto.randomUUID(),
    type,
    asset: String(input.asset || ""),
    instrument: String(input.instrument || ""),
    date,
    quantity: number(input.quantity, "Antal"),
    price: number(input.price, "Pris"),
    currency,
    fx_rate_to_sek: fxRateToSek,
    fee_sek: number(input.fee_sek ?? 0, "Courtage", { allowZero: true }),
    strategy_id: String(strategy.id),
    strategy_version: String(strategy.version),
  };
}

export function transactionValueSek(transaction) {
  return transaction.quantity * transaction.price * transaction.fx_rate_to_sek;
}

export function holdingsFromTransactions(transactions) {
  const holdings = new Map();
  for (const transaction of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!new Set(["BUY", "SELL"]).has(transaction.type)) continue;
    const current = holdings.get(transaction.instrument) || {
      instrument: transaction.instrument,
      asset: transaction.asset,
      currency: transaction.currency,
      quantity: 0,
    };
    current.quantity += transaction.type === "BUY" ? transaction.quantity : -transaction.quantity;
    if (current.quantity < -1e-8) throw new Error(`Försäljning överstiger innehavet i ${transaction.instrument}.`);
    holdings.set(transaction.instrument, current);
  }
  return [...holdings.values()].filter((holding) => holding.quantity > 1e-8);
}

export function calculatePortfolio(portfolio) {
  const holdings = holdingsFromTransactions(portfolio.transactions || []);
  const startCapital = Number(portfolio.start_capital_sek);
  if (!Number.isFinite(startCapital) || startCapital <= 0) return { started: false, holdings, currentValueSek: null };
  let cash = startCapital;
  for (const transaction of portfolio.transactions || []) {
    if (transaction.type === "BUY") cash -= transactionValueSek(transaction) + transaction.fee_sek;
    if (transaction.type === "SELL") cash += transactionValueSek(transaction) - transaction.fee_sek;
    if (transaction.type === "DIVIDEND" || transaction.type === "CASH_ADJUSTMENT") cash += transactionValueSek(transaction);
  }
  let invested = 0;
  let complete = true;
  for (const holding of holdings) {
    const matches = (portfolio.valuations || [])
      .filter((value) => value.instrument === holding.instrument)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!matches[0]) {
      complete = false;
      continue;
    }
    invested += holding.quantity * matches[0].price * matches[0].fx_rate_to_sek;
  }
  const currentValueSek = complete ? cash + invested : null;
  const totalReturnPct = currentValueSek === null ? null : (currentValueSek / startCapital - 1) * 100;
  const year = new Date().getFullYear();
  const priorSnapshots = (portfolio.snapshots || []).filter((row) => Number(row.date.slice(0, 4)) < year);
  const ytdBase = priorSnapshots.length
    ? [...priorSnapshots].sort((a, b) => b.date.localeCompare(a.date))[0].value_sek
    : startCapital;
  const ytdReturnPct = currentValueSek === null ? null : (currentValueSek / ytdBase - 1) * 100;
  return { started: true, holdings, cashSek: cash, currentValueSek, totalReturnPct, ytdReturnPct, startCapitalSek: startCapital };
}

export function addValuation(portfolio, input) {
  const currency = String(input.currency || "SEK").toUpperCase();
  const valuation = {
    instrument: String(input.instrument || ""),
    date: String(input.date || ""),
    price: number(input.price, "Aktuell kurs"),
    currency,
    fx_rate_to_sek: currency === "SEK" ? 1 : number(input.fx_rate_to_sek, "Valutakurs"),
    source: input.source ? String(input.source) : "manual",
    automatic: input.automatic === true,
    provider_symbol: input.provider_symbol ? String(input.provider_symbol) : null,
  };
  if (!valuation.instrument || !/^\d{4}-\d{2}-\d{2}$/.test(valuation.date)) throw new Error("Värderingen är ofullständig.");
  const valuations = (portfolio.valuations || []).filter((row) => !(row.instrument === valuation.instrument && row.date === valuation.date));
  valuations.push(valuation);
  return { ...portfolio, valuations };
}

export function applyAutomaticValuations(portfolio, benchmarkData) {
  if (!portfolio?.started_at || benchmarkData?.is_sample_data !== false || benchmarkData?.data_quality !== "PASS") {
    return portfolio;
  }
  const holdings = holdingsFromTransactions(portfolio.transactions || []);
  let next = portfolio;
  let latestAppliedDate = null;
  for (const holding of holdings) {
    const quote = benchmarkData.latest_valuations?.[holding.asset];
    if (!quote || quote.is_sample_data !== false || quote.date < portfolio.started_at) continue;
    const manualOverride = (next.valuations || []).some((value) => (
      value.instrument === holding.instrument && value.date === quote.date && value.automatic !== true
    ));
    if (manualOverride) {
      latestAppliedDate = !latestAppliedDate || quote.date > latestAppliedDate ? quote.date : latestAppliedDate;
      continue;
    }
    next = addValuation(next, {
      instrument: holding.instrument,
      date: quote.date,
      price: quote.price,
      currency: quote.currency,
      fx_rate_to_sek: quote.fx_rate_to_sek,
      source: quote.source,
      automatic: true,
      provider_symbol: quote.provider_symbol,
    });
    latestAppliedDate = !latestAppliedDate || quote.date > latestAppliedDate ? quote.date : latestAppliedDate;
  }
  return latestAppliedDate ? recordSnapshot(next, latestAppliedDate) : next;
}

export function recordSnapshot(portfolio, date) {
  const result = calculatePortfolio(portfolio);
  if (result.currentValueSek === null) return portfolio;
  const snapshots = (portfolio.snapshots || []).filter((row) => row.date !== date);
  snapshots.push({ date, value_sek: result.currentValueSek });
  return { ...portfolio, snapshots: snapshots.sort((a, b) => a.date.localeCompare(b.date)) };
}

export function rememberSignal(portfolio, signalPayload) {
  const item = {
    signal_date: signalPayload.signal.signal_date,
    effective_date: signalPayload.signal.effective_date,
    action: signalPayload.signal.action,
    previous_asset: signalPayload.signal.previous_asset,
    recommended_asset: signalPayload.signal.recommended_asset,
    strategy_id: signalPayload.strategy.id,
    strategy_version: signalPayload.strategy.version,
  };
  const history = (portfolio.signal_history || []).filter((entry) => !(
    entry.signal_date === item.signal_date
    && entry.strategy_id === item.strategy_id
    && entry.recommended_asset === item.recommended_asset
  ));
  history.push(item);
  return { ...portfolio, signal_history: history.sort((a, b) => b.signal_date.localeCompare(a.signal_date)) };
}
