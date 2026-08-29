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
import { Type } from "typebox";
// definePluginEntry, not a bare object literal. docs.openclaw.ai/plugins/
// sdk-entrypoints: "Every plugin exports a default entry object. The SDK
// provides a helper for each entry shape" -- a plain { id, register } loads
// far enough to run register() and mount HTTP routes, so it looks fine, but
// its registerTool() calls never propagate to the agent's toolset. That is the
// symptom in openclaw#61790 / #50328 / #47683, all closed without a fix
// because the entry shape was unsupported rather than the loader broken.
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

// <NodeRoot>/Noetic_Interface/gateway-plugin/ -> <NodeRoot>/daemon/
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_DIR = path.resolve(PLUGIN_DIR, "..", "..", "daemon");
const daemonModule = (name) =>
  import(new URL(`file://${path.join(DAEMON_DIR, name)}`).href);

/** The Default Project: the Node's #general. Reserved, cannot be removed. */
const DEFAULT_PROJECT_ID = "default";

/** Project ids double as session category strings, so keep them filesystem-safe. */
function slugifyProjectId(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Removes a project's Vault copy. Only reached by an explicit "delete
 * permanently"; every other path leaves the Vault record intact, because per
 * CLAUDE.md section 9 the Vault copy is the durable artefact and the working
 * copy is the disposable one.
 */
function deleteVaultProject(projectId) {
  try {
    const vault = JSON.parse(
      fs.readFileSync(
        path.join(PLUGIN_DIR, "..", "..", "Neural_Vault", "vault.config.json"),
        "utf8",
      ),
    );
    const root = vault?.localPath
      ? vault.localPath
      : path.join(PLUGIN_DIR, "..", "..", "Neural_Vault", "local");
    const device = os.hostname();
    fs.rmSync(path.join(root, "Devices", device, projectId), { recursive: true, force: true });
  } catch {
    // Best effort: the working copy is already gone, and a missing Vault copy
    // is the desired end state anyway.
  }
}

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

export default definePluginEntry({
  id: "psyntient",

  register(api) {
    // --- Cortex's Archive tools ------------------------------------------
    // Four intent-shaped tools rather than the API's ten REST routes.
    // Handing a model raw endpoints makes it do query planning across an HTTP
    // API, which is what models are worst at, and costs a turn per hop.
    //
    // `parameters` is hand-written JSON Schema, not TypeBox. Core treats it as
    // a plain Record and normalizes it as JSON Schema (agent-tools.schema.ts);
    // Value.Check only appears in tests. That matters because this plugin
    // lives outside the OpenClaw tree and cannot resolve typebox.
    //
    // Design and rationale: ARCHIVE_INTEGRATION.md.
    const archiveTool = (definition) => api.registerTool(definition, { name: definition.name });
    const text = (value) => ({
      content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
      details: typeof value === "string" ? {} : value,
    });

    archiveTool({
      name: "archive_map",
      label: "Archive map",
      description:
        "Orient in the Noetic Archive: the current Edition and the full archetype index (id, name, description, how many exemplars support it). Call this first -- archetypes are the Archive's primary semantic objects and the index is small and stable, so it is cheaper than searching blind.",
      // No parameters. Deliberately no `additionalProperties` and no empty
      // `properties` map: Gemini's function declarations reject the former and
      // choke on the latter, which surfaces only as "Provider finish_reason:
      // error" with no hint that a tool schema was the cause.
      parameters: Type.Object({}),
      execute: async () => {
        const archive = await daemonModule("archive-client.mjs");
        return text(await archive.getMap());
      },
    });

    archiveTool({
      name: "archive_search",
      label: "Search the Archive",
      description:
        "Search the Noetic Archive in plain language. Returns matching archetypes and packets with their ids. Use archive_get for the full record of anything worth reading closely.",
      parameters: Type.Object({
        query: Type.String({ description: "Plain-language description of what to look for." }),
      }),
      execute: async (_toolCallId, params) => {
        const archive = await daemonModule("archive-client.mjs");
        return text(await archive.search(String(params?.query ?? "")));
      },
    });

    archiveTool({
      name: "archive_get",
      label: "Read an Archive record",
      description:
        "Fetch one full Archive record by id -- an archetype (e.g. NA-0012-grand-vastness-awe) or a packet. You do not need to know which kind it is.",
      parameters: Type.Object({
        id: Type.String({ description: "Archetype or packet id." }),
      }),
      execute: async (_toolCallId, params) => {
        const archive = await daemonModule("archive-client.mjs");
        return text(await archive.getRecord(String(params?.id ?? "")));
      },
    });

    archiveTool({
      name: "archive_pin",
      label: "Pin Archive records to a project",
      description:
        "Record Archive records into a project as citations, with the Edition they came from. Do this whenever an analysis or a claim rests on Archive material: the Node does not keep a copy of the Archive, and the Archive is append-only with revocable consent, so re-running the same query later is not guaranteed to return the same thing.",
      parameters: Type.Object({
        projectId: Type.String({ description: "Project to cite into, e.g. thesis-chapter-3." }),
        ids: Type.Array(Type.String(), {
          description: "Archetype or packet ids the analysis actually used.",
        }),
        query: Type.Optional(
          Type.String({ description: "The question these records were found for." }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        const archive = await daemonModule("archive-client.mjs");
        const wm = await daemonModule("working-memory.mjs");
        const ids = Array.isArray(params?.ids) ? params.ids.map(String) : [];
        if (ids.length === 0) {
          return text("No ids given, so nothing was pinned.");
        }
        // Fetch the records rather than trusting ids the model may have
        // mistyped: a citation to a record that does not exist is worse than
        // no citation, because it reads as verified.
        const records = await Promise.all(ids.map((id) => archive.getRecord(id)));
        const { edition } = await archive.getMap();
        const result = wm.pinCitation(String(params.projectId), {
          edition,
          query: params?.query ? String(params.query) : null,
          records,
        });
        return text(result);
      },
    });

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

    // --- Provider key -----------------------------------------------------
    // GET  -> { providers, hasProvider }
    // POST -> { providerId, apiKey }  saves, then a REAL connection test
    //
    // Same setProviderKey() the CLI uses -- one implementation, per CLAUDE.md.
    // The test is a genuine isolated inference call (daemon/provider-test.mjs),
    // not a fake chat message: a key that saves but cannot talk is worse than
    // no key, because the failure surfaces later as a broken chat.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/provider-key",
      auth: "gateway",
      handler: route(async (req, res) => {
        const providers = await daemonModule("providers.mjs");
        if (req.method === "GET") {
          return sendJson(res, 200, {
            ok: true,
            providers: providers.SUPPORTED_PROVIDERS,
            hasProvider: await providers.hasAnyProvider(),
          });
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
          const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
          if (!providerId || !apiKey) {
            return sendJson(res, 400, { ok: false, error: "providerId and apiKey required" });
          }
          await providers.setProviderKey(providerId, apiKey);
          const tester = await daemonModule("provider-test.mjs");
          const result = await tester.testProviderConnection(providerId);
          return sendJson(res, 200, { ok: true, tested: result });
        }
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }),
    });

    // --- Vault ledger ------------------------------------------------------
    // GET -> the indexed contents of the active Vault.
    //
    // Distinct from /psyntient/vault, which is storage CONFIG (mode, path,
    // provider). This is what the Vault actually holds: projects, declared
    // data types, packet counts, and what the Archive would accept.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/vault-ledger",
      auth: "gateway",
      handler: route(async (req, res) => {
        if (req.method !== "GET") {
          return sendJson(res, 405, { ok: false, error: "method not allowed" });
        }
        try {
          const ledger = await daemonModule("vault-ledger.mjs");
          const sync = await daemonModule("archive-sync.mjs");
          const settings = sync.readSettings();
          const data = await ledger.readLedger();
          return sendJson(res, 200, {
            ok: true,
            ...data,
            autoSyncAll: settings.autoSyncAll,
            projects: data.projects.map((p) => ({
              ...p,
              // Resolved here rather than in the page: the tri-state rule
              // (explicit choice beats the Node default) lives in one place.
              autoSyncEffective: sync.resolveAutoSync(p, settings),
            })),
          });
        } catch (err) {
          // An unconfigured or relocated Vault is a normal local state, not a
          // server fault -- render an explanation rather than a stack.
          return sendJson(res, 200, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    });

    // --- Vault semantic search --------------------------------------------
    // GET ?query=<text>  -> Server-Sent Events: stage updates, then a result.
    //
    // Same stream shape as the Archive search for the same reason: the match
    // step is a real model call taking tens of seconds, and a request held
    // open that long with nothing on the wire is indistinguishable from a
    // hang. The corpus differs -- this searches the researcher's own Vault --
    // but nothing about the transport does.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/vault/search",
      auth: "gateway",
      handler: route(async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const query = url.searchParams.get("query") ?? "";
        if (!query.trim()) {
          return sendJson(res, 400, { ok: false, error: "query required" });
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const send = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 5_000);

        try {
          const search = await daemonModule("vault-search.mjs");
          const result = await search.semanticSearch(query, {
            onStage: (stage) => send("stage", stage),
          });
          send("result", result);
        } catch (err) {
          send("result", {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          clearInterval(keepAlive);
          res.end();
        }
      }),
    });

    // --- Vault project detail ----------------------------------------------
    // GET ?project=<id>[&device=<name>]  -> one project's actual contents.
    //
    // Separate from the ledger on purpose. The ledger is summary-first and
    // caps its per-file sample, because a Vault holding years of capture has
    // far more files than any list shows and shipping all of them to every
    // caller would make the index more expensive than the walk it replaces.
    // Detail is therefore pulled for one project at a time, when opened.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/vault/project",
      auth: "gateway",
      handler: route(async (req, res) => {
        if (req.method !== "GET") {
          return sendJson(res, 405, { ok: false, error: "method not allowed" });
        }
        const url = new URL(req.url, "http://localhost");
        const projectId = url.searchParams.get("project");
        const device = url.searchParams.get("device");
        if (!projectId) {
          return sendJson(res, 400, { ok: false, error: "project required" });
        }
        try {
          const detail = await daemonModule("vault-project.mjs");
          return sendJson(res, 200, await detail.readProject(projectId, { device }));
        } catch (err) {
          return sendJson(res, 200, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    });

    // --- Vault file contents -----------------------------------------------
    // GET ?project=<id>&path=<area/relative/path>[&device=<name>]
    //
    // One file at a time, and described rather than dumped: a real capture is
    // tens of thousands of samples, and neither a browser nor a model is
    // served by receiving them. The daemon reduces a recording to its shape
    // (channels, counts, range) and returns text files whole.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/vault/file",
      auth: "gateway",
      handler: route(async (req, res) => {
        if (req.method !== "GET") {
          return sendJson(res, 405, { ok: false, error: "method not allowed" });
        }
        const url = new URL(req.url, "http://localhost");
        const projectId = url.searchParams.get("project");
        const filePath = url.searchParams.get("path");
        if (!projectId || !filePath) {
          return sendJson(res, 400, { ok: false, error: "project and path required" });
        }
        try {
          const detail = await daemonModule("vault-project.mjs");
          return sendJson(
            res,
            200,
            await detail.readFile(projectId, filePath, { device: url.searchParams.get("device") }),
          );
        } catch (err) {
          return sendJson(res, 200, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    });

    // --- Vault file download -----------------------------------------------
    // GET ?project=<id>&path=<area/relative/path>[&device=<name>]  -> the bytes
    //
    // Separate from /vault/file, which DESCRIBES a file: this hands over the
    // real thing so a researcher can open their own data in their own tools.
    // Path containment is enforced by vault-storage.mjs's provider, which
    // refuses to resolve outside the Vault root -- this route must never grow
    // its own path handling.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/vault/download",
      auth: "gateway",
      handler: route(async (req, res) => {
        if (req.method !== "GET") {
          return sendJson(res, 405, { ok: false, error: "method not allowed" });
        }
        const url = new URL(req.url, "http://localhost");
        const projectId = url.searchParams.get("project");
        const filePath = url.searchParams.get("path");
        if (!projectId || !filePath) {
          return sendJson(res, 400, { ok: false, error: "project and path required" });
        }
        try {
          const detail = await daemonModule("vault-project.mjs");
          const file = await detail.readRaw(projectId, filePath, {
            device: url.searchParams.get("device"),
          });
          if (!file.ok) return sendJson(res, 404, file);
          res.writeHead(200, {
            "Content-Type": file.contentType,
            "Content-Length": file.bytes.length,
            // Downloads only; never rendered inline in the app's own origin.
            "Content-Disposition": `attachment; filename="${file.name}"`,
          });
          return res.end(file.bytes);
        } catch (err) {
          return sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    });

    // --- Self-update --------------------------------------------------------
    // GET                    -> what an update would do (and the auto toggle)
    // POST {action:"apply"}  -> Server-Sent Events: progress, then a result
    // POST {action:"auto", enabled}
    //
    // Apply is streamed for the same reason the Archive search is: a `full`
    // build takes about twenty minutes, and a request held open that long with
    // nothing on the wire is indistinguishable from a hang.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/update",
      auth: "gateway",
      handler: route(async (req, res) => {
        const updater = await daemonModule("updater.mjs");

        if (req.method === "GET") {
          try {
            const status = await updater.check();
            return sendJson(res, 200, { ...status, state: updater.readState() });
          } catch (err) {
            // No network, no remote, a detached HEAD -- all normal local
            // states for an app that may be offline, not server faults.
            return sendJson(res, 200, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (req.method !== "POST") {
          return sendJson(res, 405, { ok: false, error: "method not allowed" });
        }

        const body = await readJsonBody(req);
        if (body.action === "auto") {
          return sendJson(res, 200, { ok: true, ...updater.setAutoUpdate(body.enabled === true) });
        }
        if (body.action !== "apply") {
          return sendJson(res, 400, { ok: false, error: "unknown action" });
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const send = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 5_000);

        try {
          const result = await updater.apply({
            force: body.force === true,
            onProgress: (stage) => send("stage", stage),
          });
          send("result", result);
        } catch (err) {
          send("result", { ok: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
          clearInterval(keepAlive);
          res.end();
        }
      }),
    });

    // --- Archive semantic search ------------------------------------------
    // GET ?query=<text>  -> Server-Sent Events: stage updates, then a result.
    //
    // Streamed rather than a blocking request because the match step is a real
    // model call taking tens of seconds. The client needs to show what is
    // happening during it, and a request held open that long with nothing on
    // the wire looks indistinguishable from a hang.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/archive/search",
      auth: "gateway",
      handler: route(async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        const query = url.searchParams.get("query") ?? "";
        if (!query.trim()) {
          return sendJson(res, 400, { ok: false, error: "query required" });
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          // The Interface is same-origin, but a proxy in front would otherwise
          // buffer the whole stream and defeat the point of streaming it.
          "X-Accel-Buffering": "no",
        });
        const send = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        // Keeps intermediaries from closing an idle connection during the long
        // model call, and gives the client a heartbeat to animate against.
        const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 5_000);

        try {
          const search = await daemonModule("archive-search.mjs");
          const result = await search.semanticSearch(query, {
            onStage: (stage) => send("stage", stage),
          });
          send("result", result);
        } catch (err) {
          send("result", {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          clearInterval(keepAlive);
          res.end();
        }
      }),
    });

    // --- Archive read -----------------------------------------------------
    // GET                -> Edition manifest + archetype index (the map)
    // GET ?query=<text>  -> search
    // GET ?id=<id>       -> one full record
    //
    // Thin pass-through to daemon/archive-client.mjs. The token lives in
    // ~/.psyntient/node.key at mode 600 and must never reach a browser, so the
    // viewer talks to this route and the daemon holds the credential.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/archive",
      auth: "gateway",
      handler: route(async (req, res) => {
        if (req.method !== "GET") {
          return sendJson(res, 405, { ok: false, error: "method not allowed" });
        }
        const archive = await daemonModule("archive-client.mjs");
        const url = new URL(req.url, "http://localhost");
        const id = url.searchParams.get("id");
        const query = url.searchParams.get("query");
        try {
          if (id) return sendJson(res, 200, { ok: true, ...(await archive.getRecord(id)) });
          if (query) return sendJson(res, 200, { ok: true, ...(await archive.search(query)) });
          return sendJson(res, 200, { ok: true, ...(await archive.getMap()) });
        } catch (err) {
          // Unreachable Archive, unpaired Node and revoked token are all normal
          // states for a local-first app, not server faults. 200 with an error
          // field lets the viewer render an explanation instead of a stack.
          return sendJson(res, 200, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    });

    // --- Archive sync -----------------------------------------------------
    // GET  -> { autoSyncAll, projects: [...], active }
    // POST -> { action:"set-global", enabled }
    //         { action:"set-project", projectId, enabled }   enabled null = inherit
    //         { action:"run", projectId }                    starts, returns immediately
    //
    // A run is started and then polled rather than awaited: submitting a
    // backlog can take minutes, and holding an HTTP request open for it gives
    // the UI nothing to show and dies on the first proxy timeout. Progress
    // lives in `activeRun` here in the gateway process, which is the same
    // process doing the work.
    let activeRun = null;

    const vaultProjectDir = async (projectId) => {
      const vault = await daemonModule("vault.mjs");
      const device = await daemonModule("device-name.mjs");
      return path.join(vault.getVaultRoot(), "Devices", device.deviceName(), projectId);
    };

    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/sync",
      auth: "gateway",
      handler: route(async (req, res) => {
        const sync = await daemonModule("archive-sync.mjs");

        if (req.method === "GET") {
          const ledger = await daemonModule("vault-ledger.mjs");
          const settings = sync.readSettings();
          const projects = (await ledger.readLedger()).projects.map((p) => ({
            projectId: p.projectId,
            title: p.title,
            dataTypes: p.dataTypes,
            eligible: p.declaredEligible,
            contributable: p.contributable,
            packets: p.sessions.packets,
            // Both the explicit choice and what it resolves to: the UI has to
            // show "inheriting on" differently from "explicitly on", or the
            // global toggle looks like it did nothing.
            autoSync: p.autoSync ?? null,
            autoSyncEffective: sync.resolveAutoSync(p, settings),
          }));
          return sendJson(res, 200, { ok: true, ...settings, projects, active: activeRun });
        }

        if (req.method === "POST") {
          const body = await readJsonBody(req);
          if (body.action === "set-global") {
            return sendJson(res, 200, {
              ok: true,
              ...sync.writeSettings({ autoSyncAll: body.enabled === true }),
            });
          }
          if (body.action === "set-project") {
            const dir = await vaultProjectDir(String(body.projectId ?? ""));
            const enabled = body.enabled === null || body.enabled === undefined ? null : body.enabled === true;
            return sendJson(res, 200, { ok: true, ...sync.setProjectAutoSync(dir, enabled) });
          }
          if (body.action === "run") {
            if (activeRun && !activeRun.done) {
              return sendJson(res, 409, { ok: false, error: "A sync is already running." });
            }
            const projectId = String(body.projectId ?? "");
            const dir = await vaultProjectDir(projectId);
            activeRun = { projectId, index: 0, total: 0, done: false, result: null, error: null };
            // Fire-and-forget on purpose; the client polls GET for progress.
            void sync
              .syncProject(dir, {
                onProgress: (p) => {
                  activeRun.index = p.index + 1;
                  activeRun.total = p.total;
                  activeRun.sessionId = p.sessionId;
                },
              })
              .then((result) => {
                activeRun = { ...activeRun, done: true, result };
              })
              .catch((err) => {
                activeRun = {
                  ...activeRun,
                  done: true,
                  error: err instanceof Error ? err.message : String(err),
                };
              });
            return sendJson(res, 202, { ok: true, started: projectId });
          }
          return sendJson(res, 400, { ok: false, error: "unknown action" });
        }
        return sendJson(res, 405, { ok: false, error: "method not allowed" });
      }),
    });

    // --- Projects ---------------------------------------------------------
    // GET  -> { projects: [{projectId,title,createdAt,lastSyncedAt}], defaultId }
    // POST -> { title }                       create
    //         { action:"archive", projectId }  sync to Vault, erase working copy
    //         { action:"remove",  projectId }  erase working copy, KEEP the Vault
    //         { action:"delete",  projectId }  erase working copy AND Vault copy
    //
    // This finally gives daemon/working-memory.mjs's project lifecycle its
    // first caller -- it has been built and CLI-tested since Phase I with no
    // UI behind it.
    //
    // A Project's id is also the session `category` string. One identifier,
    // two representations; there is deliberately no mapping table.
    api.registerHttpRoute({
      path: "/__openclaw__/psyntient/projects",
      auth: "gateway",
      handler: route(async (req, res) => {
        const wm = await daemonModule("working-memory.mjs");

        // The Default Project is the Node's #general: casual chat and ideas
        // still get a Vault record. Created through the same createProject()
        // as everything else -- no special-cased second path. Threads with no
        // category RESOLVE to it rather than being migrated, so existing
        // threads stay reachable without a rewrite.
        const ensureDefault = () => {
          if (!wm.listProjects().some((p) => p.projectId === DEFAULT_PROJECT_ID)) {
            wm.createProject({ projectId: DEFAULT_PROJECT_ID, title: "General", dataTypes: ["none"] });
          }
        };

        if (req.method === "GET") {
          ensureDefault();
          return sendJson(res, 200, {
            ok: true,
            projects: wm.listProjects(),
            defaultId: DEFAULT_PROJECT_ID,
            // The creation form renders from this rather than a hardcoded copy,
            // so the vocabulary has exactly one definition (working-memory.mjs).
            dataTypes: wm.DATA_TYPES,
          });
        }

        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const action = typeof body.action === "string" ? body.action : "create";
          const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";

          if (action === "create") {
            const title = typeof body.title === "string" ? body.title.trim() : "";
            if (!title) return sendJson(res, 400, { ok: false, error: "title required" });
            const id = slugifyProjectId(title);
            if (!id) return sendJson(res, 400, { ok: false, error: "title has no usable characters" });
            // Data types are required, and createProject validates them against
            // the closed vocabulary before creating anything -- a rejected
            // project must not leave a half-scaffolded directory behind.
            try {
              const project = wm.createProject({ projectId: id, title, dataTypes: body.dataTypes });
              return sendJson(res, 200, {
                ok: true,
                project: { projectId: id, title, ...project },
              });
            } catch (err) {
              return sendJson(res, 400, {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (!projectId) return sendJson(res, 400, { ok: false, error: "projectId required" });
          if (projectId === DEFAULT_PROJECT_ID && action !== "archive") {
            // The Default Project is where unfiled threads live; removing it
            // would strand them.
            return sendJson(res, 400, { ok: false, error: "the default project cannot be removed" });
          }

          if (action === "archive") {
            wm.syncProjectToVault(projectId);
            wm.eraseProjectWorkingCopy(projectId);
            return sendJson(res, 200, { ok: true, archived: projectId });
          }

          if (action === "remove") {
            // eraseProjectWorkingCopy() refuses unless a real sync has happened
            // (it checks .project.json's lastSyncedAt, which only
            // syncProjectToVault sets). Here the Vault copy IS the safety net
            // that makes "remove" recoverable, so an unsynced project has no
            // net -- surface the refusal as a prompt to sync, not a raw error.
            try {
              wm.eraseProjectWorkingCopy(projectId);
            } catch (err) {
              return sendJson(res, 409, {
                ok: false,
                needsSync: true,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            return sendJson(res, 200, { ok: true, removed: projectId });
          }

          if (action === "delete") {
            // Deliberately NOT routed through eraseProjectWorkingCopy(): its
            // sync guard exists to keep a Vault copy as the recovery path, and
            // this action deletes that copy too. Honouring it here would answer
            // "delete everything permanently" with "save it to the Vault
            // first" -- the opposite of what was asked, and it would leave the
            // Vault copy behind. The UI's typed-name confirmation is the gate.
            fs.rmSync(path.join(wm.paths.CORTEX_PROJECTS_DIR, projectId), {
              recursive: true,
              force: true,
            });
            deleteVaultProject(projectId);
            return sendJson(res, 200, { ok: true, deleted: projectId });
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
});
