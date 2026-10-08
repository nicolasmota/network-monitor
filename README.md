# Network monitor

A local dashboard for the network this PC is actually on. It watches Wi-Fi signal, traffic, and latency, then says whether the wait is in the house or farther out on the path to the internet.

It listens only on `127.0.0.1`. It does not change adapters, routes, or Wi-Fi settings.

## Run

Windows, with [Node.js](https://nodejs.org/) installed.

```bash
node server.js
```

Or double-click `abrir.bat`. The browser opens at [http://127.0.0.1:8787](http://127.0.0.1:8787). If that port is taken, the server tries the next one and prints the address.

```bash
node --test
```

## How to read a slow moment

The health score is a summary. The sentence under it is the part worth reading.

| What rose | Where the wait is |
| --- | --- |
| Router ping | At home: signal, a busy channel, or the router itself |
| Internet ping, while the router stays quick | On the provider or the route beyond the house |
| Channel use, or many neighbors on the same channel | In the air, even when the signal looks strong |
| Download filling most of the link | On this machine, because the pipe is already busy |

Router ping goes to the default gateway. Internet ping goes to `1.1.1.1`. DNS is the time to resolve `one.one.one.one`.

## The screen

**Signal.** Percent and RSSI from the connected Wi-Fi adapter. Under 60%, or near −80 dBm, the house already feels it.

**Traffic.** Download and upload on the adapter that carries the default route, sampled every 2 seconds. The session totals start when the server starts.

**Chart.** The last 15 minutes. The left axis is throughput. The right axis is internet latency, in milliseconds. Time runs along the bottom, labeled every 3 minutes. Hover a point for the exact sample. The legend under the chart stays put.

**Nearby networks.** A fresh scan of visible networks: channel, band, signal, and how much of the air is already in use.

**Apps.** Open TCP connections per program. That shows who is talking. It does not show which program is using the bandwidth. The Mbps figure is for the whole machine.

## Tests the dashboard sends

Each cycle pings the router and `1.1.1.1`, and resolves one DNS name. Those packets leave the machine. Everything else is read locally: adapter counters, the Wi-Fi interface, nearby networks, and established connections.
