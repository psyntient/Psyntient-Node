# Psyntient Node — session handoff

Read this first when starting a new session on this repo. Also read
`CLAUDE.md` (hard rules) — this doc is status/next-step only, not rules.

## Status as of 2026-08-23

**Phases A–H complete (8 of 12).** Locked order:
A Skeleton → B Daemon/GUI → C BYO key → E WebClaw Interface → D Cortex_Agent
→ F PWA → G Pairing → H Vault → **I Working_Memory** → J API → K Branding
→ L Installer.

Full phase-by-phase history (what was built, bugs found/fixed, how each
was verified) lives in the auto-memory file `project_psyntient_node_overview.md`
— read that for detail, this doc is just the pointer + immediate next step.

Product spec docs are now actually in the repo root (previously only in
`~/Downloads`, a real gap — fixed this session):
- `Psyntient_Node_Project_v2.md` (v2.4, wins on conflicts)
- `Psyntient_Node_Development_Plan.md`

## Next phase: I — Working_Memory thread/project mapping

Per the Development Plan, Phase I maps Interface chat threads and
Cortex Agent active-project scratch into `Working_Memory/`. Per the spec
(`Psyntient_Node_Project_v2.md` §5's "Vault vs. Working_Memory" and the
Devices/Project structure above it):

- `Working_Memory/chat_context/<thread_id>/` — Interface chat threads
- `Working_Memory/cortex_projects/<project_id>/` — active project scratch
  (markdown, SQLite, logs) used by the Cortex Agent
- Project lifecycle: create in `Neural_Vault/Devices/<device>/<project>/`
  → scaffold into `Working_Memory/cortex_projects/<project_id>/` → Cortex
  reads/writes Working_Memory during active work → sync back to Vault on
  command/completion → erase from Working_Memory (Vault copy remains)

**Note:** Phase H only built the Vault *storage location* mechanism
(local path vs. cloud, relocate/switch in Settings). The actual
`Neural_Vault/Devices/<device_name>/<project>/...` internal structure from
the spec has not been scaffolded yet — `Neural_Vault/local/` is still
flat. That scaffolding is Phase I/project-lifecycle territory, not a
Phase H miss.

## Deferred: Cloud Vault (Google Drive) via OAuth

Discussed but explicitly **paused, not started** — pick back up later,
don't start building without re-confirming scope:

- Confirmed direction: **Option A** — the Node talks to the Google Drive
  API directly (upload/download vault files itself), not relying on
  "Google Drive for Desktop" being installed. This means real sync logic
  needs to be built (not just an OAuth handshake).
- Confirmed the privacy model is sound: a shared OAuth Client ID/Secret
  (one per app install, non-confidential for "Desktop app" client types)
  only identifies the *app* to Google. The actual per-user access/refresh
  tokens are generated locally during each user's own consent flow (same
  loopback-server pattern as `daemon/pairing.mjs`) and stored only on
  their device (`~/.psyntient/`, mode 600) — psyntient.io's servers are
  never in that path. This preserves "vaults are never registered with
  psyntient.io" (CLAUDE.md section 8) exactly like BYO LLM keys and
  Node pairing already do.
- **Blocker, not yet resolved:** a real Google Cloud OAuth Client ID +
  Secret needs to exist before any of this can be built for real (not
  something Claude can create — needs a Google Cloud Console project,
  Drive API enabled, OAuth consent screen configured as External with
  the user added as a test user, Client ID of type "Desktop app").
  Ask the user whether they have one yet before resuming this.
- `daemon/vault.mjs`'s `switchToCloud()` still just throws a clear,
  honest "not wired up yet" error — leave it that way until this is
  actually built.

## Immediate next step

Ask the user whether to start Phase I now, or prioritize something else
(J/K/L, or resume the Google OAuth Vault work once credentials exist).
Don't assume — the user has been steering phase order explicitly each
time all session.
