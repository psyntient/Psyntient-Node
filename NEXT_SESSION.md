# Psyntient Node — session handoff

Read this first when starting a new session on this repo. Also read
`CLAUDE.md` (hard rules) — this doc is status/next-step only, not rules.

## Status as of 2026-08-24

**Phases A–I and K complete (10 of 12). Phase J (Noetic API) is
substantially built but explicitly PAUSED, blocked on a DNS record —
see below.** The onboarding wizard (originally scoped as "build after
H–L") was also built this session, ahead of L, at the user's direction
— see its own section below. Locked order: A Skeleton → B Daemon/GUI →
C BYO key → E WebClaw Interface → D Cortex_Agent → F PWA → G Pairing →
H Vault → I Working_Memory → J Noetic API (paused) → K Branding (done)
→ **L Installer** (in progress, paused mid-discussion for the
onboarding wizard detour).

## Onboarding wizard — built and verified end-to-end, 2026-08-24

Full detail: CLAUDE.md's "First-run order" section (rewritten, no
longer describes the interim flow — that's deleted, not kept). Short
version: replaces the old native-macOS-dialog BYO-key gate +
non-blocking pairing with a real in-Interface wizard (welcome → API
key with a live connection test → mandatory pairing → Vault
explanation with cloud visibly disabled/"coming soon" → chat), gated
by a new `OnboardingGate` wrapping the whole app in `__root.tsx`.

**Two real bugs found and fixed, worth knowing before touching this
area again:**
1. The gate must set `checked=true` on the redirect-to-`/onboarding`
   branch, not just the already-complete branch — otherwise it blocks
   its own destination forever (silent infinite loading, easy to
   mistake for a slow check that just needs more patience — it doesn't,
   it never resolves without the fix).
2. `hasAnyProvider()` (`openclaw models auth list`) genuinely costs
   ~10-15s of real CLI work — timed the raw command directly to rule
   out subprocess-nesting overhead. Mitigated with a `sessionStorage`
   cache so it's paid once per browser session, not once per page load
   (would have been a real regression for returning users vs. the old
   once-per-app-*launch* interim check). Both gate layers show a real
   loading state now, never a blank screen, for the unavoidable first
   check.

**Verified end-to-end for real** on the rebuilt production Interface
(port 3210) using this actual dev Node's real state (already had a
provider key + real pairing from earlier phases): correctly resumed at
the Vault step, showed the real local path, clicked Continue, landed
on real chat, confirmed `~/.psyntient/onboarding-complete` was
actually written, confirmed a same-tab reload skips straight to chat
with no recheck.

**Known gap, not glossed over:** Welcome/API-key/Pairing steps'
*rendering* wasn't independently visually verified — this machine's
Node was already fully onboarded, so reaching those steps live would
have meant deliberately breaking real working state (a fresh provider
key overwrite, or a real duplicate pairing registration, matching a
mistake already made once earlier this session). Their backing
endpoints were each verified directly via curl instead, and the UI
reuses already-proven component patterns. A genuinely fresh install
exercising steps 1-3 live hasn't happened yet — worth doing if a real
fresh-install scenario comes up (a new test machine, or a deliberate
backup/wipe/restore of this one's provider+pairing state).

**Also found and fixed in passing:** the dev server (port 3111) hit a
genuine hydration-crash bug this session, confirmed pre-existing and
unrelated to the onboarding work (reproduced identically with
`OnboardingGate` removed entirely) — not fixed, just correctly ruled
out as a red herring. Production builds (port 3210) don't exhibit it.
If dev-server testing in this area seems broken again, verify via a
production rebuild before assuming new code is at fault.

## Phase K (Branding) — done, 2026-08-24

Checked the actual Development Plan entry first (it's just "Branding /
trim", no checklist) and cross-referenced the real branding spec
(Project_v2.md §6) against what Phase E's rebrand passes already
covered — almost everything was already done. Closed the two genuine
gaps: a top-bar Vault sync indicator/provider badge (`vault-badge.tsx`,
new, wired into `chat-header.tsx`, fetches the same `/api/vault` route
Settings already used) and the branding spec's named motion system
(`psy-aura` keyframe for the badge's live dot, plus a global
`prefers-reduced-motion` rule that — checked — nothing in this app
honored before this, a real accessibility gap). Also fixed a stale
CLAUDE.md line that still listed three items as "open" that later
rebrand passes had actually already finished. Verified live on both
the dev server and the rebuilt production Interface. Nothing
product-blocking remains from the branding spec.

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

## Phase J (Noetic API) — PAUSED, blocked on DNS, resume steps below

This is real, substantial, tested infrastructure — but it's not in
*this* git repo. It lives entirely on a separate DigitalOcean droplet
(the Noetic Archive backend), reachable via
`ssh root@147.182.188.20` (password given directly by the user in
chat this session — not written here; ask the user again if a fresh
session needs it, don't assume it's unchanged). Scope of droplet
access is explicitly limited to `/opt/Noetic_Archive_Current/` — never
touch anything else on that box without asking first.

**What's built and verified (2026-08-24):**

```
/opt/Noetic_Archive_Current/
├── Latest Archive Edition/       git clone of psyntient/The-Noetic-Archive,
│                                  data only, Architect can swap wholesale.
│                                  Currently incomplete upstream (only
│                                  archetype JSON, no packets/sqlite yet —
│                                  see ARCHITECT_RELEASE_CONTRACT.md inside it,
│                                  also copied to /root/The-Architect/ on
│                                  the same droplet).
├── Noetic_API_Backend/           FastAPI app, now its own git repo
│   ├── app/{main,db,models,auth}.py
│   ├── build_edition_sqlite.py    rebuilds data/edition.sqlite from
│   │                                Latest Archive Edition (prefers a
│   │                                prebuilt edition.sqlite if present,
│   │                                else assembles from raw JSON)
│   ├── deploy/noetic-api.service   copy of the live systemd unit
│   ├── venv/                        gitignored
│   ├── data/edition.sqlite          gitignored (generated)
│   └── .env                         gitignored (INTERNAL_SERVICE_KEY, secret)
└── Ingestion_Queue/               pending/ ingested/ rejected/ + README —
                                     where POST /api/v1/ingest/packets
                                     writes; Architect-owned from there.
```

Running as a real systemd service (`noetic-api.service`, enabled,
survives reboot), currently bound to `127.0.0.1:8000` only — **not
reachable from outside the droplet yet**, which is exactly the blocker.

**Endpoints, all live-tested:** `/api/v1/meta`, `/api/v1/archetypes`
(+ `/{id}`, `/{id}/packets`), `/api/v1/packets` (+ `/{id}`,
`/{id}/archetypes`), `/api/v1/search`, `POST /api/v1/ingest/packets`,
`GET /api/v1/ingest/status/{id}`, `/docs`, `/api/v1/openapi.json`.
Currently serving real data from the one edition that exists: 25
archetypes, 0 packets/mappings (upstream gap, see contract doc above).

**Auth is real, not a stub.** `app/auth.py` calls
`POST https://psyntient.io/api/public/nodes/verify-token` (built by
Lovable AI, who maintains the psyntient.io backend — Postgres/Supabase
behind TanStack Start on Cloudflare Workers) with an
`X-Internal-Service-Key` header, matched by `INTERNAL_SERVICE_KEY` in
the backend's `.env` (root-only readable, gitignored). Verified
end-to-end live against the real production endpoint. Every
`/api/v1/*` data route requires this (not just ingest) — "no Archive
access without an active paired Node" is enforced for real now.
Caches `valid:true` results 60s (keyed by a local hash of the token,
never the raw token) to avoid a round-trip per request; fails closed
on any error. **Known, deliberate limitation:** a token revoked while
already cached stays usable for up to that 60s window — asked, not
fixed, since fixing it means a network round-trip on every request.

**The actual blocker:** the API needs a real hostname to get a valid
TLS cert (a bare IP won't work cleanly). Chosen: `archive.psyntient.io`
→ `147.182.188.20`. User is asking Lovable (or whoever holds the DNS
zone — hints suggest possibly Cloudflare, not confirmed) to add that A
record. **Do not assume it exists — check first:**
`dig +short archive.psyntient.io` (or `nslookup`) before doing anything
else in this phase.

**Resume steps once the DNS record resolves:**
1. Confirm it resolves to `147.182.188.20`.
2. Install Caddy on the droplet (already pre-approved by the user —
   single binary, automatic HTTPS/cert renewal, chosen over
   nginx+certbot for simplicity). Point it at `archive.psyntient.io`,
   proxying to `127.0.0.1:8000`.
3. Add a `ufw` firewall (currently `inactive` — checked) allowing only
   22/80/443, deny the rest, before this goes fully public.
4. Real proof step: call `https://archive.psyntient.io/api/v1/meta`
   using *this actual Node's* own `node_token` from
   `~/.psyntient/node.key` and confirm real data comes back — not a
   synthetic test token.
5. Then decide: does the Node itself get a client module
   (`daemon/`-side) for calling this API, or does WebClaw's Interface
   call it directly? Not yet designed — a real open question for when
   this resumes, don't assume either direction.

Two prompts already drafted and sent to Lovable this session (in case
a third round-trip is needed, same tone/precision worked well both
times): one for the verify-token endpoint (delivered, works), one for
the DNS record (sent, outcome not yet confirmed as of this doc).

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

**Phase L (Installer) is actively in progress** — the user chose this
over resuming Phase J, then paused mid-design-discussion to build the
onboarding wizard first (done, see above). Pick L back up next unless
told otherwise. State when it was paused:

- Confirmed direction (matches spec §3.1 closely): installer offers
  Local (Mac/Windows/Linux) vs. Remote server (user-supplied SSH key)
  vs. DigitalOcean droplet (API token, for less technical users).
- Real gaps found in the *existing* macOS launcher
  (`daemon/macos/Psyntient Node.app`) while discussing this — not yet
  fixed:
  - No custom icon at all (`Info.plist` has no `CFBundleIconFile`,
    uses the generic macOS blank-document icon).
  - `Contents/MacOS/launcher` hardcodes
    `NODE_ROOT="/Users/woodleybrown/Psyntient_Node"` — only works on
    this exact dev machine. Needs to resolve its own install location
    dynamically (standard macOS pattern: derive from the bundle's own
    path, not a literal string) before this can ship to anyone else.
  - Windows and Linux have no launcher equivalent yet at all (no
    `.desktop` entry, no MSI/Start Menu equivalent) — genuinely
    unstarted, not just unpolished.
- Three open questions raised, not yet answered by the user:
  1. SSH-key handling for remote install — paste an existing private
     key into the installer UI, or have the installer generate a fresh
     keypair and show the public half to add to the target server?
  2. DigitalOcean API token — same credential-hygiene treatment as
     other secrets handled this session (never logged, never
     committed, stored only where strictly needed)?
  3. Bundled vs. system Node runtime — does the installer ship its own
     Node so this becomes a real zero-dependency install, or is
     "already have Node" an acceptable v1 requirement?
- Proposed starting point (not yet confirmed): fix the two real macOS
  launcher gaps first (icon + hardcoded path), then build Windows/Linux
  equivalents, before tackling remote-server/DigitalOcean install
  targets as a second pass — local is furthest along already.

Resume Phase J instead only if the user confirms
`archive.psyntient.io`'s DNS record is ready — check
`dig +short archive.psyntient.io` yourself rather than assuming either
way.
