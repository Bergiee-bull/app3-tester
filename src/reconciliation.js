import { calculatePortfolio, holdingsFromTransactions, transactionValueSek } from "./portfolio.js";

export const RECONCILIATION_TOLERANCE_PP = 0.01;

const ASSET_INDEX = { NASDAQ: 1, OMX: 2 };

function finite(value) {
  return Number.isFinite(Number(value));
}

function firstBuy(portfolio) {
  return [...(portfolio?.transactions || [])]
    .filter((transaction) => transaction.type === "BUY")
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

function valuationDate(portfolio) {
  return [...(portfolio?.valuations || [])]
    .map((value) => value.date)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function positionAtDate(positions, date) {
  let position = null;
  for (const event of positions) {
    if (event.effective_date > date) break;
    position = event.position;
  }
  return position;
}

function benchmarkValue(row, asset) {
  const index = ASSET_INDEX[asset];
  return index ? Number(row[index]) : null;
}

function marketRows(benchmarkData, startDate) {
  if (!Array.isArray(benchmarkData?.observations)) return [];
  return benchmarkData.observations
    .filter((row) => Array.isArray(row) && row.length === 3 && row[0] >= startDate)
    .filter((row) => finite(row[1]) && Number(row[1]) > 0 && finite(row[2]) && Number(row[2]) > 0);
}

function executionPriceSek(transaction) {
  if (!transaction || transaction.currency !== "EUR") {
    return transaction ? transaction.price * (transaction.fx_rate_to_sek || 1) : null;
  }
  return transaction.price * transaction.fx_rate_to_sek;
}

function buildCurve(rows, startDate, asset, positions, buy) {
  if (!rows.length) return [];
  const firstMarketValue = benchmarkValue(rows[0], asset);
  const execution = asset === "NASDAQ" && buy?.asset === "NASDAQ" && buy.instrument === "EQQQ"
    ? executionPriceSek(buy)
    : null;
  const bridgeFactor = execution && execution > 0 ? firstMarketValue / execution : 1;
  let equity = 1;
  const result = [{
    date: startDate,
    return_pct: 0,
    asset: positions ? positionAtDate(positions, startDate) : asset,
    anchor_factor: bridgeFactor,
  }];

  rows.forEach((row, index) => {
    if (index === 0) {
      if (row[0] === startDate) {
        result[0].anchor_factor = bridgeFactor;
      } else {
        result.push({
          date: row[0],
          return_pct: (equity * bridgeFactor - 1) * 100,
          asset: positions ? positionAtDate(positions, row[0]) : asset,
        });
      }
      return;
    }
    const previous = rows[index - 1];
    const currentValue = benchmarkValue(row, asset);
    const previousValue = benchmarkValue(previous, asset);
    equity *= currentValue / previousValue;
    result.push({
      date: row[0],
      return_pct: (equity * (result[0].anchor_factor || 1) - 1) * 100,
      asset: positions ? positionAtDate(positions, row[0]) : asset,
    });
  });
  if (rows.length === 1 && rows[0][0] === startDate) {
    result[0].return_pct = 0;
  }
  return result;
}

function buildStrategyCurve(rows, startDate, positions, buy) {
  if (!rows.length || !positions.length) return [];
  const firstPosition = positionAtDate(positions, startDate);
  if (!firstPosition) return [];
  const firstValue = benchmarkValue(rows[0], firstPosition);
  const execution = firstPosition === "NASDAQ" && buy?.asset === "NASDAQ" && buy.instrument === "EQQQ"
    ? executionPriceSek(buy)
    : null;
  const bridgeFactor = execution && execution > 0 ? firstValue / execution : 1;
  let equity = 1;
  const result = [{ date: startDate, return_pct: 0, asset: firstPosition, anchor_factor: bridgeFactor }];
  rows.forEach((row, index) => {
    const position = positionAtDate(positions, row[0]);
    if (!position) return;
    if (index === 0) {
      if (row[0] !== startDate) {
        result.push({ date: row[0], return_pct: (equity * bridgeFactor - 1) * 100, asset: position });
      }
      return;
    }
    const previous = rows[index - 1];
    equity *= benchmarkValue(row, position) / benchmarkValue(previous, position);
    result.push({
      date: row[0],
      return_pct: (equity * bridgeFactor - 1) * 100,
      asset: position,
    });
  });
  return result;
}

export function buildCanonicalComparisonCurves(portfolio, benchmarkData, strategyHistory) {
  const buy = firstBuy(portfolio);
  const requestedStartDate = buy?.date || portfolio?.started_at || null;
  const rows = requestedStartDate ? marketRows(benchmarkData, requestedStartDate) : [];
  const positions = Array.isArray(strategyHistory?.positions)
    ? [...strategyHistory.positions].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    : [];
  const startingPosition = requestedStartDate ? positionAtDate(positions, requestedStartDate) : null;
  if (!requestedStartDate || !rows.length || !positions.length || !startingPosition) {
    return {
      requestedStartDate,
      comparisonStartDate: requestedStartDate,
      comparisonEndDate: rows.at(-1)?.[0] || null,
      strategyHistoryValid: false,
      strategy: [],
      app3: [],
      nasdaq: [],
      omx: [],
      switchDates: [],
      latest: { strategy: null, app3: null, nasdaq: null, omx: null },
    };
  }
  const strategy = buildStrategyCurve(rows, requestedStartDate, positions, buy);
  const nasdaq = buildCurve(rows, requestedStartDate, "NASDAQ", null, buy);
  const omx = buildCurve(rows, requestedStartDate, "OMX", null, null);
  const comparisonEndDate = rows.at(-1)[0];
  return {
    requestedStartDate,
    comparisonStartDate: requestedStartDate,
    comparisonEndDate,
    firstMarketObservation: rows[0][0],
    strategyHistoryValid: strategy.length > 0,
    strategy,
    app3: strategy,
    nasdaq,
    omx,
    switchDates: positions
      .filter((event) => event.effective_date > requestedStartDate && event.effective_date <= comparisonEndDate)
      .map((event) => event.effective_date),
    latest: {
      strategy: strategy.at(-1)?.return_pct ?? null,
      app3: strategy.at(-1)?.return_pct ?? null,
      nasdaq: nasdaq.at(-1)?.return_pct ?? null,
      omx: omx.at(-1)?.return_pct ?? null,
    },
  };
}

function endValueForSimplePortfolio(portfolio, rows, comparisonEnd) {
  const transactions = [...(portfolio?.transactions || [])].filter((transaction) => transaction.date <= comparisonEnd);
  const buys = transactions.filter((transaction) => transaction.type === "BUY");
  const supported = transactions.every((transaction) => ["BUY", "DIVIDEND"].includes(transaction.type))
    && buys.length === 1;
  const holdings = holdingsFromTransactions(transactions);
  if (!supported || !holdings.length) return null;
  let value = 0;
  for (const holding of holdings) {
    const asset = holding.asset;
    const row = rows.at(-1);
    const canonical = benchmarkValue(row, asset);
    if (!(canonical > 0)) return null;
    value += holding.quantity * canonical;
  }
  return { value, buys };
}

function warningsFor(portfolio, benchmarkData, rows, comparable) {
  const warnings = [];
  if (benchmarkData?.latest_common_trading_date !== rows.at(-1)?.[0]) {
    warnings.push("Benchmarkens latest_common_trading_date matchar inte observationsseriens slut.");
  }
  if (portfolio?.transactions?.some((transaction) => transaction.type === "DIVIDEND")) {
    warnings.push("Utdelning/cashflow finns lokalt och måste ha samma behandling som Adjusted Close för full reconciliation.");
  }
  if (!comparable) warnings.push("Personlig jämförbar bruttoavkastning kan inte beräknas för alla lokala transaktioner.");
  return warnings;
}

export function buildComparisonReconciliation(portfolio, benchmarkData, strategyHistory, performanceComparison = null) {
  const buy = firstBuy(portfolio);
  const userStart = buy?.date || portfolio?.started_at || null;
  const rows = userStart ? marketRows(benchmarkData, userStart) : [];
  const comparisonEnd = rows.at(-1)?.[0] || null;
  const positions = Array.isArray(strategyHistory?.positions)
    ? [...strategyHistory.positions].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    : [];
  const canonical = performanceComparison || buildCanonicalComparisonCurves(portfolio, benchmarkData, strategyHistory);
  const strategy = canonical.strategy;
  const nasdaq = canonical.nasdaq;
  const omx = canonical.omx;
  const strategyReturn = strategy.at(-1)?.return_pct ?? null;
  const nasdaqReturn = nasdaq.at(-1)?.return_pct ?? null;
  const omxReturn = omx.at(-1)?.return_pct ?? null;
  const actual = calculatePortfolio(portfolio || {});
  const actualAsOf = valuationDate(portfolio);
  const simple = comparisonEnd ? endValueForSimplePortfolio(portfolio, rows, comparisonEnd) : null;
  const initialGross = buy ? transactionValueSek(buy) : null;
  const startCapital = finite(portfolio?.start_capital_sek) ? Number(portfolio.start_capital_sek) : initialGross;
  const comparableTransactions = (portfolio?.transactions || []).filter((transaction) => transaction.date <= comparisonEnd);
  const grossCash = startCapital === null ? null : startCapital - comparableTransactions
    .reduce((sum, transaction) => sum + (transaction.type === "BUY" ? transactionValueSek(transaction) : 0), 0);
  const comparableGrossValue = simple?.value !== undefined && grossCash !== null
    ? simple.value + grossCash
    : null;
  const comparableGrossReturn = comparableGrossValue !== null && startCapital > 0
    ? (comparableGrossValue / startCapital - 1) * 100
    : null;
  const fees = comparableTransactions.reduce((sum, transaction) => sum + Number(transaction.fee_sek || 0), 0);
  const cashAfterTransactions = grossCash === null ? null : grossCash - fees;
  const comparableNetValue = comparableGrossValue === null || cashAfterTransactions === null
    ? null
    : simple.value + cashAfterTransactions;
  const comparableNetReturn = comparableNetValue !== null && startCapital > 0
    ? (comparableNetValue / startCapital - 1) * 100
    : null;
  const personalComparableReturn = comparableGrossReturn;
  const feesEffect = comparableNetReturn !== null && comparableGrossReturn !== null
    ? comparableNetReturn - comparableGrossReturn
    : null;
  const capitalBasisEffect = personalComparableReturn !== null && strategyReturn !== null
    ? personalComparableReturn - strategyReturn
    : null;
  const totalComparableGap = comparableNetReturn !== null && strategyReturn !== null
    ? comparableNetReturn - strategyReturn
    : null;
  const breakdown = {
    execution_anchor_pp: 0,
    date_cut_pp: actual.totalReturnPct !== null && comparableNetReturn !== null && actualAsOf !== comparisonEnd
      ? actual.totalReturnPct - comparableNetReturn
      : 0,
    fx_pp: 0,
    fees_pp: feesEffect,
    dividends_pp: 0,
    capital_basis_pp: capitalBasisEffect,
    rounding_pp: 0,
    unexplained_residual_pp: totalComparableGap !== null && feesEffect !== null && capitalBasisEffect !== null
      ? totalComparableGap - feesEffect - capitalBasisEffect
      : null,
  };
  const noSwitchEqqq = Boolean(
    buy?.asset === "NASDAQ"
    && buy.instrument === "EQQQ"
    && positions.length > 0
    && positions.every((event) => event.position === "NASDAQ")
    && (portfolio?.transactions || []).every((transaction) => transaction.type === "BUY")
    && comparableGrossReturn !== null
    && nasdaqReturn !== null,
  );
  const reconciliationPass = noSwitchEqqq
    ? Math.abs(comparableGrossReturn - nasdaqReturn) <= RECONCILIATION_TOLERANCE_PP
      && Math.abs((strategyReturn ?? 0) - (nasdaqReturn ?? 0)) <= RECONCILIATION_TOLERANCE_PP
    : breakdown.unexplained_residual_pp === null || Math.abs(breakdown.unexplained_residual_pp) <= RECONCILIATION_TOLERANCE_PP;
  return {
    valid: Boolean(userStart && comparisonEnd && rows.length && strategy.length),
    user_app3_start: userStart,
    comparison_start: userStart,
    comparison_end: comparisonEnd,
    first_market_observation: rows[0]?.[0] || null,
    latest_common_comparison_date: comparisonEnd,
    portfolio_as_of_date: actualAsOf,
    strategy_as_of_date: comparisonEnd,
    eqqq_as_of_date: comparisonEnd,
    xact_as_of_date: comparisonEnd,
    start_transaction: buy ? {
      date: buy.date,
      asset: buy.asset,
      instrument: buy.instrument,
      quantity: buy.quantity,
      price: buy.price,
      currency: buy.currency,
      fx_rate_to_sek: buy.fx_rate_to_sek,
      execution_value_sek: executionPriceSek(buy) * buy.quantity,
    } : null,
    start_capital_sek: startCapital,
    current: {
      portfolio_value_sek: actual.currentValueSek ?? null,
      portfolio_net_return_pct: actual.totalReturnPct ?? null,
      portfolio_gross_return_pct: comparableGrossReturn,
      portfolio_comparable_net_return_pct: comparableNetReturn,
      app3_strategy_return_pct: strategyReturn,
      eqqq_buy_and_hold_return_pct: nasdaqReturn,
      xact_buy_and_hold_return_pct: omxReturn,
    },
    personal: {
      actual_as_of_date: actualAsOf,
      actual_current_value_sek: actual.currentValueSek ?? null,
      actual_net_return_pct: actual.totalReturnPct ?? null,
      comparable_gross_return_pct: comparableGrossReturn,
      comparable_net_return_pct: comparableNetReturn,
    },
    curves: { strategy, nasdaq, omx },
    method: {
      comparison_start: userStart,
      comparison_end: comparisonEnd,
      strategy_price_field: benchmarkData?.benchmarks?.NASDAQ?.price_field || "Adj Close",
      nasdaq_price_field: benchmarkData?.benchmarks?.NASDAQ?.price_field || "Adj Close",
      omx_price_field: benchmarkData?.benchmarks?.OMX?.price_field || "Adj Close",
      nasdaq_fx_symbol: benchmarkData?.benchmarks?.NASDAQ?.fx_symbol || "EURSEK=X",
      nasdaq_fx_source: benchmarkData?.benchmarks?.NASDAQ?.fx_source || "public benchmark export",
      return_basis: benchmarkData?.return_basis || "adjusted_close_with_provider_reported_distributions",
      dividend_treatment: "Adjusted Close includes provider-reported distributions; local DIVIDEND cash is not added again to comparable total return.",
      normalization: "All curves are normalized to 0% at the user's first BUY date; the first market observation is bridged from the actual EQQQ execution basis when applicable.",
      execution_anchor_formula: "first_market_value / (purchase_price * purchase_fx_to_sek), then daily adjusted-close factors",
    },
    breakdown,
    warnings: warningsFor(portfolio, benchmarkData, rows, comparableGrossValue !== null),
    reconciliation_passed: reconciliationPass,
    no_switch_eqqq_invariant: noSwitchEqqq,
  };
}

export function assertComparisonReconciles(reconciliation) {
  if (!reconciliation?.valid) throw new Error("Jämförelsen saknar en giltig gemensam start/slutpunkt.");
  if (!reconciliation.comparison_start || !reconciliation.comparison_end) {
    throw new Error("Jämförelsens start eller slutdatum saknas.");
  }
  if (reconciliation.breakdown?.unexplained_residual_pp !== null
    && Math.abs(reconciliation.breakdown.unexplained_residual_pp) > RECONCILIATION_TOLERANCE_PP) {
    throw new Error("Jämförelsen har en oförklarad residual.");
  }
  if (reconciliation.reconciliation_passed === false) {
    throw new Error("Jämförelsen kunde inte reconcileras inom toleransen.");
  }
  return true;
}
