/**
 * Serves the forked Control UI on the Interface port (3210) by reverse
 * proxying to the gateway (18789).
 *
 * WHY A PROXY AND NOT A REDIRECT
 * The installed PWA is welded to the origin it was installed from
 * (http://127.0.0.1:3210). You cannot repoint it at another origin: a
 * redirect navigates the user out of the PWA's scope, which browsers open in
 * a normal tab. The only way to put new content inside the existing install
 * is to make the old origin serve it. Proxying keeps everything same-origin,
 * so the gateway WebSocket, the Control UI's own /sw.js, and the Psyntient
 * plugin routes under /__openclaw__/ all work unchanged.
 *
 * Service worker takeover is clean and needs no special handling: the
 * Control UI ships its own /sw.js at the same path WebClaw's occupied, and
 * it calls skipWaiting() + clients.claim(), so the browser replaces the old
 * worker on the next load. Its cache name is keyed to the build id, unlike
 * WebClaw's static CACHE_NAME -- the bug that caused the ERR_FAILED stale
 * shell (CLAUDE.md section 7).
 *
 * This is a Stage 4 concern brought forward on request so the PWA can be
 * used for testing. Reverting = stop this, start interface-control.mjs.
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { psyntientHome } from "./psyntient-home.mjs";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = Number(process.env.NOETIC_PROXY_PORT ?? 3210);
const UPSTREAM_HOST = "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.NOETIC_UPSTREAM_PORT ?? 18789);
const PID_PATH = path.join(psyntientHome(), "interface-proxy.pid");

function upstreamDownPage(detail) {
  return `<!doctype html><meta charset="utf-8"><title>Psyntient — starting</title>
<style>html{background:#0C0A1D;color:#FEF4E3;font:16px/1.5 system-ui,sans-serif}
body{margin:0;display:grid;place-items:center;min-height:100vh}
.c{max-width:34rem;padding:2rem;text-align:center}
h1{font-weight:400;color:#EEBC4A;margin:0 0 .5rem}
code{color:#E3D6BE}</style>
<div class="c"><h1>Gateway not reachable</h1>
<p>The Noetic Interface is served through the gateway on port ${UPSTREAM_PORT},
which is not answering yet. This page refreshes automatically.</p>
<p><code>${detail}</code></p></div>
<script>setTimeout(()=>location.reload(),3000)</script>`;
}

const server = http.createServer((req, res) => {
  const proxyReq = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );
  proxyReq.on("error", (err) => {
    // Upstream down (e.g. gateway restarting) must not kill the proxy.
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
    res.end(upstreamDownPage(String(err?.message ?? err)));
  });
  req.pipe(proxyReq, { end: true });
});

// WebSocket (and any other) upgrades: raw socket splice to the gateway.
server.on("upgrade", (req, clientSocket, head) => {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const headerLines = Object.entries(req.headers)
      .map(([k, v]) =>
        Array.isArray(v) ? v.map((one) => `${k}: ${one}`).join("\r\n") : `${k}: ${v}`,
      )
      .join("\r\n");
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  const drop = () => {
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on("error", drop);
  clientSocket.on("error", drop);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  fs.mkdirSync(path.dirname(PID_PATH), { recursive: true });
  fs.writeFileSync(PID_PATH, String(process.pid));
  console.log(
    `noetic interface proxy: http://${LISTEN_HOST}:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      fs.unlinkSync(PID_PATH);
    } catch {
      /* already gone */
    }
    process.exit(0);
  });
}
