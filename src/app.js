import { loadAssetRegistry } from "./asset_registry.js";
import { loadBenchmarkData } from "./benchmark_data.js?v=1.4.1";
import { buildVisibleStrategyEvents, loadStrategyHistory } from "./strategy_history.js?v=1.4.1";
import { loadMarketStatus } from "./market_status.js?v=1.4.1";
import { assessSignal, signalViewModel } from "./signal.js";
import { createPortfolioStore } from "./storage.js";
import {
  addValuation,
  applyAutomaticValuations,
  calculatePortfolio,
  holdingsFromTransactions,
  normalizeTransaction,
  recordSnapshot,
  rememberSignal,
  transactionValueSek,
} from "./portfolio.js?v=1.4.1";
import { buildPerformanceComparison, drawPerformanceChart } from "./charts.js?v=1.4.1";
import { assertComparisonReconciles, buildComparisonReconciliation } from "./reconciliation.js";

const $ = (id) => document.getElementById(id);
const store = createPortfolioStore(window.localStorage);
const APP_VERSION = "1.4.3-portfolio";
// Public bookkeeping is usable while every strategy/publication gate stays closed.
const PUBLIC_PORTFOLIO_ONLY = true;
const MANUAL_BOOKKEEPING = Object.freeze({ id: "manual_portfolio", version: "1" });
let portfolio = store.load();
let publicSignal = null;
let registry = null;
let benchmarkData = null;
let strategyHistory = null;
let benchmarkError = null;
let strategyHistoryError = null;
let marketStatus = null;
let marketStatusError = null;
let reconciliationError = null;
let signalAssessment = { verified: false };

function formatDate(value) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function formatSek(value) {
  if (!Number.isFinite(value)) return "Saknar värdering";
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "–";
  return `${value > 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")} %`;
}

function setReturn(element, value) {
  element.textContent = formatPercent(value);
  element.classList.toggle("positive", Number.isFinite(value) && value > 0);
  element.classList.toggle("negative", Number.isFinite(value) && value < 0);
}

function renderMarketStatus() {
  const date = marketStatus?.latest_verified_market_date || benchmarkData?.latest_common_market_date;
  $("marketFreshnessDate").textContent = date ? formatDate(date) : "–";
  const statusLabels = {
    fresh: "Färsk och verifierad",
    waiting_for_complete_market_day: "Väntar på komplett handelsdag",
    stale: "Ej uppdaterad",
  };
  const status = marketStatus?.status;
  const offline = !window.navigator.onLine;
  $("marketFreshnessStatus").textContent = offline
    ? "OFFLINE / senast verifierad"
    : (statusLabels[status] || "Okänd status");
  const warning = marketStatus?.status === "fresh"
    ? "EQQQ-avkastningen beräknas i SEK och kan därför skilja sig från utvecklingen i EUR hos mäklaren."
    : `Marknadsdata ej uppdaterad – senaste verifierade datum ${date ? formatDate(date) : "saknas"}.`;
  $("marketFreshnessWarning").textContent = offline
    ? `OFFLINE / SENAST VERIFIERAD ${date ? formatDate(date) : "saknas"}. ${warning}`
    : (marketStatusError ? `${warning} ${marketStatusError}` : warning);
  $("marketFreshnessWarning").classList.toggle("warning", offline || marketStatus?.status !== "fresh");
}

function checkAppVersion() {
  const key = "app3-tester-last-app-version";
  const previous = window.localStorage.getItem(key);
  if ((previous && previous !== APP_VERSION)
    || (!previous && window.localStorage.getItem("app3Tester.portfolio.v1"))) {
    $("updateBanner").hidden = false;
  }
  if (!previous && !window.localStorage.getItem("app3Tester.portfolio.v1")) {
    window.localStorage.setItem(key, APP_VERSION);
  }
  $("updateButton").addEventListener("click", () => {
    window.localStorage.setItem(key, APP_VERSION);
    window.location.reload();
  });
}

function applyTheme(theme) {
  const resolved = theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolved;
}

function cycleTheme() {
  const sequence = ["system", "light", "dark"];
  const current = portfolio.settings?.theme || "system";
  const theme = sequence[(sequence.indexOf(current) + 1) % sequence.length];
  portfolio = store.save({ ...portfolio, settings: { ...portfolio.settings, theme } });
  applyTheme(theme);
  renderChart();
}

function renderSignalFailure(reason) {
  $("signalLoading").hidden = true;
  $("signalContent").hidden = true;
  $("signalError").hidden = false;
  $("signalErrorReason").textContent = reason || "Signaldata saknas eller är ogiltig.";
  $("systemStatus").textContent = "Ej verifierad";
  $("dataQuality").textContent = "BLOCKERAD";
  document.querySelector(".status-light").classList.remove("ok");
  $("registerSwitchButton").hidden = true;
}

function renderSignal() {
  if (!signalAssessment.verified) {
    renderSignalFailure(signalAssessment.reason);
    return;
  }
  const view = signalViewModel(publicSignal, registry);
  const theme = registry[view.assetId].theme;
  $("signalShell").className = `signal-shell ${theme}`;
  $("signalLoading").hidden = true;
  $("signalError").hidden = true;
  $("signalContent").hidden = false;
  $("strategyLabel").textContent = view.strategyLabel;
  $("assetName").textContent = view.assetName.toUpperCase();
  $("signalAction").textContent = view.action;
  $("signalMessage").textContent = view.message;
  $("signalInstrumentName").textContent = view.instrumentName;
  $("signalInstrumentTicker").textContent = `Ticker: ${view.instrumentTicker}`;
  $("signalDate").textContent = formatDate(view.signalDate);
  $("effectiveDate").textContent = formatDate(view.effectiveDate);
  $("marketDate").textContent = formatDate(view.marketDate);
  $("qualityBadge").textContent = publicSignal.system.data_quality;
  $("systemStatus").textContent = "OK";
  $("dataQuality").textContent = publicSignal.system.data_quality;
  $("strategyVersion").textContent = `${publicSignal.strategy.id} · ${publicSignal.strategy.version}`;
  document.querySelector(".status-light").classList.add("ok");
}

function renderPortfolio() {
  const displayPortfolio = PUBLIC_PORTFOLIO_ONLY ? { ...portfolio, valuations: (portfolio.valuations || []).filter(value => value.automatic !== true) } : portfolio;
  const result = calculatePortfolio(displayPortfolio);
  $("onboardingSection").hidden = result.started;
  $("portfolioSection").hidden = !result.started;
  $("performanceSection").hidden = !result.started;
  $("transactionButton").hidden = !result.started;
  if (!result.started) {
    $("transactionHistory").className = "empty-state";
    $("transactionHistory").textContent = "Starta ditt test för att registrera en transaktion.";
    return;
  }
  const holding = result.holdings[0];
  const holdingAsset = holding ? registry?.[holding.asset] : null;
  $("holdingAsset").textContent = holding ? holdingAsset?.display_name || holding.asset : "Ingen investerad tillgång";
  $("holdingInstrument").textContent = holding ? holdingAsset?.instrument_name || holding.instrument : "Kassa";
  $("holdingQuantity").textContent = result.holdings.length ? result.holdings.map(item => `${item.instrument} · ${item.quantity.toLocaleString("sv-SE")} st`).join(" / ") : "–";
  $("startValue").textContent = formatSek(result.startCapitalSek);
  $("currentValue").textContent = formatSek(result.currentValueSek);
  const latestValuation = holding
    ? [...(displayPortfolio.valuations || [])]
      .filter((value) => value.instrument === holding.instrument)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  if (latestValuation?.automatic) {
    const price = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
      .format(latestValuation.price);
    const fx = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
      .format(latestValuation.fx_rate_to_sek);
    $("valuationSource").textContent = latestValuation.currency === "EUR"
      ? `Auto ${formatDate(latestValuation.date)}: ${price} EUR × EUR/SEK ${fx}`
      : `Auto ${formatDate(latestValuation.date)}: ${price} SEK`;
    $("portfolioAsOf").textContent = `Kursdatum: ${formatDate(latestValuation.date)} · registrerat innehav`;
  } else {
    $("valuationSource").textContent = latestValuation
      ? `Angiven kurs ${formatDate(latestValuation.date)}${latestValuation.date < new Date().toISOString().slice(0,10) ? " · äldre värde" : ""}`
      : "Ingen marknadskurs ännu";
    $("portfolioAsOf").textContent = latestValuation
      ? `Kursdatum: ${formatDate(latestValuation.date)} · registrerat innehav`
      : "Värderingsdag: saknas";
  }
  const externalCashFlows = (portfolio.transactions || []).some(item => item.type === "CASH_ADJUSTMENT");
  setReturn($("totalReturn"), PUBLIC_PORTFOLIO_ONLY && externalCashFlows ? null : result.totalReturnPct);
  setReturn($("ytdReturn"), PUBLIC_PORTFOLIO_ONLY ? null : result.ytdReturnPct);
  renderTransactions();
  renderChart();
  updateSwitchButton(result.holdings);
}

function row(container, date, title, meta) {
  const wrapper = document.createElement("div");
  wrapper.className = "history-row";
  const dateNode = document.createElement("span");
  dateNode.textContent = formatDate(date);
  const titleNode = document.createElement("strong");
  titleNode.textContent = title;
  const metaNode = document.createElement("small");
  metaNode.textContent = meta;
  wrapper.append(dateNode, titleNode, metaNode);
  container.append(wrapper);
}

function renderTransactions() {
  const container = $("transactionHistory");
  container.className = "";
  container.replaceChildren();
  const transactions = [...portfolio.transactions].sort((a, b) => b.date.localeCompare(a.date));
  if (!transactions.length) {
    container.className = "empty-state";
    container.textContent = "Inga transaktioner registrerade.";
    return;
  }
  transactions.forEach((transaction) => {
    row(
      container,
      transaction.date,
      `${transaction.type} · ${transaction.instrument}`,
      `${transaction.quantity.toLocaleString("sv-SE")} st · ${transaction.strategy_id === "manual_portfolio" ? "Egen registrerad affär" : transaction.strategy_id}`,
    );
  });
}

function renderSignalHistory() {
  const container = $("signalHistory");
  container.replaceChildren();
  if (!portfolio.started_at) {
    container.className = "empty-state";
    container.textContent = "Starta ditt test för att se strategihistoriken från ditt startdatum.";
    return;
  }
  const events = buildVisibleStrategyEvents(strategyHistory, portfolio.started_at, registry);
  if (!events.length) {
    container.className = "empty-state";
    container.textContent = "Strategihistoriken kan inte verifieras för ditt startdatum.";
    return;
  }
  container.className = "";
  events.forEach((event) => {
    row(container, event.date, event.title, event.instrument);
  });
}

function renderChart() {
  if ($("performanceSection").hidden) return;
  if (PUBLIC_PORTFOLIO_ONLY) {
    $("performanceChart").hidden = true;
    $("chartNote").textContent = "Strategikurva och båda buy-and-hold-jämförelserna inväntar godkända indexdata. Din lokala portfölj och dina transaktioner fungerar separat.";
    ["app3ChartReturn", "nasdaqChartReturn", "omxChartReturn"].forEach(id => $(id).textContent = "Tillfälligt otillgänglig");
    return;
  }
  const comparison = buildPerformanceComparison(portfolio, benchmarkData, strategyHistory);
  const reconciliation = buildComparisonReconciliation(portfolio, benchmarkData, strategyHistory, comparison);
  drawPerformanceChart($("performanceChart"), comparison);
  setReturn($("app3ChartReturn"), comparison.latest.strategy);
  setReturn($("nasdaqChartReturn"), comparison.latest.nasdaq);
  setReturn($("omxChartReturn"), comparison.latest.omx);
  reconciliationError = null;
  if (reconciliation.valid) {
    try {
      assertComparisonReconciles(reconciliation);
    } catch (error) {
      reconciliationError = error.message;
    }
  }
  if (benchmarkError || strategyHistoryError || reconciliationError || !comparison.strategyHistoryValid) {
    $("chartNote").textContent = "Strategijämförelsen kan inte verifieras just nu. Benchmarkdata eller publik strategihistorik saknas.";
  } else if (!comparison.comparisonStartDate) {
    $("chartNote").textContent = "Strategijämförelsen börjar när validerad marknadsdata finns för ditt startdatum.";
  } else {
    const latestText = formatDate(reconciliation.comparison_end);
    $("chartNote").textContent = `Jämförelse t.o.m. ${latestText}. App3-strategin jämförs med EQQQ Buy & Hold och XACT OMX Buy & Hold från samma startdatum. EQQQ:s avkastning beräknas i SEK och inkluderar därför valutaeffekten EUR/SEK.`;
  }
}

function updateSwitchButton(holdings) {
  const currentAssets = new Set(holdings.map((holding) => holding.asset));
  const show = signalAssessment.verified
    && publicSignal.signal.action === "SWITCH"
    && !currentAssets.has(publicSignal.signal.recommended_asset);
  $("registerSwitchButton").hidden = !show;
}

function fillAssetSelect(selectedAsset) {
  const select = $("assetSelect");
  select.replaceChildren();
  Object.entries(registry).forEach(([assetId, asset]) => {
    const option = document.createElement("option");
    option.value = assetId;
    option.textContent = `${asset.display_name} — ${asset.instrument_name}`;
    option.selected = assetId === selectedAsset;
    select.append(option);
  });
  syncInstrumentFromAsset();
}

function syncInstrumentFromAsset() {
  const asset = registry[$("assetSelect").value];
  if (!asset) return;
  const instrument = $("instrumentInput");
  instrument.replaceChildren();
  const option = document.createElement("option");
  option.value = asset.default_instrument;
  option.textContent = `${asset.instrument_name} (${asset.default_instrument})`;
  instrument.append(option);
  $("currencySelect").value = asset.currency;
  $("portfolioForm").elements.fx_rate_to_sek.value = asset.currency === "SEK" ? "1" : "";
}

function openTransactionDialog({ switchFlow = false } = {}) {
  const started = Boolean(portfolio.started_at);
  $("dialogTitle").textContent = started ? (switchFlow ? "Registrera mitt byte" : "Ny transaktion") : "Starta mitt test";
  $("dialogIntro").textContent = switchFlow
    ? "App3 handlar aldrig åt dig. Registrera genomförd försäljning och köp som separata transaktioner."
    : "Registrera ditt köp. Uppgifterna lämnar aldrig webbläsaren.";
  $("startCapitalLabel").hidden = started;
  const selected = switchFlow ? publicSignal.signal.recommended_asset : publicSignal?.signal?.recommended_asset;
  fillAssetSelect(selected || Object.keys(registry)[0]);
  const form = $("portfolioForm");
  form.elements.date.value = publicSignal?.signal?.effective_date || new Date().toISOString().slice(0, 10);
  $("portfolioError").hidden = true;
  $("portfolioDialog").showModal();
}

function saveTransaction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    const transaction = normalizeTransaction(data, signalAssessment.verified ? publicSignal.strategy : MANUAL_BOOKKEEPING);
    const first = !portfolio.started_at;
    let next = { ...portfolio, transactions: [...portfolio.transactions, transaction] };
    if (first) {
      const calculatedStart = transactionValueSek(transaction) + transaction.fee_sek;
      next.started_at = transaction.date;
      next.start_capital_sek = data.start_capital_sek ? Number(data.start_capital_sek) : calculatedStart;
    }
    if (!PUBLIC_PORTFOLIO_ONLY) next = addValuation(next, {
      instrument: transaction.instrument,
      date: transaction.date,
      price: transaction.price,
      currency: transaction.currency,
      fx_rate_to_sek: transaction.fx_rate_to_sek,
    });
    if (PUBLIC_PORTFOLIO_ONLY) {
      holdingsFromTransactions(next.transactions);
      if (calculatePortfolio(next).cashSek < -0.005) throw new Error("Köpet överstiger registrerat startkapital och försäljningslikvid. Registrera bara affärer som ryms i din lokala portfölj.");
    }
    else next = recordSnapshot(next, transaction.date);
    if (benchmarkData) next = applyAutomaticValuations(next, benchmarkData);
    portfolio = store.save(next);
    form.reset();
    $("portfolioDialog").close();
    renderPortfolio();
    renderSignalHistory();
  } catch (error) {
    $("portfolioError").textContent = error.message;
    $("portfolioError").hidden = false;
  }
}

function openValuationDialog() {
  const holdings = holdingsFromTransactions(portfolio.transactions);
  const select = $("valuationInstrument");
  select.replaceChildren();
  holdings.forEach((holding) => {
    const option = document.createElement("option");
    option.value = holding.instrument;
    option.textContent = holding.instrument;
    option.dataset.currency = holding.currency;
    select.append(option);
  });
  $("valuationForm").reset();
  $("valuationForm").elements.date.value = "";
  $("valuationForm").elements.currency.value = holdings[0]?.currency || "SEK";
  $("valuationForm").elements.fx_rate_to_sek.value = holdings[0]?.currency === "SEK" ? "1" : "";
  $("valuationError").hidden = true;
  $("valuationDialog").showModal();
}

function saveValuation(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const today = new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Stockholm",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const parsed = new Date(`${data.date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== data.date || data.date > today) throw new Error("Ange ett riktigt avslutat handelsdatum, inte ett framtida datum.");
    const holding = holdingsFromTransactions(portfolio.transactions).find(item => item.instrument === data.instrument);
    if (!holding || holding.currency !== data.currency) throw new Error("Valutan stämmer inte med ditt registrerade instrument.");
    if (!data.source?.trim() || !data.confirmed_close) throw new Error("Ange källa och bekräfta att du kontrollerat slutkursen.");
    let next = addValuation(portfolio, data);
    if (!PUBLIC_PORTFOLIO_ONLY) next = recordSnapshot(next, data.date);
    portfolio = store.save(next);
    $("valuationDialog").close();
    renderPortfolio();
  } catch (error) {
    $("valuationError").textContent = error.message;
    $("valuationError").hidden = false;
  }
}

function exportPortfolio() {
  const blob = new Blob([store.exportJson()], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `app3-tester-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importPortfolio(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    portfolio = store.importJson(await file.text());
    if (benchmarkData) portfolio = store.save(applyAutomaticValuations(portfolio, benchmarkData));
    applyTheme(portfolio.settings.theme);
    renderPortfolio();
    renderSignalHistory();
  } catch (error) {
    alert(`Importen misslyckades: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function resetPortfolio() {
  $("resetDialog").showModal();
}

function confirmResetPortfolio() {
  portfolio = store.reset();
  $("resetDialog").close();
  renderPortfolio();
  renderSignalHistory();
}

async function loadPublicData() {
  try {
    if (PUBLIC_PORTFOLIO_ONLY) {
      registry = await loadAssetRegistry();
      signalAssessment = { verified: false, reason: "Automatisk signalering och bytesnotiser är pausade. Du kan registrera egna genomförda affärer och manuella ETF-värderingar. Inga aktuella handelsbesked publiceras." };
      renderSignal(); renderPortfolio(); renderSignalHistory();
      $("marketFreshnessStatus").textContent = "Automatisk uppdatering pausad";
      $("marketFreshnessWarning").textContent = "Kontrollera själv instrument, valuta, datum och källans slutkurs. Äldre kurser ska inte tolkas som dagens värde.";
      return;
    }
    const benchmarkPromise = loadBenchmarkData().catch((error) => {
      benchmarkError = error.message;
      return null;
    });
    const marketStatusPromise = loadMarketStatus().catch((error) => {
      marketStatusError = error.message;
      return null;
    });
    const strategyHistoryPromise = loadStrategyHistory().catch((error) => {
      strategyHistoryError = error.message;
      return null;
    });
    registry = await loadAssetRegistry();
    benchmarkData = await benchmarkPromise;
    strategyHistory = await strategyHistoryPromise;
    marketStatus = await marketStatusPromise;
    renderMarketStatus();
    if (benchmarkData && portfolio.started_at) {
      portfolio = store.save(applyAutomaticValuations(portfolio, benchmarkData));
    }
    const response = await fetch("./data/app3_signal.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Den publika signalfilen kunde inte laddas.");
    publicSignal = await response.json();
    signalAssessment = assessSignal(publicSignal, registry);
    if (signalAssessment.verified) {
      portfolio = store.save(rememberSignal(portfolio, publicSignal));
    }
    renderSignal();
    renderPortfolio();
    renderSignalHistory();
  } catch (error) {
    signalAssessment = { verified: false, reason: error.message };
    renderSignalFailure(error.message);
    renderPortfolio();
  }
}

$("themeButton").addEventListener("click", cycleTheme);
$("startButton").addEventListener("click", () => openTransactionDialog());
$("transactionButton").addEventListener("click", () => openTransactionDialog());
$("registerSwitchButton").addEventListener("click", () => openTransactionDialog({ switchFlow: true }));
$("assetSelect").addEventListener("change", syncInstrumentFromAsset);
$("portfolioForm").addEventListener("submit", saveTransaction);
$("closePortfolioDialog").addEventListener("click", () => $("portfolioDialog").close());
$("valuationButton").addEventListener("click", openValuationDialog);
$("valuationForm").addEventListener("submit", saveValuation);
$("closeValuationDialog").addEventListener("click", () => $("valuationDialog").close());
$("exportButton").addEventListener("click", exportPortfolio);
$("importInput").addEventListener("change", importPortfolio);
$("resetButton").addEventListener("click", resetPortfolio);
$("cancelResetButton").addEventListener("click", () => $("resetDialog").close());
$("confirmResetButton").addEventListener("click", confirmResetPortfolio);
window.addEventListener("resize", renderChart);

applyTheme(portfolio.settings.theme);
checkAppVersion();
renderMarketStatus();
loadPublicData();
// The approved retirement worker is updated only for existing App3 clients.
import("./pause.js?v=20261112-r2");
