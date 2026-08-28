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

export default {
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
      parameters: { type: "object", properties: {}, additionalProperties: false },
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
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Plain-language description of what to look for." },
        },
        required: ["query"],
        additionalProperties: false,
      },
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
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Archetype or packet id." } },
        required: ["id"],
        additionalProperties: false,
      },
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
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project to cite into, e.g. thesis-chapter-3." },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Archetype or packet ids the analysis actually used.",
          },
          query: { type: "string", description: "The question these records were found for." },
        },
        required: ["projectId", "ids"],
        additionalProperties: false,
      },
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
          const projects = ledger.readLedger().projects.map((p) => ({
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
};
