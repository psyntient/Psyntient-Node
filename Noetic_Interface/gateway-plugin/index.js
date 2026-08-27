/**
 * Psyntient gateway plugin — the Noetic Interface's backend surface.
 *
 * WHY THIS EXISTS
 * WebClaw was a full-stack app: its own Node server could spawn
 * `daemon/*.mjs` as subprocesses to reach pairing/vault/onboarding. The
 * OpenClaw Control UI we forked for Path C is a *static SPA served by the
 * gateway* — there is no server of ours in the request path. This plugin is
 * that server: OpenClaw's plugin loader lets a plugin register real HTTP
 * routes on the gateway, and plugin code runs inside the gateway's own Node
 * process, so it can import the daemon modules directly. No subprocess
 * spawn, no second port, no CORS, and the SPA is same-origin with it.
 *
 * WHY IT LIVES OUTSIDE Cortex/Open-Claw/
 * Loaded via `plugins.load.paths`, which scans directories beyond the
 * built-in defaults. Keeping it under Noetic_Interface/ means it survives an
 * OpenClaw update/replace untouched — the same code/state separation rule
 * that governs everything else here (CLAUDE.md rule 2). Do not move this
 * into the OpenClaw tree.
 *
 * The daemon modules it calls are unchanged and already verified against the
 * real production API; this is a transport, not a reimplementation.
 *
 * ROUTE PREFIX IS NOT COSMETIC — /__openclaw__/ is required.
 * The gateway serves the Control UI SPA with a catch-all, so any ordinary
 * path (/psyntient/onboarding) is answered with index.html and the plugin
 * route is never consulted — silently, with no warning and no diagnostic.
 * Plugin HTTP routes are only reachable under the reserved /__openclaw__/
 * prefix; the bundled canvas plugin does the same (A2UI_PATH =
 * "/__openclaw__/a2ui"). Verified: that path returns 401 JSON while an
 * unprefixed one returns SPA HTML. Do not "tidy" this prefix away.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

// <NodeRoot>/Noetic_Interface/gateway-plugin/ -> <NodeRoot>/daemon/
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_DIR = path.resolve(PLUGIN_DIR, "..", "..", "daemon");
const daemonModule = (name) =>
  import(new URL(`file://${path.join(DAEMON_DIR, name)}`).href);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
  return true;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return {};
  }
}

/**
 * Wraps a handler so a thrown daemon error becomes a JSON 500 rather than an
 * unhandled rejection inside the gateway process. Every route returns the
 * same {ok:false,error} shape the Interface already knows how to render.
 */
function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export default {
  id: "psyntient",

  register(api) {
    // --- Onboarding gate state -------------------------------------------
    // GET  -> { hasProvider, isPaired, completed }
    // POST -> { action: "complete" }
    //
    // NOTE: getStatus() calls hasAnyProvider(), which shells out to the
    // OpenClaw CLI and costs ~10-15s of genuine work (measured, not
    // subprocess overhead). The Interface must cache this per session --
    // never call it on every page load.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/onboarding",
      auth: "gateway",
      handler: route(async (req, res) => {
        const onboarding = await daemonModule("onboarding.mjs");
        if (req.method === "GET") {
          return sendJson(res, 200, { ok: true, ...(await onboarding.getStatus()) });
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          if (body.action !== "complete") {
            return sendJson(res, 400, { ok: false, error: "unknown action" });
          }
          onboarding.markCompleted();
          return sendJson(res, 200, { ok: true, ...(await onboarding.getStatus()) });
        }
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }),
    });

    // --- Vault ------------------------------------------------------------
    // GET  -> storage mode + resolved path
    // POST -> { action: "set-local", path } | { action: "switch-cloud" }
    //
    // switchToCloud() deliberately throws an honest "not wired up yet" --
    // Google Drive OAuth does not exist in this repo. The 501 below surfaces
    // that truthfully rather than faking success (CLAUDE.md section 8).
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/vault",
      auth: "gateway",
      handler: route(async (req, res) => {
        const vault = await daemonModule("vault.mjs");
        if (req.method === "GET") {
          return sendJson(res, 200, { ok: true, ...vault.getStatus() });
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          if (body.action === "set-local") {
            const target = typeof body.path === "string" ? body.path.trim() : "";
            if (!target) return sendJson(res, 400, { ok: false, error: "path required" });
            vault.setLocalPath(target);
            return sendJson(res, 200, { ok: true, ...vault.getStatus() });
          }
          if (body.action === "switch-cloud") {
            try {
              vault.switchToCloud();
            } catch (err) {
              return sendJson(res, 501, {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            return sendJson(res, 200, { ok: true, ...vault.getStatus() });
          }
          return sendJson(res, 400, { ok: false, error: "unknown action" });
        }
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }),
    });

    // --- Pairing ----------------------------------------------------------
    // GET  -> { isPaired }              (cheap, local file read)
    // POST -> runs the real blocking pairStart() loopback flow
    //
    // Pairing is REQUIRED, never skippable: it will eventually gate
    // subscription status, so a Node that never paired could never be gated
    // on entitlement (CLAUDE.md section 7, policy reversal 2026-08-23).
    // Nothing here offers a way forward without it.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/pairing",
      auth: "gateway",
      handler: route(async (req, res) => {
        const pairing = await daemonModule("pairing.mjs");
        if (req.method === "GET") {
          const paired = pairing.isPaired();
          // Surface the node identity for the Settings > Psyntient Account
          // section. readNodeKey() reads ~/.psyntient/node.key; the token
          // itself is deliberately NOT returned -- only the identifiers a user
          // needs to recognise their own Node.
          let details = {};
          if (paired) {
            try {
              const key = pairing.readNodeKey() ?? {};
              details = {
                nodeId: key.node_id ?? null,
                contextId: key.context_id ?? null,
                pairedAt: key.paired_at ?? null,
              };
            } catch {
              /* identity is best-effort; pairing status is the contract */
            }
          }
          return sendJson(res, 200, { ok: true, isPaired: paired, ...details });
        }
        if (req.method === "POST") {
          if (pairing.isPaired()) {
            return sendJson(res, 200, { ok: true, isPaired: true, alreadyPaired: true });
          }
          await pairing.pairStart();
          return sendJson(res, 200, { ok: true, isPaired: pairing.isPaired() });
        }
        if (req.method === "DELETE") {
          // Explicit unpair. Destructive and not casually reversible: getting
          // paired again means a full browser round-trip through
          // psyntient.io/link-node (AUTH_FLOW.md). The Interface confirms
          // before calling this.
          pairing.unpair("user requested unpair from Settings");
          return sendJson(res, 200, { ok: true, isPaired: pairing.isPaired() });
        }
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }),
    });
  },
};
