# Psyntient Node — session handoff

Read this first when starting a new session on this repo. Also read
`CLAUDE.md` (hard rules) — this doc is status/next-step only, not rules.

## Status as of 2026-08-23

**Phases A–I complete (9 of 12).** Locked order:
A Skeleton → B Daemon/GUI → C BYO key → E WebClaw Interface → D Cortex_Agent
→ F PWA → G Pairing → H Vault → I Working_Memory → **J Noetic API** →
K Branding → L Installer.

Full phase-by-phase history (what was built, bugs found/fixed, how each
was verified) lives in the auto-memory file `project_psyntient_node_overview.md`
— read that for detail, this doc is just the pointer + immediate next step.

Product spec docs are in the repo root:
- `Psyntient_Node_Project_v2.md` (v2.4, wins on conflicts)
- `Psyntient_Node_Development_Plan.md`

## Phase I (Working_Memory) — done, see CLAUDE.md section 9 for full detail

`daemon/working-memory.mjs` built and wired in. Two things, don't
conflate: (1) `chat_context/<thread_id>/` auto-mirrors every WebClaw
session's transcript from the Gateway (ground truth stays the Gateway;
this is a stable-format copy for the Cortex Agent / future Noetic_API) —
live, wired, verified end-to-end through the real UI and the rebuilt
production Interface; (2) `cortex_projects/<project_id>/` implements the
spec's Vault-backed project lifecycle (create/sync/erase) — real,
CLI-tested, but **no UI calls it yet** (WebClaw has no "create a
project" action; its "Projects" are still just renamed Gateway sessions).
Don't build fake UI for this — wire it once a real create-project flow
exists to hang it off.

One non-obvious finding worth knowing before touching chat-screen.tsx
again: the SSE stream's `'final'` event (what `finishRun()` reacts to)
is unreliable in this app — instrumented it directly and confirmed the
live EventSource only ever delivered
`connect.challenge`/`health`/`presence`/`tick` during real testing,
never `chat`/`agent`/`chat.history`, despite the UI correctly showing
completed replies via some other update path in this codebase that
wasn't fully identified. The working-memory sync is wired to
`displayMessages` changing (not the stream event) plus a 20s idle poll
backstop — see CLAUDE.md section 9 before re-wiring anything in this
area to `onChatEvent`'s `'final'` state.

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

Ask the user whether to start Phase J (Noetic API) now, or prioritize
something else (K/L, or resume the Google OAuth Vault work once
credentials exist). Don't assume — the user has been steering phase
order explicitly every time this session.
