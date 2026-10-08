export function normKey(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fields(lines) {
  const map = new Map();
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = normKey(line.slice(0, idx));
    const val = line.slice(idx + 1).trim();
    if (!map.has(key)) map.set(key, val);
  }
  return map;
}

function percent(value) {
  if (value == null) return null;
  const match = String(value).match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

function numberOf(value) {
  if (value == null) return null;
  const match = String(value).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function includesValue(map, part) {
  for (const [key, value] of map) {
    if (key.includes(part)) return value;
  }
  return null;
}

export function parseWlanInterfaces(text) {
  const blocks = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(name|nome)\s*:/i.test(line) && !/interface/i.test(line)) {
      if (current) blocks.push(current);
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current);

  return blocks.map((lines) => {
    const map = fields(lines);
    const state = map.get("state") || map.get("estado") || "";
    return {
      name: map.get("name") || map.get("nome"),
      description: map.get("description") || map.get("descricao"),
      state,
      connected: /connected|conectado/i.test(state),
      ssid: map.get("ssid"),
      bssid: includesValue(map, "bssid"),
      signal: percent(map.get("signal") || map.get("sinal")),
      rssi: numberOf(map.get("rssi")),
      channel: numberOf(map.get("channel") || map.get("canal")),
      band: map.get("band") || map.get("banda"),
      radio: includesValue(map, "radio"),
      rxMbps: numberOf(includesValue(map, "receive rate") || includesValue(map, "taxa de recep")),
      txMbps: numberOf(includesValue(map, "transmit rate") || includesValue(map, "taxa de transmis")),
      auth: map.get("authentication") || map.get("autenticacao"),
    };
  });
}

export function parseWlanNetworks(text) {
  const networks = [];
  let current = null;
  let bssid = null;

  const flushBssid = () => {
    if (current && bssid) current.bssids.push(bssid);
    bssid = null;
  };

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    let match = line.match(/^SSID\s+\d+\s*:\s*(.*)$/i);
    if (match) {
      flushBssid();
      current = {
        ssid: match[1].trim() || "(hidden)",
        auth: null,
        bssids: [],
      };
      networks.push(current);
      continue;
    }
    if (!current) continue;

    match = line.match(/^BSSID\s+\d+\s*:\s*(.*)$/i);
    if (match) {
      flushBssid();
      bssid = {
        bssid: match[1].trim(),
        signal: null,
        channel: null,
        band: null,
        radio: null,
        utilization: null,
        stations: null,
      };
      continue;
    }

    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = normKey(kv[1]);
    const val = kv[2].trim();
    if (bssid) {
      if (key === "signal" || key === "sinal") bssid.signal = percent(val);
      else if (key === "channel" || key === "canal") bssid.channel = numberOf(val);
      else if (key === "band" || key === "banda") bssid.band = val;
      else if (key.includes("radio")) bssid.radio = val;
      else if (key.startsWith("channel utilization")) bssid.utilization = utilizationPercent(val);
      else if (key.startsWith("connected stations")) bssid.stations = numberOf(val);
    } else if (key.startsWith("authentication") || key.startsWith("autentic")) {
      current.auth = val;
    }
  }
  flushBssid();

  return networks
    .map((network) => {
      const best = network.bssids.reduce(
        (winner, item) => ((item.signal ?? -1) > (winner?.signal ?? -1) ? item : winner),
        null,
      );
      return {
        ssid: network.ssid,
        signal: best?.signal ?? null,
        channel: best?.channel ?? null,
        band: best?.band ?? null,
        radio: best?.radio ?? null,
        auth: network.auth,
        utilization: best?.utilization ?? null,
        stations: best?.stations ?? null,
        bssidCount: network.bssids.length,
      };
    })
    .sort((a, b) => (b.signal ?? -1) - (a.signal ?? -1));
}

export function parsePing(text) {
  const times = [];
  const timeRe = /(?:time|tempo)\s*([<=])\s*(\d+)\s*ms/gi;
  let match = timeRe.exec(text);
  while (match) {
    times.push(match[1] === "<" ? 0 : Number(match[2]));
    match = timeRe.exec(text);
  }

  const sent = numberFrom(text, /(?:Sent|Enviados)\s*=\s*(\d+)/i);
  const received = numberFrom(text, /(?:Received|Recebidos)\s*=\s*(\d+)/i);
  const lossFromSummary = numberFrom(text, /(?:Lost|Perdidos)\s*=\s*\d+\s*\((\d+)\s*%/i);
  const sentCount = sent ?? times.length;
  const receivedCount = received ?? times.length;
  const loss =
    lossFromSummary ??
    (sentCount > 0 ? Math.round((1 - receivedCount / sentCount) * 100) : null);

  const avg = times.length
    ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length)
    : numberFrom(text, /(?:Average|M[eé]dia)\s*=\s*(\d+)/i);
  const min = times.length ? Math.min(...times) : numberFrom(text, /(?:Minimum|M[ií]nimo)\s*=\s*(\d+)/i);
  const max = times.length ? Math.max(...times) : numberFrom(text, /(?:Maximum|M[aá]ximo)\s*=\s*(\d+)/i);

  let jitter = null;
  if (times.length >= 2) {
    let drift = 0;
    for (let i = 1; i < times.length; i += 1) drift += Math.abs(times[i] - times[i - 1]);
    jitter = Math.round(drift / (times.length - 1));
  }

  return {
    avg,
    min,
    max,
    jitter,
    loss,
    sent: sentCount,
    received: receivedCount,
    samples: times,
  };
}

function utilizationPercent(value) {
  const explicit = String(value).match(/\((\d+)\s*%\)/);
  if (explicit) return Number(explicit[1]);
  const raw = numberOf(value);
  if (raw == null) return null;
  return Math.round((raw / 255) * 100);
}

function numberFrom(text, pattern) {
  const match = String(text).match(pattern);
  return match ? Number(match[1]) : null;
}

export function parseNetstatEstablished(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => /\bESTABLISHED\b|\bESTABELECID[AO]\b/i.test(line)).length;
}

export function isIpv4(value) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(value || ""))) return false;
  return String(value)
    .split(".")
    .every((part) => Number(part) <= 255);
}

export function linkSpeedToBps(text) {
  const match = String(text || "").match(/([\d.]+)\s*(Gbps|Mbps|Kbps|bps)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor = unit === "gbps" ? 1e9 : unit === "mbps" ? 1e6 : unit === "kbps" ? 1e3 : 1;
  return amount * factor;
}

export function isSideAdapter(adapter) {
  const name = String(adapter.name || "").toLowerCase();
  const description = String(adapter.description || "").toLowerCase();
  return (
    name.startsWith("vethernet") ||
    name.startsWith("local area connection") ||
    name.includes("wsl") ||
    description.includes("hyper-v") ||
    description.includes("bluetooth") ||
    description.includes("virtual")
  );
}

export function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
