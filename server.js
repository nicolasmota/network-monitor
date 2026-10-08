import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMonitor } from "./lib/monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const startPort = Number(process.env.PORT) || 8787;
const monitor = startMonitor();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function handler(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/state") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(monitor.snapshot()));
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname);
  const relative = path.normalize(requested).replace(/^([/\\])+/, "");
  const full = path.resolve(publicDir, relative);
  if (full !== publicDir && !full.startsWith(publicDir + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(full, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const type = types[path.extname(full)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

function listen(port, attemptsLeft) {
  const server = http.createServer(handler);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(error);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const address = `http://127.0.0.1:${port}`;
    console.log(`Network monitor at ${address}`);
    if (!process.env.NO_OPEN) {
      execFile("cmd", ["/c", "start", "", address], { windowsHide: true }, () => {});
    }
  });
}

listen(startPort, 10);
