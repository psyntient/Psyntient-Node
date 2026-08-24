// Working_Memory management (Phase I). Per
// Psyntient_Node_Project_v2.md §2/§5:
//
//   Working_Memory/
//   ├── cortex_projects/<project_id>/   # notes.md, scratch/, logs/
//   └── chat_context/<thread_id>/       # messages.jsonl, .meta.json
//
// Working_Memory survives Cortex/Interface reinstalls (state lives here,
// not in Cortex/Open-Claw or Noetic_Interface/web — same separation
// principle as CLAUDE.md rule 2, just one directory over).
//
// Two distinct things live here, don't conflate them:
//
// 1. chat_context/<thread_id>/ — a materialized MIRROR of a WebClaw
//    session's transcript. The Gateway's own session store (under
//    ~/.psyntient/openclaw-state/) remains ground truth; this directory
//    exists so the transcript survives in a stable, plain-file format for
//    the Cortex Agent and (later) Noetic_API to read directly, and so it
//    physically lives in Working_Memory per the spec rather than only in
//    Gateway-internal state. threadId here is WebClaw's `friendlyId`.
//
// 2. cortex_projects/<project_id>/ — a Vault-backed "Project" per
//    §5's lifecycle: create → scaffold into Working_Memory → active
//    work → sync back to Neural_Vault → erase the working copy (Vault
//    copy remains). This is a heavier, deliberate concept, distinct from
//    every chat thread automatically getting a chat_context mirror.
//    **Not yet wired to any Interface UI** — WebClaw has no "create a
//    project" action yet (its sidebar "Projects" are still just renamed
//    Gateway sessions, one per chat_context thread, not Vault projects).
//    These functions are real and tested via the CLI below, but nothing
//    calls create/sync/erase yet — same honest-stub posture as
//    vault.mjs's switchToCloud() in Phase H.
import fs from "node:fs";
import path from "node:path";
import { paths as openclawPaths } from "./openclaw-cli.mjs";
import { getVaultRoot } from "./vault.mjs";
import { deviceName } from "./device-name.mjs";

const WM_DIR = path.join(openclawPaths.NODE_ROOT, "Working_Memory");
const CHAT_CONTEXT_DIR = path.join(WM_DIR, "chat_context");
const CORTEX_PROJECTS_DIR = path.join(WM_DIR, "cortex_projects");

// Conservative: Vault/device/project/thread ids all end up as path
// segments (in Working_Memory and/or Neural_Vault), so reject anything
// that isn't a plain safe token rather than trying to escape it.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function assertSafeId(id, label) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(id)}`);
  }
  return id;
}

// Idempotent, mirrors vault.mjs's activateLocal() — safe to call on
// every launch.
export function ensureScaffold() {
  fs.mkdirSync(CHAT_CONTEXT_DIR, { recursive: true });
  fs.mkdirSync(CORTEX_PROJECTS_DIR, { recursive: true });
  return { ok: true, chatContextDir: CHAT_CONTEXT_DIR, cortexProjectsDir: CORTEX_PROJECTS_DIR };
}

// --- chat_context (thread mirror) -----------------------------------

// Overwrites (not appends) messages.jsonl from the given messages array —
// the Gateway is ground truth, so each sync is a full, consistent
// snapshot rather than an incrementally-appended log that could drift or
// duplicate on retry.
export function syncThreadHistory(threadId, messages) {
  assertSafeId(threadId, "threadId");
  if (!Array.isArray(messages)) {
    throw new Error("messages must be an array");
  }
  const dir = path.join(CHAT_CONTEXT_DIR, threadId);
  fs.mkdirSync(dir, { recursive: true });
  const jsonl = messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length ? "\n" : "");
  fs.writeFileSync(path.join(dir, "messages.jsonl"), jsonl);
  const meta = {
    threadId,
    messageCount: messages.length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, ".meta.json"), JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

export function listThreads() {
  if (!fs.existsSync(CHAT_CONTEXT_DIR)) return [];
  return fs
    .readdirSync(CHAT_CONTEXT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CHAT_CONTEXT_DIR, e.name, ".meta.json"), "utf8"));
      } catch {
        return { threadId: e.name, messageCount: null, updatedAt: null };
      }
    });
}

// --- cortex_projects / Vault projects --------------------------------

function workingProjectDir(projectId) {
  return path.join(CORTEX_PROJECTS_DIR, projectId);
}

function vaultProjectDir(projectId) {
  return path.join(getVaultRoot(), "Devices", deviceName(), projectId);
}

// Scaffolds both the Working_Memory working copy and the Vault's
// permanent Devices/<device>/<project>/ home. Idempotent — safe to call
// again for an existing project (never overwrites notes.md or an
// existing .project.json).
export function createProject({ projectId, title }) {
  assertSafeId(projectId, "projectId");

  const workDir = workingProjectDir(projectId);
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(workDir, "scratch"), { recursive: true });
  fs.mkdirSync(path.join(workDir, "logs"), { recursive: true });
  const notesPath = path.join(workDir, "notes.md");
  if (!fs.existsSync(notesPath)) {
    fs.writeFileSync(notesPath, `# ${title || projectId}\n`);
  }

  const vaultDir = vaultProjectDir(projectId);
  fs.mkdirSync(path.join(vaultDir, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(vaultDir, "notes"), { recursive: true });
  fs.mkdirSync(path.join(vaultDir, "analyses"), { recursive: true });
  fs.mkdirSync(path.join(vaultDir, "exports"), { recursive: true });
  const projectJsonPath = path.join(vaultDir, ".project.json");
  if (!fs.existsSync(projectJsonPath)) {
    fs.writeFileSync(
      projectJsonPath,
      JSON.stringify(
        { projectId, title: title || projectId, device: deviceName(), createdAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  }

  return { ok: true, workingDir: workDir, vaultDir };
}

function copyDirContentsInto(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContentsInto(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

// Copies the Working_Memory working copy into its permanent Vault home.
// Mapping (a deliberate call, not spec-literal — the spec doesn't define
// a field-by-field mapping): notes.md -> Vault notes/, logs/ (session
// transcripts/logs the agent kept) -> Vault sessions/, scratch/ (work
// product) -> Vault exports/. Does not touch analyses/ (nothing in the
// Working_Memory side currently produces that).
export function syncProjectToVault(projectId) {
  assertSafeId(projectId, "projectId");
  const workDir = workingProjectDir(projectId);
  if (!fs.existsSync(workDir)) {
    throw new Error(`No working copy for project "${projectId}" in Working_Memory`);
  }
  const vaultDir = vaultProjectDir(projectId);
  fs.mkdirSync(vaultDir, { recursive: true });

  const notesPath = path.join(workDir, "notes.md");
  if (fs.existsSync(notesPath)) {
    fs.mkdirSync(path.join(vaultDir, "notes"), { recursive: true });
    fs.copyFileSync(notesPath, path.join(vaultDir, "notes", "notes.md"));
  }
  copyDirContentsInto(path.join(workDir, "logs"), path.join(vaultDir, "sessions"));
  copyDirContentsInto(path.join(workDir, "scratch"), path.join(vaultDir, "exports"));

  const projectJsonPath = path.join(vaultDir, ".project.json");
  const projectJson = fs.existsSync(projectJsonPath)
    ? JSON.parse(fs.readFileSync(projectJsonPath, "utf8"))
    : { projectId, device: deviceName(), createdAt: new Date().toISOString() };
  projectJson.lastSyncedAt = new Date().toISOString();
  fs.writeFileSync(projectJsonPath, JSON.stringify(projectJson, null, 2) + "\n");

  return { ok: true, vaultDir, syncedAt: projectJson.lastSyncedAt };
}

// Per §5 lifecycle step 5: "Erase from Working_Memory (Vault copy
// remains)". Refuses if there's no Vault copy to fall back on, so this
// can never be the only copy of a project that gets deleted.
export function eraseProjectWorkingCopy(projectId) {
  assertSafeId(projectId, "projectId");
  const vaultDir = vaultProjectDir(projectId);
  const projectJsonPath = path.join(vaultDir, ".project.json");
  // createProject() already stamps an empty .project.json when it
  // scaffolds the Vault side, so mere existence of the file doesn't mean
  // a real sync happened — only syncProjectToVault() sets lastSyncedAt.
  // Check that instead, or this guard can never actually refuse.
  let synced = false;
  try {
    synced = Boolean(JSON.parse(fs.readFileSync(projectJsonPath, "utf8")).lastSyncedAt);
  } catch {
    synced = false;
  }
  if (!synced) {
    throw new Error(
      `Refusing to erase "${projectId}" from Working_Memory — no synced copy found in the Vault (${vaultDir}). Run syncProjectToVault first.`,
    );
  }
  const workDir = workingProjectDir(projectId);
  fs.rmSync(workDir, { recursive: true, force: true });
  return { ok: true, erasedFrom: workDir, vaultDir };
}

export function getProjectStatus(projectId) {
  assertSafeId(projectId, "projectId");
  const workDir = workingProjectDir(projectId);
  const vaultDir = vaultProjectDir(projectId);
  return {
    projectId,
    inWorkingMemory: fs.existsSync(workDir),
    inVault: fs.existsSync(path.join(vaultDir, ".project.json")),
    workingDir: workDir,
    vaultDir,
  };
}

// Lists every project that has a Working_Memory working copy. No UI-driven
// create/rename/delete exists (those are research-agent-skill actions
// during a conversation) -- this and getProjectDetail() below are read-only
// listing/viewing support for the Interface's Projects sidebar section.
export function listProjects() {
  if (!fs.existsSync(CORTEX_PROJECTS_DIR)) return [];
  return fs
    .readdirSync(CORTEX_PROJECTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const projectId = e.name;
      let meta = { projectId, title: projectId, createdAt: null, lastSyncedAt: null };
      try {
        const projectJson = JSON.parse(
          fs.readFileSync(path.join(vaultProjectDir(projectId), ".project.json"), "utf8"),
        );
        meta = { ...meta, ...projectJson };
      } catch {
        // No Vault metadata yet -- shouldn't normally happen since
        // createProject() scaffolds both sides together, but stay
        // defensive rather than throwing on a listing call.
      }
      return meta;
    });
}

export function getProjectDetail(projectId) {
  assertSafeId(projectId, "projectId");
  const status = getProjectStatus(projectId);
  const vaultDir = vaultProjectDir(projectId);
  let meta = { title: projectId, createdAt: null, lastSyncedAt: null };
  try {
    meta = {
      ...meta,
      ...JSON.parse(fs.readFileSync(path.join(vaultDir, ".project.json"), "utf8")),
    };
  } catch {
    // no Vault metadata yet
  }

  // Prefer the working copy (live/current) over the Vault's synced copy if
  // both exist -- it's the more up-to-date version.
  const workingNotesPath = path.join(workingProjectDir(projectId), "notes.md");
  const vaultNotesPath = path.join(vaultDir, "notes", "notes.md");
  let notes = "";
  if (fs.existsSync(workingNotesPath)) {
    notes = fs.readFileSync(workingNotesPath, "utf8");
  } else if (fs.existsSync(vaultNotesPath)) {
    notes = fs.readFileSync(vaultNotesPath, "utf8");
  }

  return { ...status, ...meta, notes };
}

export const paths = { WM_DIR, CHAT_CONTEXT_DIR, CORTEX_PROJECTS_DIR };

// CLI fallback, same pattern as vault.mjs — lets the Interface's
// server-side API route shell out via subprocess instead of importing
// this module directly across the WebClaw/daemon boundary.
if (import.meta.url === `file://${process.argv[1]}`) {
  function readStdin() {
    return new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => (data += chunk));
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  }

  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "ensure-scaffold") {
      console.log(JSON.stringify(ensureScaffold()));
    } else if (cmd === "list-threads") {
      console.log(JSON.stringify(listThreads()));
    } else if (cmd === "sync-thread" && rest[0]) {
      const threadId = rest[0];
      const raw = await readStdin();
      const messages = raw.trim() ? JSON.parse(raw) : [];
      console.log(JSON.stringify(syncThreadHistory(threadId, messages)));
    } else if (cmd === "create-project" && rest[0]) {
      console.log(JSON.stringify(createProject({ projectId: rest[0], title: rest[1] })));
    } else if (cmd === "sync-project" && rest[0]) {
      console.log(JSON.stringify(syncProjectToVault(rest[0])));
    } else if (cmd === "erase-project" && rest[0]) {
      console.log(JSON.stringify(eraseProjectWorkingCopy(rest[0])));
    } else if (cmd === "project-status" && rest[0]) {
      console.log(JSON.stringify(getProjectStatus(rest[0])));
    } else if (cmd === "list-projects") {
      console.log(JSON.stringify(listProjects()));
    } else if (cmd === "project-detail" && rest[0]) {
      console.log(JSON.stringify(getProjectDetail(rest[0])));
    } else {
      console.log(
        "Usage: node daemon/working-memory.mjs ensure-scaffold | list-threads | sync-thread <threadId> (messages JSON on stdin) | create-project <projectId> [title] | sync-project <projectId> | erase-project <projectId> | project-status <projectId> | list-projects | project-detail <projectId>",
      );
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
