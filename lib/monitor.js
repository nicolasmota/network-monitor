import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { interpret } from "./interpret.js";
import {
  asArray,
  isIpv4,
  isSideAdapter,
  linkSpeedToBps,
  parsePing,
  parseWlanInterfaces,
  parseWlanNetworks,
} from "./parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTERNET_HOST = "1.1.1.1";
const DNS_HOST = "one.one.one.one";
const HISTORY_LIMIT = 450;

function run(command, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout, windowsHide: true, encoding: "utf8", maxBuffer: 4_000_000 },
      (error, stdout) => {
        if (stdout) resolve(stdout);
        else reject(error || new Error(`${command} returned no output`));
      },
    );
  });
}

function readJson(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, "").trim());
}

function blankProbe(host) {
  return {
    host,
    avg: null,
    min: null,
    max: null,
    jitter: null,
    loss: null,
    sent: 0,
    received: 0,
    updatedAt: null,
  };
}

export function startMonitor() {
  const state = {
    startedAt: new Date().toISOString(),
    fastUpdatedAt: null,
    probeUpdatedAt: null,
    nearbyUpdatedAt: null,
    processUpdatedAt: null,
    error: null,
    gateway: null,
    gatewayInterface: null,
    wifi: { available: false, connected: false },
    adapters: [],
    latency: {
      gateway: blankProbe(null),
      internet: blankProbe(INTERNET_HOST),
      dns: { host: DNS_HOST, ms: null, ok: null },
    },
    probesReady: false,
    nearby: [],
    connections: { established: null, top: [] },
    history: [],
    baselines: new Map(),
    previous: new Map(),
  };

  let fastBusy = false;
  let probeBusy = false;
  let nearbyBusy = false;
  let processBusy = false;

  async function tickFast() {
    if (fastBusy) return;
    fastBusy = true;
    try {
      const [wifiText, sysText] = await Promise.all([
        run("netsh", ["wlan", "show", "interfaces"], 8000),
        run(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-File", path.join(__dirname, "collect.ps1")],
          15000,
        ),
      ]);
      const sys = readJson(sysText);
      applyFastSample(state, parseWlanInterfaces(wifiText), sys);
      state.fastUpdatedAt = new Date().toISOString();
      state.error = null;
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      fastBusy = false;
    }
  }

  async function tickProbes() {
    if (probeBusy) return;
    probeBusy = true;
    try {
      const gatewayHost = isIpv4(state.gateway) ? state.gateway : null;
      const [internetText, gatewayText, dnsResult] = await Promise.all([
        run("ping", ["-n", "3", "-w", "800", INTERNET_HOST], 8000).catch(() => ""),
        gatewayHost
          ? run("ping", ["-n", "3", "-w", "800", gatewayHost], 8000).catch(() => "")
          : Promise.resolve(""),
        timeDns(),
      ]);
      state.latency.internet = { host: INTERNET_HOST, ...parsePing(internetText), updatedAt: new Date().toISOString() };
      if (gatewayHost) {
        state.latency.gateway = {
          host: gatewayHost,
          ...parsePing(gatewayText),
          updatedAt: new Date().toISOString(),
        };
      }
      state.latency.dns = dnsResult;
      state.probeUpdatedAt = new Date().toISOString();
      state.probesReady = true;
      const last = state.history.at(-1);
      if (last) last.internetMs = state.latency.internet.avg;
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      probeBusy = false;
    }
  }

  async function tickNearby() {
    if (nearbyBusy) return;
    nearbyBusy = true;
    try {
      await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-File", path.join(__dirname, "scan.ps1")],
        8000,
      ).catch(() => "");
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const text = await run("netsh", ["wlan", "show", "networks", "mode=bssid"], 20000);
      state.nearby = parseWlanNetworks(text).slice(0, 12);
      state.nearbyUpdatedAt = new Date().toISOString();
    } catch {
      // The scan is extra. The main reading continues without it.
    } finally {
      nearbyBusy = false;
    }
  }

  async function tickProcesses() {
    if (processBusy) return;
    processBusy = true;
    try {
      const text = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-File", path.join(__dirname, "processes.ps1")],
        20000,
      );
      const parsed = readJson(text);
      state.connections = {
        established: Number(parsed.established) || 0,
        top: asArray(parsed.top).map((item) => ({
          pid: item.pid,
          name: item.name,
          count: item.count,
        })),
      };
      state.processUpdatedAt = new Date().toISOString();
    } catch {
      // The app list is extra.
    } finally {
      processBusy = false;
    }
  }

  const boot = tickFast().finally(() => {
    tickProbes();
    tickNearby();
    tickProcesses();
  });
  const timers = [
    setInterval(tickFast, 2000),
    setInterval(tickProbes, 8000),
    setInterval(tickNearby, 30000),
    setInterval(tickProcesses, 20000),
  ];

  return {
    ready: boot,
    snapshot() {
      return publicSnapshot(state);
    },
    stop() {
      for (const timer of timers) clearInterval(timer);
    },
  };
}

async function timeDns() {
  const start = performance.now();
  try {
    await dns.lookup(DNS_HOST, { family: 4 });
    return { host: DNS_HOST, ms: Math.round(performance.now() - start), ok: true };
  } catch {
    return { host: DNS_HOST, ms: null, ok: false };
  }
}

function applyFastSample(state, interfaces, sys) {
  const now = Date.now();
  state.gateway = sys.gateway || null;
  state.gatewayInterface = sys.gatewayInterface || null;

  const ips = new Map(asArray(sys.ips).map((item) => [item.interface, item]));
  const adapters = asArray(sys.adapters).map((adapter) => {
    const received = Number(adapter.receivedBytes) || 0;
    const sent = Number(adapter.sentBytes) || 0;
    const prev = state.previous.get(adapter.name);
    let downBps = null;
    let upBps = null;
    if (prev) {
      const dt = (now - prev.at) / 1000;
      if (dt >= 0.5 && dt <= 15 && received >= prev.received && sent >= prev.sent) {
        downBps = (received - prev.received) / dt;
        upBps = (sent - prev.sent) / dt;
      }
    }
    state.previous.set(adapter.name, { at: now, received, sent });

    let baseline = state.baselines.get(adapter.name);
    if (!baseline || received < baseline.received || sent < baseline.sent) {
      baseline = { received, sent };
      state.baselines.set(adapter.name, baseline);
    }

    const ip = ips.get(adapter.name);
    return {
      name: adapter.name,
      description: adapter.description,
      status: adapter.status,
      linkSpeed: adapter.linkSpeed,
      linkBps: linkSpeedToBps(adapter.linkSpeed),
      mac: adapter.mac,
      ip: ip && !String(ip.ip).startsWith("169.254.") ? ip.ip : null,
      prefix: ip ? ip.prefix : null,
      downBps,
      upBps,
      sessionDown: Math.max(0, received - baseline.received),
      sessionUp: Math.max(0, sent - baseline.sent),
      side: isSideAdapter(adapter),
      primary: adapter.name === state.gatewayInterface,
    };
  });

  state.adapters = adapters.filter(
    (adapter) =>
      adapter.primary ||
      adapter.status === "Up" ||
      (!adapter.side && /ethernet|wi-?fi|wlan/i.test(adapter.name)),
  );

  const primary =
    adapters.find((adapter) => adapter.primary) ||
    adapters.find((adapter) => adapter.status === "Up" && !adapter.side) ||
    null;
  const wifi = interfaces.find((item) => item.connected) || interfaces[0] || null;
  state.wifi = wifi
    ? { available: true, ...wifi }
    : { available: false, connected: false };

  const sample = {
    t: now,
    downBps: primary?.downBps ?? null,
    upBps: primary?.upBps ?? null,
    internetMs: state.latency.internet.avg,
    signal: state.wifi.signal ?? null,
  };
  state.history.push(sample);
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
}

function publicSnapshot(state) {
  const primary = state.adapters.find((adapter) => adapter.primary) || null;
  const ethernetUp = state.adapters.some(
    (adapter) => adapter.status === "Up" && !adapter.side && !/wi-?fi|wlan/i.test(adapter.name),
  );
  const view = {
    wifi: state.wifi,
    latency: state.latency,
    nearby: state.nearby,
    probesReady: state.probesReady,
    ethernetUp,
    downBps: primary?.downBps ?? null,
    linkBps: primary?.linkBps ?? null,
  };
  const reading = interpret(view);

  return {
    ok: !state.error,
    error: state.error,
    startedAt: state.startedAt,
    updatedAt: state.fastUpdatedAt,
    probeUpdatedAt: state.probeUpdatedAt,
    nearbyUpdatedAt: state.nearbyUpdatedAt,
    processUpdatedAt: state.processUpdatedAt,
    gateway: state.gateway,
    health: reading.health,
    diagnosis: reading.diagnosis,
    wifi: state.wifi,
    latency: state.latency,
    traffic: {
      interface: primary?.name ?? null,
      downBps: primary?.downBps ?? null,
      upBps: primary?.upBps ?? null,
      sessionDown: primary?.sessionDown ?? 0,
      sessionUp: primary?.sessionUp ?? 0,
      linkSpeed: primary?.linkSpeed ?? null,
      ip: primary?.ip ?? null,
    },
    adapters: state.adapters,
    connections: state.connections,
    nearby: state.nearby,
    history: state.history,
  };
}
