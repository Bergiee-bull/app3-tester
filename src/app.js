import { loadAssetRegistry } from "./asset_registry.js";
import { assessSignal, signalViewModel } from "./signal.js";
import { createPortfolioStore } from "./storage.js";
import {
  addValuation,
  calculatePortfolio,
  holdingsFromTransactions,
  normalizeTransaction,
  recordSnapshot,
  rememberSignal,
  transactionValueSek,
} from "./portfolio.js";
import { drawPerformanceChart } from "./charts.js";

const $ = (id) => document.getElementById(id);
const store = createPortfolioStore(window.localStorage);
let portfolio = store.load();
let publicSignal = null;
let registry = null;
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
  const result = calculatePortfolio(portfolio);
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
  $("holdingAsset").textContent = holding ? registry?.[holding.asset]?.display_name || holding.asset : "Ingen investerad tillgång";
  $("holdingInstrument").textContent = holding?.instrument || "Kassa";
  $("holdingQuantity").textContent = holding ? `${holding.quantity.toLocaleString("sv-SE")} st` : "–";
  $("startValue").textContent = formatSek(result.startCapitalSek);
  $("currentValue").textContent = formatSek(result.currentValueSek);
  setReturn($("totalReturn"), result.totalReturnPct);
  setReturn($("ytdReturn"), result.ytdReturnPct);
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
      `${transaction.quantity.toLocaleString("sv-SE")} st · ${transaction.strategy_id}`,
    );
  });
}

function renderSignalHistory() {
  const container = $("signalHistory");
  container.replaceChildren();
  if (!portfolio.signal_history.length) {
    container.className = "empty-state";
    container.textContent = "Historiken byggs när appen tar emot signaler.";
    return;
  }
  container.className = "";
  portfolio.signal_history.forEach((signal) => {
    const transition = signal.action === "SWITCH"
      ? `${signal.previous_asset} → ${signal.recommended_asset}`
      : `${signal.action} ${signal.recommended_asset}`;
    row(container, signal.signal_date, transition, `${signal.strategy_id} · ${signal.strategy_version}`);
  });
}

function renderChart() {
  if ($("performanceSection").hidden) return;
  drawPerformanceChart($("performanceChart"), portfolio.snapshots);
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
    option.textContent = asset.display_name;
    option.selected = assetId === selectedAsset;
    select.append(option);
  });
  syncInstrumentFromAsset();
}

function syncInstrumentFromAsset() {
  const asset = registry[$("assetSelect").value];
  if (!asset) return;
  $("instrumentInput").value = asset.default_instrument;
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
    const transaction = normalizeTransaction(data, publicSignal.strategy);
    const first = !portfolio.started_at;
    let next = { ...portfolio, transactions: [...portfolio.transactions, transaction] };
    if (first) {
      const calculatedStart = transactionValueSek(transaction) + transaction.fee_sek;
      next.started_at = transaction.date;
      next.start_capital_sek = data.start_capital_sek ? Number(data.start_capital_sek) : calculatedStart;
    }
    next = addValuation(next, {
      instrument: transaction.instrument,
      date: transaction.date,
      price: transaction.price,
      currency: transaction.currency,
      fx_rate_to_sek: transaction.fx_rate_to_sek,
    });
    next = recordSnapshot(next, transaction.date);
    portfolio = store.save(next);
    form.reset();
    $("portfolioDialog").close();
    renderPortfolio();
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
  $("valuationForm").elements.date.value = new Date().toISOString().slice(0, 10);
  $("valuationForm").elements.currency.value = holdings[0]?.currency || "SEK";
  $("valuationForm").elements.fx_rate_to_sek.value = holdings[0]?.currency === "SEK" ? "1" : "";
  $("valuationError").hidden = true;
  $("valuationDialog").showModal();
}

function saveValuation(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    let next = addValuation(portfolio, data);
    next = recordSnapshot(next, data.date);
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
  if (!confirm("Radera alla lokala App3-transaktioner och värderingar på den här enheten?")) return;
  portfolio = store.reset();
  renderPortfolio();
  renderSignalHistory();
}

async function loadPublicData() {
  try {
    registry = await loadAssetRegistry();
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
window.addEventListener("resize", renderChart);

applyTheme(portfolio.settings.theme);
loadPublicData();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
