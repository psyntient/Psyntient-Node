# Repository Structure & Update Sourcing

Reference doc for how Psyntient Node's code is split across git repos, what
lives where, and why — written 2026-08-24 after setting up the real
`psyntient` org repos. Read this before changing what's tracked where, or
before building the installer/update tooling that will read
`Cortex/versions.json`.

## The repos

| Repo | Purpose | Owner |
|---|---|---|
| [`psyntient/Psyntient-Node`](https://github.com/psyntient/Psyntient-Node) | The app itself — full backup **and** the source future installers/updaters pull from | Psyntient |
| [`psyntient/openclaw-mirror`](https://github.com/psyntient/openclaw-mirror) | Single-commit snapshot of the exact OpenClaw commit currently pinned — fallback-only insurance | Psyntient |
| `github.com/openclaw/openclaw` | Real upstream OpenClaw — where installs/updates normally pull from | Not ours |
| `github.com/ibelick/webclaw` | Real upstream WebClaw — origin of the `psyntient` branch now folded into `Psyntient-Node` | Not ours |

## What's in `Psyntient-Node`, and what isn't

**In** (everything needed to reconstruct a fully functional app):
- `daemon/*.mjs` — the orchestration layer. Not a separately-versioned
  component; it's what does the pulling/updating, so it can't hot-swap
  itself the way the others can.
- `Cortex/Cortex_Agent/` — `IDENTITY.md`, `SOUL.md`, `CAPABILITIES.md`,
  `AGENTS.md`, `TOOLS.md`, `USER.md` (blank template), `skills/`,
  `research/protocols/README.md`. This is Cortex's character/capability
  definition, not personal data.
- `Noetic_Interface/web/` — full WebClaw fork source (branding, Project
  view, voice-to-text, usage display, onboarding wizard, everything built
  this project). `node_modules`/`dist`/build caches excluded via its own
  nested `.gitignore`, which still applies now that it's plain content
  here rather than a separate repo.
- `Noetic_Interface/branding/`, `Noetic_Interface/config.json`,
  `Cortex/versions.json`, root docs (`CLAUDE.md`, the two spec docs),
  `package.json`.

**Out**, deliberately:
- `Cortex/Open-Claw/` — ~5GB, independently-versioned, fast-moving
  upstream. See "Why OpenClaw isn't vendored" below.
- `Working_Memory/`, `Neural_Vault/local/` — real chat transcripts and
  Vault data. Both are **fully self-constructing**: `daemon/vault.mjs`'s
  `activateLocal()` and `daemon/working-memory.mjs`'s `ensureScaffold()`
  are both idempotent and both called unconditionally at the top of
  `daemon/launch.mjs`'s `main()`. Not even needed as empty-directory
  templates — a completely absent `Neural_Vault/vault.config.json` falls
  back to a hardcoded default inside `vault.mjs` itself.
- `Cortex/Cortex_Agent/MEMORY.md` and `memory/` — accumulated session
  history specific to whatever machine has been running the agent, not
  shipped template content. `AGENTS.md`'s own first-run bootstrap flow
  (`BOOTSTRAP.md` → "figure out who you are, then delete it") already
  handles starting from nothing.
- `NEXT_SESSION.md`, `.claude/` — Claude Code session-handoff notes, not
  part of the shipped app.
- Real `.env` files (e.g. a live Gateway token) — `.env.example` templates
  are kept.

The full reasoning for this split — and the "personal data vs. app code"
test that drove it — is in the 2026-08-24 session transcript; this file is
the durable summary.

## Why OpenClaw isn't vendored, but is mirrored

Two different questions, easy to conflate:

1. **Does Psyntient need to patch/fork OpenClaw's code?** No. The two
   requirements that make this Node work — OpenClaw never installing
   globally, and always staying pointed at `Cortex/Cortex_Agent` as its
   workspace — are both solved entirely through *how OpenClaw is invoked
   and configured*, not by changing its source:
   - Non-global install: the daemon always runs OpenClaw by absolute path
     into `Cortex/Open-Claw/`, with `OPENCLAW_STATE_DIR`/
     `OPENCLAW_CONFIG_PATH` explicitly set — never a PATH-resolved global
     `openclaw`.
   - Correct workspace: `agents.defaults.workspace` in `openclaw.json`
     points at `Cortex/Cortex_Agent`. Known failure mode (CLAUDE.md rule
     6): an OpenClaw update can reset this back to OpenClaw's own default
     (`~/.openclaw/workspace`) — has to be re-verified after every update.
     This is the concrete next piece of update tooling worth building: a
     script that *enforces* this rather than relying on a manual checklist
     step.

   Contrast with WebClaw, which genuinely needed a fork — a real code
   patch (the Gateway protocol-version bump), not just config.

2. **Does Psyntient need a backup copy of OpenClaw's code somewhere it
   controls?** Yes — different question, and the one that actually
   matters here. OpenClaw isn't a peripheral dependency; it's the runtime
   that interprets everything in `Cortex_Agent/` (skill loading, memory/
   embedding search, identity parsing). The entire install/update pipeline
   depends on `github.com/openclaw/openclaw` staying reachable at exactly
   the pinned commit, forever. If that repo ever disappears, goes private,
   or has its history rewritten, every Node — including the installer
   itself — loses the ability to set up a working agent, with zero
   recourse. `openclaw-mirror` exists to close that gap: a plain snapshot
   (not a git history mirror — that's 2.1GB of upstream dev history no one
   needs backed up; the snapshot is ~410MB of actual source) of exactly
   the commit `Cortex/versions.json` currently pins.

**Normal installs/updates still pull from real upstream.** The mirror is
fallback-only, and is *not* kept continuously in sync — it needs a fresh
snapshot commit pushed whenever `Cortex/versions.json`'s `installedRef`
for `open-claw` advances. `Cortex/versions.json`'s `mirrorSyncedRef` field
tracks whether the mirror is current; a drift between `installedRef` and
`mirrorSyncedRef` means the mirror is stale and needs re-syncing.

## Credentials

The GitHub token used to push to the `psyntient` org repos lives at
`~/.psyntient/psyntient-git-token` (chmod 600, outside any repo — same
tier as `node.key`/`providers.json`). Never written into any git config
or tracked file; every push authenticates via a per-command
`http.extraHeader`, read fresh from that file each time. This is also
where future daemon-driven update tooling should read it from for
ongoing, unattended access.

## What a future updater needs to do

For OpenClaw specifically (the case that needs the most care):
1. Pull the new commit from `remote` (real upstream) per the normal
   "Safe OpenClaw update procedure" (CLAUDE.md) — stop Gateway, pull,
   rebuild, don't touch `~/.psyntient/openclaw-state`.
2. **Programmatically verify** (not just remind a human to check)
   `agents.defaults.workspace` still points at `Cortex/Cortex_Agent`
   after the update — this is the real, known failure mode.
3. Bump `Cortex/versions.json`'s `installedRef`.
4. Push a fresh snapshot to `openclaw-mirror`, bump `mirrorSyncedRef` to
   match. This step can lag behind (it's insurance, not load-bearing for
   normal operation) but shouldn't be skipped indefinitely.

For Cortex_Agent and the Interface, updates are a normal `git pull` +
rebuild within `Psyntient-Node` itself — no separate remote to reconcile.
The one real subtlety (not yet solved, flagged for later): Cortex_Agent
mixes shippable scaffolding with content a real user will have
personalized (`IDENTITY.md`, `SOUL.md`, `MEMORY.md` once populated) —
a future update to Cortex_Agent's *template* content needs to add new
files without silently overwriting ones a user has already touched, a
different update model than "just pull the latest."
