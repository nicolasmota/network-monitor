const RING = 2 * Math.PI * 52;

const els = {
  subline: document.querySelector("#subline"),
  live: document.querySelector("#live"),
  liveText: document.querySelector("#liveText"),
  error: document.querySelector("#error"),
  score: document.querySelector("#score"),
  scoreLabel: document.querySelector("#scoreLabel"),
  ring: document.querySelector("#ring"),
  reasons: document.querySelector("#reasons"),
  ssid: document.querySelector("#ssid"),
  wifiMeta: document.querySelector("#wifiMeta"),
  meter: document.querySelector("#meter"),
  wifiFacts: document.querySelector("#wifiFacts"),
  iface: document.querySelector("#iface"),
  down: document.querySelector("#down"),
  up: document.querySelector("#up"),
  session: document.querySelector("#session"),
  story: document.querySelector("#story"),
  latency: document.querySelector("#latency"),
  chart: document.querySelector("#chart"),
  chartTip: document.querySelector("#chartTip"),
  adapters: document.querySelector("#adapters"),
  nearby: document.querySelector("#nearby"),
  nearbyAge: document.querySelector("#nearbyAge"),
  procs: document.querySelector("#procs"),
  procAge: document.querySelector("#procAge"),
};

function level(kind, value) {
  if (value == null || Number.isNaN(value)) return "";
  if (kind === "signal") return value >= 75 ? "lvl-good" : value >= 50 ? "lvl-warn" : "lvl-bad";
  if (kind === "gateway") return value <= 8 ? "lvl-good" : value <= 25 ? "lvl-warn" : "lvl-bad";
  if (kind === "dns") return value <= 80 ? "lvl-good" : value <= 250 ? "lvl-warn" : "lvl-bad";
  return value <= 40 ? "lvl-good" : value <= 80 ? "lvl-warn" : "lvl-bad";
}

function formatRate(bps) {
  if (bps == null || !Number.isFinite(bps)) return "measuring";
  const bits = Math.max(0, bps * 8);
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbps`;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbps`;
  if (bits >= 1e3) return `${Math.round(bits / 1e3)} Kbps`;
  return `${Math.round(bits)} bps`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function ageText(iso) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "now";
  return `${seconds}s ago`;
}

function clear(node) {
  node.replaceChildren();
}

function add(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  parent.append(node);
  return node;
}

function render(data) {
  const wifi = data.wifi || {};
  const traffic = data.traffic || {};
  const health = data.health || {};
  document.title = health.score != null ? `${health.score} · Network monitor` : "Network monitor";

  const place = [traffic.ip, data.gateway ? `router ${data.gateway}` : null].filter(Boolean).join(" · ");
  els.subline.textContent = place || "Collecting signal, traffic, and latency.";

  const fresh = data.updatedAt && Date.now() - new Date(data.updatedAt).getTime() < 6000;
  els.live.className = `live ${fresh ? "ok" : "bad"}`;
  els.liveText.textContent = fresh ? "live" : "no new reading";

  els.error.hidden = !data.error;
  els.error.textContent = data.error || "";

  const score = health.score ?? 0;
  els.score.textContent = health.score == null ? "—" : String(health.score);
  els.scoreLabel.textContent = health.label || "reading";
  const tone = score >= 85 ? "var(--good)" : score >= 50 ? "var(--warn)" : "var(--bad)";
  els.ring.style.stroke = tone;
  els.ring.style.strokeDashoffset = String(RING * (1 - score / 100));

  clear(els.reasons);
  for (const reason of health.reasons || []) add(els.reasons, "li", "", reason);

  els.ssid.textContent = wifi.connected ? wifi.ssid || "Connected" : wifi.available ? "Disconnected" : "No Wi-Fi radio";
  const rssi = wifi.rssi == null ? "" : `${wifi.rssi} dBm`;
  const signalText = wifi.signal == null ? "no signal" : `${wifi.signal}%`;
  els.wifiMeta.textContent = [signalText, rssi, rssiWords(wifi.rssi)].filter(Boolean).join(" · ");
  const signalLevel = level("signal", wifi.signal);
  els.meter.style.width = `${Math.max(0, Math.min(100, wifi.signal || 0))}%`;
  els.meter.className = signalLevel;

  clear(els.wifiFacts);
  const facts = [
    ["Receive", wifi.rxMbps != null ? `${wifi.rxMbps} Mbps` : "—"],
    ["Transmit", wifi.txMbps != null ? `${wifi.txMbps} Mbps` : "—"],
    ["Channel", wifi.channel != null ? String(wifi.channel) : "—"],
    ["Band", wifi.band || "—"],
    ["Radio", wifi.radio || "—"],
    ["Security", wifi.auth || "—"],
  ];
  const here = (data.nearby || []).find((network) => network.ssid === wifi.ssid);
  if (here?.utilization != null) facts.push(["Channel use", `${here.utilization}%`]);
  if (here?.stations != null) facts.push(["Clients on AP", String(here.stations)]);
  for (const [label, value] of facts) {
    const wrap = add(els.wifiFacts, "div");
    add(wrap, "dt", "", label);
    add(wrap, "dd", "", value);
  }

  els.iface.textContent = traffic.interface
    ? `${traffic.interface}${traffic.linkSpeed ? ` · link ${traffic.linkSpeed}` : ""}`
    : "";
  els.down.textContent = formatRate(traffic.downBps);
  els.up.textContent = formatRate(traffic.upBps);
  els.session.textContent = `This session: ${formatBytes(traffic.sessionDown || 0)} received · ${formatBytes(traffic.sessionUp || 0)} sent`;

  clear(els.story);
  for (const line of data.diagnosis || []) add(els.story, "p", "", line);

  clear(els.latency);
  renderProbe(els.latency, "Router", data.latency?.gateway, "gateway");
  renderProbe(els.latency, "Internet", data.latency?.internet, "internet");
  renderDns(els.latency, data.latency?.dns);

  drawChart(els.chart, data.history || []);
  renderAdapters(data.adapters || [], data.wifi?.ssid);
  renderNearby(data.nearby || [], data.wifi, data.nearbyUpdatedAt);
  renderProcs(data.connections, data.processUpdatedAt);
}

function rssiWords(rssi) {
  if (rssi == null) return "";
  if (rssi >= -50) return "excellent";
  if (rssi >= -60) return "very good";
  if (rssi >= -67) return "good";
  if (rssi >= -75) return "fair";
  if (rssi >= -82) return "weak";
  return "very weak";
}

function renderProbe(parent, title, probe, kind) {
  const card = add(parent, "article", "card");
  add(card, "h2", "", title);
  const value = add(card, "strong", level(kind === "gateway" ? "gateway" : "internet", probe?.avg));
  value.textContent = probe?.avg == null ? "—" : `${probe.avg} ms`;
  const detail = [
    probe?.min != null && probe?.max != null ? `${probe.min}–${probe.max} ms` : null,
    probe?.jitter != null ? `jitter ${probe.jitter} ms` : null,
    probe?.loss != null ? `loss ${probe.loss}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  add(card, "p", "fine", detail || probe?.host || "waiting for ping");
}

function renderDns(parent, dns) {
  const card = add(parent, "article", "card");
  add(card, "h2", "", "DNS");
  const value = add(card, "strong", level("dns", dns?.ms));
  value.textContent = dns?.ok ? (dns.ms < 1 ? "<1 ms" : `${dns.ms} ms`) : dns?.ok === false ? "failed" : "—";
  add(card, "p", "fine", dns?.host || "");
}

function renderAdapters(adapters, ssid) {
  clear(els.adapters);
  if (!adapters.length) {
    add(els.adapters, "p", "empty", "No adapter read yet.");
    return;
  }
  const list = add(els.adapters, "div", "list");
  for (const adapter of adapters) {
    const row = add(list, "div", "item");
    const name = add(row, "b", "", adapter.name);
    if (ssid && adapter.primary) name.textContent = `${adapter.name}`;
    const tag = add(row, "span", `tag ${adapter.status === "Up" ? "on" : ""}`);
    tag.textContent = adapter.primary ? "internet path" : adapter.side ? "virtual" : adapter.status === "Up" ? "up" : "down";
    const meta = [adapter.ip, adapter.linkSpeed, adapter.description].filter(Boolean).join(" · ");
    add(row, "p", "fine", meta);
    if (adapter.downBps != null) {
      add(row, "p", "fine", `${formatRate(adapter.downBps)} down · ${formatRate(adapter.upBps)} up`);
    }
  }
}

function renderNearby(networks, wifi, updatedAt) {
  els.nearbyAge.textContent = updatedAt ? `scan ${ageText(updatedAt)}` : "scanning";
  clear(els.nearby);
  if (!networks.length) {
    add(els.nearby, "p", "empty", "Nearby networks show up after the first scan.");
    return;
  }
  const list = add(els.nearby, "div", "list");
  for (const network of networks) {
    const row = add(list, "div", "item");
    add(row, "b", "", network.ssid);
    const tag = add(row, "span", `tag ${network.ssid === wifi?.ssid ? "on" : ""}`);
    tag.textContent = network.ssid === wifi?.ssid ? "this network" : `${network.signal ?? "—"}%`;
    add(
      row,
      "p",
      "fine",
      [
        network.channel != null ? `channel ${network.channel}` : null,
        network.band,
        network.radio,
        network.utilization != null ? `air ${network.utilization}%` : null,
        network.bssidCount > 1 ? `${network.bssidCount} APs` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    const bar = add(row, "div", "bar signal");
    const fill = add(bar, "span", level("signal", network.signal));
    fill.style.width = `${Math.max(0, Math.min(100, network.signal || 0))}%`;
  }
}

function renderProcs(connections, updatedAt) {
  const count = connections?.established;
  els.procAge.textContent =
    count == null
      ? "Counts open TCP conversations. Throughput stays for the whole machine."
      : `${count} established connections · ${ageText(updatedAt)}`;
  clear(els.procs);
  const top = connections?.top || [];
  if (!top.length) {
    add(els.procs, "p", "empty", "The app list arrives in a few seconds.");
    return;
  }
  const max = Math.max(...top.map((item) => item.count), 1);
  const list = add(els.procs, "div", "list");
  for (const item of top) {
    const row = add(list, "div", "item");
    add(row, "b", "", item.name);
    add(row, "span", "tag", String(item.count));
    const bar = add(row, "div", "bar");
    const fill = add(bar, "span");
    fill.style.width = `${Math.round((item.count / max) * 100)}%`;
  }
}

let chartHistory = [];
let hoverX = null;

function drawChart(canvas, history) {
  chartHistory = history;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 260;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (history.length < 2) {
    hideChartTip();
    return;
  }

  const pad = { l: 54, r: 46, t: 22, b: 28 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const downs = history.map((point) => mbpsOf(point.downBps));
  const ups = history.map((point) => mbpsOf(point.upBps));
  const lats = history.map((point) => point.internetMs);
  const speed = throughputAxis(Math.max(0, ...downs, ...ups));
  const maxLat = latencyAxis(Math.max(0, ...lats.filter((value) => value != null)));
  const windowMs = 15 * 60 * 1000;
  const latest = history[history.length - 1].t;
  const start = latest - windowMs;
  const x = (index) => pad.l + ((history[index].t - start) / windowMs) * plotW;
  const yMbps = (value) => pad.t + plotH - (plotH * value) / speed.maxMbps;
  const yLat = (value) => pad.t + plotH - (plotH * value) / maxLat;

  ctx.font = "11px Consolas, monospace";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#93a6b8";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText(speed.unit, 8, pad.t - 4);
  ctx.textAlign = "right";
  ctx.fillText("ms", width - 8, pad.t - 4);

  ctx.textBaseline = "middle";
  for (let step = 0; step <= 4; step += 1) {
    const y = pad.t + (plotH * step) / 4;
    const speedValue = speed.maxMbps * (1 - step / 4);
    const latValue = maxLat * (1 - step / 4);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(formatTick(speed.label(speedValue)), pad.l - 8, y);
    ctx.textAlign = "left";
    ctx.fillText(formatTick(latValue), pad.l + plotW + 8, y);
  }

  ctx.textBaseline = "top";
  const minute = 3 * 60 * 1000;
  for (let tick = Math.ceil(start / minute) * minute; tick <= latest; tick += minute) {
    const px = pad.l + ((tick - start) / windowMs) * plotW;
    ctx.textAlign = "center";
    ctx.fillText(formatAxisTime(tick), px, pad.t + plotH + 8);
  }

  ctx.beginPath();
  downs.forEach((value, index) => {
    const px = x(index);
    const py = yMbps(value);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineTo(x(downs.length - 1), pad.t + plotH);
  ctx.lineTo(x(0), pad.t + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(94, 224, 194, 0.16)";
  ctx.fill();

  stroke(ctx, downs.map((value, index) => [x(index), yMbps(value)]), "#5ee0c2", false);
  stroke(ctx, ups.map((value, index) => [x(index), yMbps(value)]), "#8eb6ff", true);
  stroke(
    ctx,
    lats.flatMap((value, index) => (value == null ? [] : [[x(index), yLat(value)]])),
    "#f0c14a",
    false,
  );

  const hover = hoverIndex(history, pad, plotW, x);
  if (!hover) {
    hideChartTip();
    return;
  }

  const { index, px } = hover;
  ctx.save();
  ctx.strokeStyle = "rgba(232, 240, 246, 0.45)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(px, pad.t);
  ctx.lineTo(px, pad.t + plotH);
  ctx.stroke();
  ctx.restore();
  markPoint(ctx, px, yMbps(downs[index]), "#5ee0c2");
  markPoint(ctx, px, yMbps(ups[index]), "#8eb6ff");
  if (lats[index] != null) markPoint(ctx, px, yLat(lats[index]), "#f0c14a");
  showChartTip(history[index], px);
}

function hoverIndex(history, pad, plotW, x) {
  if (hoverX == null || hoverX < pad.l || hoverX > pad.l + plotW) return null;
  let index = 0;
  let best = Infinity;
  for (let i = 0; i < history.length; i += 1) {
    const distance = Math.abs(x(i) - hoverX);
    if (distance < best) {
      best = distance;
      index = i;
    }
  }
  if (best > 28) return null;
  return { index, px: x(index) };
}

function markPoint(ctx, x, y, color) {
  ctx.beginPath();
  ctx.fillStyle = "#071018";
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function showChartTip(point, xPx) {
  const tip = els.chartTip;
  clear(tip);
  add(tip, "p", "tip-time", formatClock(point.t));
  addTipRow(tip, "down", "Download", rateOrDash(point.downBps));
  addTipRow(tip, "up", "Upload", rateOrDash(point.upBps));
  addTipRow(tip, "lat", "Latency", point.internetMs == null ? "—" : `${point.internetMs} ms`);
  if (point.signal != null) addTipRow(tip, "sig", "Signal", `${point.signal}%`);
  tip.hidden = false;
  const wrapWidth = tip.parentElement.clientWidth;
  const tipWidth = tip.offsetWidth;
  let left = xPx + 14;
  if (left + tipWidth > wrapWidth - 8) left = xPx - tipWidth - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = "12px";
}

function addTipRow(parent, kind, label, value) {
  const row = add(parent, "p", "tip-row");
  add(row, "i", `swatch ${kind}`);
  add(row, "span", "", label);
  add(row, "b", "", value);
}

function hideChartTip() {
  els.chartTip.hidden = true;
}

function rateOrDash(bps) {
  if (bps == null || !Number.isFinite(bps)) return "—";
  return formatRate(bps);
}

function formatClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatAxisTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function mbpsOf(bps) {
  if (bps == null || !Number.isFinite(bps)) return 0;
  return (bps * 8) / 1e6;
}

function throughputAxis(peakMbps) {
  const peak = Number.isFinite(peakMbps) ? peakMbps : 0;
  if (peak < 1) {
    const maxKbps = axisMax(peak * 1000, [10, 20, 40, 50, 100, 200, 400, 500, 800, 1000]);
    return { maxMbps: maxKbps / 1000, unit: "Kbps", label: (mbps) => mbps * 1000 };
  }
  const max = axisMax(peak, [1, 2, 4, 8, 10, 20, 40, 60, 80, 100, 200, 400, 800, 1000]);
  return { maxMbps: max, unit: "Mbps", label: (mbps) => mbps };
}

function latencyAxis(peak) {
  return axisMax(peak, [20, 40, 60, 80, 100, 120, 160, 200, 240, 300, 400, 500, 800, 1000]);
}

function axisMax(peak, choices) {
  const found = choices.find((item) => item >= peak);
  if (found != null) return found;
  const top = choices[choices.length - 1];
  return Math.ceil(peak / top) * top;
}

function formatTick(value) {
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) return String(Math.round(rounded));
  return rounded.toFixed(1);
}

function stroke(ctx, points, color, dashed) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  points.forEach(([px, py], index) => {
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    render(await response.json());
  } catch {
    els.live.className = "live bad";
    els.liveText.textContent = "no contact";
  } finally {
    busy = false;
  }
}

els.chart.addEventListener("mousemove", (event) => {
  const rect = els.chart.getBoundingClientRect();
  hoverX = event.clientX - rect.left;
  drawChart(els.chart, chartHistory);
});

els.chart.addEventListener("mouseleave", () => {
  hoverX = null;
  drawChart(els.chart, chartHistory);
});

tick();
setInterval(tick, 2000);
window.addEventListener("resize", () => tick());
