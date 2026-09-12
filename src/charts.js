export function drawPerformanceChart(canvas, series = []) {
  const context = canvas.getContext("2d");
  const width = Math.max(280, canvas.clientWidth || 320);
  const height = 220;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--surface-muted") || "#eef1f4";
  context.fillRect(0, 0, width, height);

  const rows = series.filter((row) => Number.isFinite(row.value_sek));
  if (rows.length < 2) {
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-muted") || "#64707d";
    context.font = "14px system-ui";
    context.textAlign = "center";
    context.fillText("Grafen visas efter två lokala värderingar", width / 2, height / 2);
    return;
  }
  const values = rows.map((row) => row.value_sek);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 24;
  context.beginPath();
  rows.forEach((row, index) => {
    const x = pad + (index / (rows.length - 1)) * (width - pad * 2);
    const y = height - pad - ((row.value_sek - min) / range) * (height - pad * 2);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.strokeStyle = "#11976b";
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.stroke();
}
