import assert from "node:assert/strict";
import test from "node:test";
import { interpret } from "../lib/interpret.js";
import { parsePing, parseWlanInterfaces, parseWlanNetworks } from "../lib/parse.js";

const INTERFACE = `
    Name                   : Wi-Fi
    Description            : MediaTek Wi-Fi 6E MT7922 160MHz Wireless LAN Card
    State                  : connected
    SSID                   : BLASTOISE 5.0
    AP BSSID               : f4:54:20:c6:a9:ae
    Band                   : 5 GHz
    Channel                : 161
    Radio type             : 802.11ac
    Authentication         : WPA2-Personal
    Receive rate (Mbps)    : 866.7
    Transmit rate (Mbps)   : 866.7
    Signal                 : 84%
    Rssi                   : -63
`;

test("reads the Wi-Fi interface from netsh", () => {
  const [wifi] = parseWlanInterfaces(INTERFACE);
  assert.equal(wifi.ssid, "BLASTOISE 5.0");
  assert.equal(wifi.connected, true);
  assert.equal(wifi.signal, 84);
  assert.equal(wifi.rssi, -63);
  assert.equal(wifi.channel, 161);
  assert.equal(wifi.band, "5 GHz");
  assert.equal(wifi.rxMbps, 866.7);
  assert.equal(wifi.bssid, "f4:54:20:c6:a9:ae");
});

test("reads ping output in English and Portuguese", () => {
  const english = parsePing(`
Reply from 1.1.1.1: bytes=32 time=14ms TTL=54
Reply from 1.1.1.1: bytes=32 time=22ms TTL=54
Reply from 1.1.1.1: bytes=32 time=40ms TTL=54
Packets: Sent = 3, Received = 3, Lost = 0 (0% loss),
Minimum = 14ms, Maximum = 40ms, Average = 25ms
`);
  assert.equal(english.avg, 25);
  assert.equal(english.min, 14);
  assert.equal(english.max, 40);
  assert.equal(english.loss, 0);
  assert.equal(english.jitter, 13);

  const portuguese = parsePing(`
Resposta de 192.168.0.1: bytes=32 tempo=2ms TTL=64
Resposta de 192.168.0.1: bytes=32 tempo<1ms TTL=64
Pacotes: Enviados = 2, Recebidos = 2, Perdidos = 0 (0% de perda),
`);
  assert.deepEqual(portuguese.samples, [2, 0]);
  assert.equal(portuguese.loss, 0);
});

test("groups nearby networks by the strongest signal", () => {
  const networks = parseWlanNetworks(`
SSID 1 : Casa
    Authentication          : WPA2-Personal
    BSSID 1                 : aa:aa:aa:aa:aa:aa
         Signal             : 40%
         Channel            : 6
         Band               : 2.4 GHz
    BSSID 2                 : bb:bb:bb:bb:bb:bb
         Signal             : 70%
         Channel            : 11
         Band               : 2.4 GHz
         Connected Stations:         3
         Channel Utilization:        19 (7 %)
SSID 2 : Vizinho
    Authentication          : WPA2-Personal
    BSSID 1                 : cc:cc:cc:cc:cc:cc
         Signal             : 55%
         Channel            : 6
`);
  assert.equal(networks[0].ssid, "Casa");
  assert.equal(networks[0].signal, 70);
  assert.equal(networks[0].channel, 11);
  assert.equal(networks[0].bssidCount, 2);
  assert.equal(networks[0].utilization, 7);
  assert.equal(networks[0].stations, 3);
  assert.equal(networks[1].ssid, "Vizinho");
});

test("points at the provider when the home network is fast", () => {
  const reading = interpret({
    probesReady: true,
    ethernetUp: false,
    downBps: 1000,
    linkBps: 866e6,
    wifi: { available: true, connected: true, signal: 90, rssi: -55, channel: 36, ssid: "Casa" },
    latency: {
      gateway: { avg: 2, loss: 0, jitter: 1 },
      internet: { avg: 180, loss: 0, jitter: 4 },
      dns: { ok: true, ms: 20 },
    },
    nearby: [],
  });
  assert.equal(reading.health.label, "Unstable");
  assert.match(reading.diagnosis[0], /path to the internet/);
});
