function validSnapshot(row) {
  return row && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value_sek);
}

function assetAtDate(transactions, date) {
  const quantities = new Map();
  const assets = new Map();
  for (const transaction of [...(transactions || [])]
    .filter((row) => row.date <= date && (row.type === "BUY" || row.type === "SELL"))
    .sort((a, b) => a.date.localeCompare(b.date))) {
    const quantity = quantities.get(transaction.instrument) || 0;
    quantities.set(transaction.instrument, quantity + (transaction.type === "BUY" ? transaction.quantity : -transaction.quantity));
    assets.set(transaction.instrument, transaction.asset);
  }
  const active = [...quantities.entries()].find(([, quantity]) => quantity > 1e-8);
  return active ? assets.get(active[0]) : null;
}

function switchDates(transactions, firstDate) {
  let previous = null;
  const switches = [];
  for (const transaction of [...(transactions || [])]
    .filter((row) => row.type === "BUY" && row.date >= firstDate)
    .sort((a, b) => a.date.localeCompare(b.date))) {
    if (previous && transaction.asset !== previous) switches.push(transaction.date);
    previous = transaction.asset;
  }
  return [...new Set(switches)];
}

export function buildPerformanceComparison(portfolio, benchmarkData) {
  const startCapital = Number(portfolio?.start_capital_sek);
  const requestedStartDate = portfolio?.started_at;
  const empty = {
    requestedStartDate,
    comparisonStartDate: null,
    app3: [],
    nasdaq: [],
    omx: [],
    switchDates: [],
    latest: { app3: null, nasdaq: null, omx: null },
  };
  if (!requestedStartDate || !Number.isFinite(startCapital) || startCapital <= 0) return empty;

  const sourceRows = Array.isArray(benchmarkData?.observations)
    ? benchmarkData.observations.filter((row) => row[0] >= requestedStartDate)
    : [];
  if (!sourceRows.length) {
    const app3Only = (portfolio.snapshots || [])
      .filter((row) => validSnapshot(row) && row.date >= requestedStartDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        return_pct: (row.value_sek / startCapital - 1) * 100,
        asset: assetAtDate(portfolio.transactions, row.date),
      }));
    return { ...empty, app3: app3Only, latest: { ...empty.latest, app3: app3Only.at(-1)?.return_pct ?? null } };
  }

  const comparisonStartDate = sourceRows[0][0];
  const nasdaqBase = sourceRows[0][1];
  const omxBase = sourceRows[0][2];
  const nasdaq = sourceRows.map((row) => ({ date: row[0], return_pct: (row[1] / nasdaqBase - 1) * 100 }));
  const omx = sourceRows.map((row) => ({ date: row[0], return_pct: (row[2] / omxBase - 1) * 100 }));
  const app3 = (portfolio.snapshots || [])
    .filter((row) => validSnapshot(row) && row.date >= comparisonStartDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: row.date,
      return_pct: (row.value_sek / startCapital - 1) * 100,
      asset: assetAtDate(portfolio.transactions, row.date),
    }));

  return {
    requestedStartDate,
    comparisonStartDate,
    app3,
    nasdaq,
    omx,
    switchDates: switchDates(portfolio.transactions, comparisonStartDate),
    latest: {
      app3: app3.at(-1)?.return_pct ?? null,
      nasdaq: nasdaq.at(-1)?.return_pct ?? null,
      omx: omx.at(-1)?.return_pct ?? null,
    },
  };
}

export function drawPerformanceChart(canvas, comparison) {
  const context = canvas.getContext("2d");
  const width = Math.max(280, canvas.clientWidth || 320);
  const height = 300;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--surface-muted") || "#eef1f4";
  const muted = styles.getPropertyValue("--text-muted") || "#64707d";
  const grid = styles.getPropertyValue("--line") || "#dce3e0";
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const allRows = [...comparison.app3, ...comparison.nasdaq, ...comparison.omx];
  if (allRows.length < 2) {
    context.fillStyle = muted;
    context.font = "14px system-ui";
    context.textAlign = "center";
    context.fillText("Grafen visas när jämförelsedata finns för ditt startdatum", width / 2, height / 2);
    return;
  }

  const timestamps = allRows.map((row) => Date.parse(`${row.date}T00:00:00Z`));
  const values = allRows.map((row) => row.return_pct);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const valuePad = Math.max(2, (rawMax - rawMin) * 0.08);
  const minValue = rawMin - valuePad;
  const maxValue = rawMax + valuePad;
  const left = 52;
  const right = 14;
  const top = 18;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (date) => left + ((Date.parse(`${date}T00:00:00Z`) - minTime) / (maxTime - minTime || 1)) * plotWidth;
  const y = (value) => top + ((maxValue - value) / (maxValue - minValue || 1)) * plotHeight;

  context.font = "11px system-ui";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index += 1) {
    const value = minValue + ((maxValue - minValue) * index) / 4;
    const rowY = y(value);
    context.strokeStyle = grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, rowY);
    context.lineTo(width - right, rowY);
    context.stroke();
    context.fillStyle = muted;
    context.fillText(`${value >= 0 ? "+" : ""}${value.toFixed(0)} %`, left - 7, rowY);
  }

  const drawLine = (rows, color, lineWidth) => {
    if (rows.length < 2) return;
    context.beginPath();
    rows.forEach((row, index) => {
      const pointX = x(row.date);
      const pointY = y(row.return_pct);
      if (index === 0) context.moveTo(pointX, pointY); else context.lineTo(pointX, pointY);
    });
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineJoin = "round";
    context.stroke();
  };

  drawLine(comparison.omx, "#aeb5b2", 1.7);
  drawLine(comparison.nasdaq, "#69726f", 2);

  for (let index = 1; index < comparison.app3.length; index += 1) {
    const previous = comparison.app3[index - 1];
    const current = comparison.app3[index];
    context.beginPath();
    context.moveTo(x(previous.date), y(previous.return_pct));
    context.lineTo(x(current.date), y(current.return_pct));
    context.strokeStyle = previous.asset === "OMX" ? "#d94d55" : "#16a673";
    context.lineWidth = 3.2;
    context.lineCap = "round";
    context.stroke();
  }

  context.save();
  context.setLineDash([3, 4]);
  context.strokeStyle = "rgba(99, 112, 109, .55)";
  context.lineWidth = 1;
  comparison.switchDates.forEach((date) => {
    const markerX = x(date);
    context.beginPath();
    context.moveTo(markerX, top);
    context.lineTo(markerX, height - bottom);
    context.stroke();
  });
  context.restore();

  context.fillStyle = muted;
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillText(new Date(minTime).toLocaleDateString("sv-SE"), left, height - 10);
  context.textAlign = "right";
  context.fillText(new Date(maxTime).toLocaleDateString("sv-SE"), width - right, height - 10);
}
