# Psyntient Node — hard rules for working in this repo

Psyntient Node is a self-contained app. OpenClaw is bundled **inside**
`Cortex/Open-Claw/` for this product — never rely on, install, or invoke a
globally-installed OpenClaw. Getting this separation right was non-trivial;
do not casually deviate from it.

## 1. Never use global OpenClaw

Never run bare `openclaw` from PATH / `~/.npm-global`. Always:

```bash
cd /Users/woodleybrown/Psyntient_Node/Cortex/Open-Claw
export OPENCLAW_STATE_DIR="$HOME/.psyntient/openclaw-state"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
node openclaw.mjs <command>
```

(or `pnpm openclaw` from that same directory with the same exports).

## 2. Code, state, and workspace are three different things

| What | Where | Nature |
|------|-------|--------|
| Code | `Cortex/Open-Claw/` | upstream package; git-updatable / replaceable |
| State | `~/.psyntient/openclaw-state/` | sessions, gateway token, config, DBs — must survive OpenClaw updates |
| Workspace | `Cortex/Cortex_Agent/` | agent identity, memory, skills config — Psyntient-owned, not inside the Open-Claw git tree |

## 3. Never put OpenClaw state inside `Open-Claw/`

State inside the git checkout gets wiped or diverged on pull/replace. Always
point at `OPENCLAW_STATE_DIR=~/.psyntient/openclaw-state`.

## 4. Never put agent files at the Node root

The agent lives under `Cortex/Cortex_Agent/` only.

## 5. Gateway service must target the bundle

The LaunchAgent (and later Linux/Windows service adapters) must:

- run `.../Cortex/Open-Claw/dist/index.js` (or the current package entry)
- pass `OPENCLAW_STATE_DIR` + `OPENCLAW_CONFIG_PATH`
- use the fixed product port (default `18789`) unless intentionally changed
  and updated everywhere it's referenced

## 6. Workspace pointer must stay on Cortex_Agent

After any OpenClaw update or config rewrite, verify:

```
agents.defaults.workspace = /Users/woodleybrown/Psyntient_Node/Cortex/Cortex_Agent
```

If OpenClaw resets defaults to `~/.openclaw/workspace`, fix it back.

## Build profiles: `gatewayWatch` is not a substitute for `full`

**This section applies to DEVELOPERS ONLY** (scoped 2026-08-29). Installed
Nodes no longer build at all — they fetch a prebuilt artifact, so neither
profile runs on a user's machine and the failure below cannot reach them. It
remains exactly as true for anyone building this repo by hand, which is why it
stays.


`node scripts/build-all.mjs gatewayWatch` takes ~22s and `full` takes ~20min,
which makes the fast one very tempting. It is only safe for **gateway-only**
edits.

`gatewayWatch` runs a single `tsdown` step. `full` runs **three** —
`tsdown-ai`, `tsdown-packages`, `tsdown-unified` — plus
`plugins:assets:build` / `plugins:assets:copy`. So anything touching the agent
runtime, providers, plugins or tools is not rebuilt by `gatewayWatch`, and the
result is a freshly-built gateway running against a stale AI runtime.

**The failure mode is nasty because it looks like a feature bug, not a build
problem:** ordinary chat keeps working while *every* tool call dies with
`FailoverError: Provider finish_reason: error` after three
`[empty-error-retry]` attempts. Nothing in the error mentions the build. It
cost a long bisection (schema shape, tool count, model, plugin allowlist, our
plugin vs a bundled one) before the profile difference was the answer.

Rule of thumb: **if the change is not confined to `src/gateway/`, use `full`.**
And after either profile, re-run `node scripts/ui.js build` — `gatewayWatch`
wipes `dist/control-ui/` and does not repopulate it.

## 11. Self-update (`daemon/updater.mjs`)

A Node updates by pulling this repo, so the transfer is already proportional
to the change — git sends changed objects, not a release image. The updater
classifies the diff and does the least work that applies it:

| Changed | Work | Restart |
|---|---|---|
| docs, data | none | no |
| `ui/src/**` | **fetch artifact** | **no** — the control UI is served from disk per request |
| `src/gateway/**` | **fetch artifact** | yes |
| `src/**`, `packages/**`, `plugins/**` | **fetch artifact** | yes |
| `daemon/**`, gateway plugin | none | **yes** — `daemonModule` is a dynamic `import()` with a stable URL, and ESM caches by URL |

**A Node no longer builds anything** (changed 2026-08-29). It installs a
prebuilt engine artifact — `dist/`, the workspace packages' own `dist/` and
`package.json`, and the ~150 MB of `node_modules` the runtime actually loads,
against the 1975 MB a full install used to put on disk. So the three rows that
once said `gatewayWatch` or `full` all fetch the same bytes, and the
distinction between those profiles is gone from user machines entirely.

That distinction was worth optimising only because building locally was
expensive: measured, ~30 minutes and a ~9 GB peak, which thrashes an 8 GB
laptop and failed twice before succeeding. The identical build takes 3m28s in
CI. Its disappearance also removes the trap documented above — `gatewayWatch`
leaving a fresh gateway on a stale AI runtime — because that profile no longer
runs anywhere a user can reach.

Note the UI row: it fetches now. `dist/control-ui` is built INTO the artifact,
so there is no such thing as a UI-only change a Node can apply by itself.
`plan.buildUi` survives purely as the signal that the interface changed and a
browser should reload.

**There is deliberately no build fallback.** A Node that has the artifact does
not have the toolchain that made it, so falling back would mean a
multi-gigabyte install followed by a compile needing more memory than these
machines have. A commit with no published artifact — CI may still be running —
leaves the Node on the version it has and says so. Full detail:
`daemon/docs/BUILD_AND_DISTRIBUTION.md`.

Those last two rules are the ones worth not breaking: a UI patch that restarts
the Gateway is a needless interruption, and a daemon patch that *doesn't*
restart it silently keeps running the old code.

**Rollback is a file swap, not a rebuild.** `dist/` is snapshotted to
`dist.prev` before the update (APFS clonefile where available, so it is instant
and costs no disk until something diverges). Rebuilding to undo a bad update
would cost up to 20 minutes at the moment the app is already broken.

**Loop safety** is by recorded target, not by detecting relaunches. The check
is "local HEAD ≠ remote HEAD", so a successful update self-terminates. Only a
*failed* update can loop, so failures record their sha and are not retried
automatically. A lock file makes it single-flight — two tabs refreshing with
auto-update on would otherwise start two updates against one working tree.

**Rollback cannot strand a Node**, because it returns to the sha the updater
was running from — which contains the updater. The one way to lose it is a
manual `git reset --hard` past the commit that introduced it (found by doing
exactly that during testing: the running process survived, since ESM had the
module in memory, but the file was gone for the next invocation). A future
commit that deletes or renames `updater.mjs` would have the same effect.

**A dirty tree refuses rather than stashing.** Local edits ending up somewhere
the user will not look for them is worse than declining to update.

**The engine has its own remote (2026-08-29):**
`github.com/psyntient/Open-Claw-Forked`, branch `psyntient`, remote name
`psyntient-fork`. `origin` inside `Cortex/Open-Claw/` still points at upstream
`openclaw/openclaw` and must stay that way — that is how upstream updates are
fetched later.

It is a GitHub fork, so it shares storage with the parent: pushing our branch
moved only our own commits, in eight seconds, rather than the 2.1 GB a
standalone repo would have required. It is public, so **a Node pulls updates
with no credentials**; the token at `~/.psyntient/psyntient-git-token` is
needed only to push.

This replaced distributing the fork as a committed binary bundle, under which
*any* fork change re-transferred ~880 KB because bundles do not delta — 5.9 MB
of a 16 MB repo across 7 revisions, to ship changes that were often two lines.
The bundle survives as an offline recovery artifact and is no longer refreshed
per commit.

Because the repo and the engine now move independently, the updater checks both
and rolls back both. Rollback restoring the engine is not optional: it used to
happen implicitly when the bundle file reverted with the repo, and with a real
remote a failed update would otherwise leave an advanced engine behind a
rolled-back Node.

## Updating OpenClaw itself (upstream) — read before touching this

Researched against `Cortex/Open-Claw/docs/install/updating.md` (2026-08-29).
This is a DIFFERENT operation from `daemon/updater.mjs`, which only ships our
own code. Nothing here is automated, deliberately.

**Never run `openclaw update` on this Node.** It manages the checkout and the
release channel: on a git install it fast-forwards `main` or switches channels,
which takes the tree off our `psyntient` branch. It also assumes state in
`~/.openclaw`, while ours lives in `~/.psyntient/openclaw-state`. The right
reference for our shape is `scripts/update-gateway.sh` (documented under
"Source-checkout servers"), which fails closed on local changes and rebases a
local server branch onto `origin/main`.

**Back up before, and verify it.** This is what protects the provider key:

```bash
openclaw backup create --output ~/Backups/openclaw --verify
```

The archive includes credentials and auth profiles, so it gets the same
protection as the live state directory. `openclaw update` keeps a config copy
but does NOT create a state recovery point.

**`openclaw doctor` migrates config** and must be run after an update — which
is exactly where rule 6 bites. Always re-verify afterwards:

```
agents.defaults.workspace = /Users/woodleybrown/Psyntient_Node/Cortex/Cortex_Agent
```

**Rollback for a source checkout** is `git checkout --detach <known-good>`,
`pnpm install && pnpm build`, `openclaw gateway restart`. Crossing the session
SQLite migration downward additionally needs, before starting the older code:

```bash
openclaw gateway stop
openclaw doctor --session-sqlite restore --session-sqlite-all-agents
```

**OpenClaw ships its own auto-updater.** It is off by default and this Node has
no `update` block, so it is inert today — but nothing prevents it. Setting
`OPENCLAW_NO_AUTO_UPDATE=1` in the Gateway environment would make it impossible
for OpenClaw's updater to replace the tree underneath ours. Not set as of
2026-08-29; worth doing at the next service reinstall.

Verify after any upstream update: `openclaw --version`, `openclaw health`,
`curl -fsS http://127.0.0.1:18789/readyz`, `openclaw gateway status --deep --json`,
`openclaw doctor --lint --json`, plus the four invariants in rules 2–6 above.

## The installer must not phone home (decided 2026-08-29)

psyntient.io serves the installer binary and detects the visitor's OS to offer
the right one. That is the whole of its involvement. **It never performs, drives,
or observes an install.**

Considered and rejected: having psyntient.io run the install, on the reasoning
that it is already open in a browser. It would necessarily learn that a Node was
installed, when, from what IP, and plausibly where on disk — exactly the metadata
this architecture promises not to hold, and inconsistent with vaults never being
registered (section 8). Convenience does not justify it.

So after the binary is downloaded, the install talks to **GitHub** (code) and
**nodejs.org / npm** (runtime and dependencies) only. No install-started ping, no
install-completed ping, no telemetry, no error reporting to psyntient.io.
**Pairing remains the single deliberate, user-initiated moment psyntient.io
learns a Node exists.**

There is also a technical reason the rejected design would not have worked well:
a page on psyntient.io calling `localhost` is a cross-origin request into the
private network, requiring CORS and tripping Chrome's Private Network Access
prompts. The chosen shape — a downloaded binary serving the wizard on localhost,
with the browser pointed at localhost — is same-origin and avoids both.

The remote-install path (DigitalOcean, later) is different and psyntient.io may
drive it: that install happens on a server the user provisioned, over an API,
not on their machine.

## PWA icons — do not re-declare `maskable`

Settled in v1, re-broken and re-fixed 2026-08-29. Source:
`Psyntient_Node_PWA_Icons_Guide.md`.

**Declare only the transparent circular `"any"` icons (192 + 512).** Chromium
desktop prefers a declared `maskable` icon and crops it to a platform tile — a
rounded square on macOS — which buries the circular mark under the exact
background v1 spent a cycle removing. Psyntient Node is desktop-first, so that
trade goes the other way.

The maskable PNGs stay in `ui/public/brand/`, undeclared. Re-add them when
Android ships: Android is the one platform that genuinely wants them, and
losing its adaptive shaping is the accepted cost until then.

**The Apple Touch icon must be opaque, 180x180, with the ink background**, and
belongs to the HTML `<link rel="apple-touch-icon">` — not the manifest icons
array. iOS does not honour transparency; it composites onto a background, so a
transparent source produces an unpredictable tile. A transparent 512x512 file
mislabelled as 180x180 was shipping before this was caught.

Installability needs a **192x192 and a 512x512 PNG with `purpose: "any"`** —
nothing else in the manifest substitutes. Missing those is why the app could
not be installed at all.

iOS additionally needs `apple-mobile-web-app-capable` in the HTML head; it
reads none of the manifest's display settings, so without it an "Add to Home
Screen" install opens in Safari chrome rather than standalone.

**Swapping icon art:** browsers cache manifest icons aggressively. Change the
filename (a version suffix) rather than the bytes, or an installed PWA keeps
the old art. Clearing it otherwise means removing the app from `chrome://apps`,
clearing site data for the origin, and reinstalling.

## Safe OpenClaw update procedure

1. Stop the Gateway service.
2. Update code only: `git -C Cortex/Open-Claw pull` (or replace the tree
   carefully). Bump `Cortex/versions.json` to record the new installed ref.
3. Rebuild if required (`pnpm install` / `pnpm build` in `Open-Claw/` only —
   avoid mass optional cross-OS downloads if possible).
4. Do **not** delete `~/.psyntient/openclaw-state`.
5. Reinstall the service if the entrypoint path changed:
   `node openclaw.mjs gateway install --force` (with env vars set).
6. Start the Gateway; confirm:
   - status uses the bundled path under `Psyntient_Node`
   - config/state still under `~/.psyntient/openclaw-state`
   - workspace still `Cortex/Cortex_Agent`
   - dashboard/chat still works on `18789`

## Connection that must never break

```
Noetic Interface / daemon
    → Gateway WebSocket (localhost:18789)
        → OpenClaw runtime (code in Cortex/Open-Claw)
            → agent workspace (Cortex/Cortex_Agent)
            → state (~/.psyntient/openclaw-state)
```

Updating OpenClaw = replace code. Preserve state + workspace + env wiring +
service entrypoint.

## 7. Noetic Interface must be WebClaw, not a greenfield UI

Clone `https://github.com/ibelick/webclaw` into `Noetic_Interface/web/`.
Do not build a custom chat UI from scratch — rebrand WebClaw instead.

- **Rebrand**, don't replace: full spec is
  `Noetic_Interface/branding/BRANDING.md` ("Psyntient Ink & Gold v1.0" —
  read that first, it's authoritative over anything summarized here);
  `theme.json` in the same directory is a machine-readable token subset of
  it. Logo/avatar source images are in `Noetic_Interface/branding/assets/`.
  Never ship WebClaw's default look. Applied to the `Noetic_Interface/web/`
  checkout on the `psyntient` branch (commit `6e27ec7`, 2026-08-23), then
  extended across rebrand passes 2-3 (`fadfa51`, `6055ac6`, `bf270c3`) —
  Settings dialog, Sessions→Projects rename, and empty-state logo are
  all done now. **Phase K (Branding/trim) closed out 2026-08-24**: added
  the top-bar Vault sync indicator/provider badge spec §6 calls for
  (`VaultBadge`, hover popup shows path + writable status, fetches the
  same `/api/vault` route Settings uses); added the `psy-aura` "live
  dot" keyframe spec §7 names for exactly this (scale 1→1.18, opacity
  .35→.7, 7s ease-in-out) on the badge's status dot; added the global
  `prefers-reduced-motion` rule spec §7 requires — checked, nothing in
  this app honored it before, a real gap not just unfinished polish.
  Nothing product-blocking remains from the branding spec.
- **Keep** WebClaw's strong UX pieces: voice-to-text, streaming text
  appearance/highlight, settings page, chat threads. Trim excess chrome.
  Map WebClaw "threads" to "Projects" + open chat (not yet done).
- **No separate agent stack.** The Interface is a pure client of the
  already-running bundled Gateway — wire it with Gateway URL + token only.
  No product email/password login, ever.
- Default Gateway target: `http://127.0.0.1:18789/` (same Gateway this
  daemon already manages — see `daemon/openclaw-control.mjs`).

### First-launch key gate and Settings key rotation

The user supplies their own LLM provider API key; it is never uploaded to
psyntient.io and never leaves the Node.

- **First launch, no usable key:** show a blocking setup step. Chat must
  not become available until a key is entered. **Now implemented as the
  onboarding wizard's step 2, in-Interface** (see "First-run order"
  below for the full flow) — the original native-macOS-dialog stand-in
  (`daemon/prompt-macos.mjs`, `ensureProviderKeyBlocking()` in
  `daemon/launch.mjs`) is retired and deleted, not kept alongside it.
  Once a valid key exists, never show this gate again — checked live
  against OpenClaw's own auth store (`hasAnyProvider()` in
  `daemon/providers.mjs`), not a cached flag.
- **Settings allows adding, replacing, or rotating keys** — **built**
  (2026-08-23, `Noetic_Interface/web` commit `b034277`): a "Provider key"
  section in `settings-dialog.tsx` (provider dropdown + key input + gold
  Save button) posts to `apps/webclaw/src/routes/api/provider-key.ts`,
  which spawns `daemon/providers.mjs`'s `add` CLI path — **the same
  `setProviderKey()` the first-launch gate uses**, no second
  implementation. Verified live: rotated a real (throwaway) key through
  the actual UI, config updated, Gateway restarted, UI showed a real
  success state.
- **Resolved differently than expected:** the dependency once flagged
  here — "Settings can't shell out to the daemon, needs `Noetic_API`
  (Phase J)" — turned out unnecessary. WebClaw's own dashboard server
  already *is* a Node backend with filesystem access; it can spawn
  `daemon/providers.mjs` directly as a subprocess. No `Noetic_API` slice
  needed for this. `provider-key.ts` duplicates the small
  `SUPPORTED_PROVIDERS` list by hand (rather than importing
  `daemon/providers.mjs` directly) to avoid Vite's SSR bundler trying to
  analyze code outside the app's own `src/` — keep that list in sync if
  `daemon/providers.mjs`'s list changes.
- **Missing/invalid key after a Settings change** returns the user to a
  clear "connect a model" / re-enter-key state — **not** a re-run of full
  Node pairing (Phase G). Key rotation and device pairing are unrelated
  and must stay decoupled.

### First-run order — onboarding wizard (built 2026-08-24)

**Policy reversal (2026-08-23): pairing is required, not optional.**
Earlier text in this file (and Phase G's original implementation) treated
pairing as non-blocking because the dev plan's MVP section doesn't list
it. The user has explicitly corrected this: **pairing will eventually
correspond to subscription status**, so it cannot be skippable — a Node
that's never paired can never be gated on entitlement. Do not re-introduce
"pairing is optional" reasoning anywhere; if you find it, it's stale.

**The real wizard is built and live**, replacing the old
native-macOS-dialog + non-blocking-pairing interim flow entirely (that
flow, and `daemon/prompt-macos.mjs`, are gone — not patched, deleted).
Built ahead of the original "after H–L" sequencing note below, at the
user's explicit direction, once Phase H made it possible — Installer
(L) was never actually a dependency, only Vault (H) was.

1. Welcome page (`routes/onboarding.tsx` + `screens/onboarding/welcome-step.tsx`)
   — Psyntient mark, "Initialize Node →" button.
2. API key page (`api-key-step.tsx`) — provider dropdown + key input,
   same shape as Settings' `ProviderKeySection`. Save
   (`POST /api/provider-key`) then a **live connection test**
   (`POST /api/provider-key/test`, backed by `daemon/provider-test.mjs`
   — a real, isolated `openclaw infer model run --gateway` call, not a
   fake chat message) before the user can continue. Closes a real gap:
   `paste-api-key` never validated a key before this existed.
3. Pairing page (`pairing-step.tsx`) — auto-triggers
   `POST /api/pairing` (blocking, real `pairStart()`) on mount. **Not
   skippable** — denial/error only offer "Try again," never a way
   forward without pairing.
4. Vault page (`vault-step.tsx`) — shows the real local path from
   `/api/vault`. "Switch to Google Drive" is visibly present but
   disabled/"coming soon" — cloud Vault OAuth isn't built yet (separate,
   paused effort, see `NEXT_SESSION.md`).
5. Continue → marks the one-time completion marker
   (`POST /api/onboarding {action:"complete"}`, written to
   `~/.psyntient/onboarding-complete` by `daemon/onboarding.mjs`) and
   lands on real chat.

Gating lives in `__root.tsx`'s `OnboardingGate`, wrapping `<Outlet/>`
app-wide: redirects to `/onboarding` whenever `hasProvider`/`isPaired`/
`completed` (from `GET /api/onboarding`) aren't all true. Resume point
skips whatever's already satisfied (a user with a key but no pairing
lands on the pairing step directly, not welcome/key again).

**Real, load-bearing performance finding, not an edge case:**
`hasAnyProvider()` (`openclaw models auth list`) costs ~10-15s of
*genuine* CLI work — timed the raw command directly, confirmed it's not
subprocess-nesting overhead. Paying that on every page load would have
been a real regression versus the old interim flow (which paid this
once per app *launch*, at the daemon level, not once per page load).
Mitigated with a `sessionStorage` cache (`psyntient-onboarding-complete`)
once confirmed complete — paid once per browser session. Both gate
components show a real "Checking your setup…" state, never a blank
screen, while this unavoidable first check runs.

**Real bug found and fixed during this build, worth remembering:** the
gate must set its own `checked` state to `true` on the
redirect-to-`/onboarding` branch too, not only on the
already-complete branch — otherwise the gate (which wraps every route,
including `/onboarding` itself) blocks its own destination forever
after redirecting there. Silent infinite loading, not a crash — easy to
miss.

**Known gap, not silently glossed over:** Welcome/API-key/Pairing
steps' actual rendering wasn't independently visually verified this
session — the only Node available to test against was already fully
onboarded (real key, real pairing), so reaching those steps live would
have meant deliberately breaking real working state. Verified instead:
each backing endpoint directly via curl against real state, and the
full gate→resume→Vault-step→complete→chat path end-to-end for real
(that Node's actual resume point). A genuinely fresh install exercising
steps 1-3 live has not happened yet.

Settings can still change the LLM key anytime — pairing and BYO-key
gating stay decoupled (a bad LLM key must never trigger re-pairing, and
vice versa), same as before.

**Full protocol:** `daemon/docs/AUTH_FLOW.md` (v1.0, "source of truth" —
supersedes any earlier pairing description anywhere else, including
older text that used to be in this file), plus `daemon/docs/MIGRATION_GUIDE.md`
for the deltas against it (found no old-flow code to migrate — Phase G
was built fresh against AUTH_FLOW.md directly — but the guide's checklist
caught two real gaps, both fixed 2026-08-23: `heartbeat()` now treats
`404` the same as `401`/`403` — the guide adds "Node record missing" to
the same treat-as-revoked bucket AUTH_FLOW.md only listed 401/403 for —
and the pairing success page now actually redirects to the local
Interface after a 1.2s pause, rather than just showing a static "Paired"
message with no redirect). Read AUTH_FLOW.md first for anything pairing/
auth related; this section is implementation notes on top of both docs,
not a third spec.

**One deliberate deviation from both docs, decided 2026-08-23:** the
heartbeat response's `vault` field is **not** treated as authoritative
here, contrary to what AUTH_FLOW.md 3.1/MIGRATION_GUIDE.md section 5 say.
See section 8 below — vaults are never registered with psyntient.io by
design, so there is nothing meaningful for that field to point to in this
implementation. `heartbeat()` passes the response through generically and
does not act on `data.vault`; keep it that way.

**Filename question, resolved by AUTH_FLOW.md section 7:** the canonical
file is `~/.psyntient/node.key` (`node_token`/`node_id`/`context_id`/
`base_url`/`paired_at`, mode 600) — confirmed correct by testing against
the real production API (see below). The `node_key`/`node_token`/
`config.json` files found on this machine earlier belong to AUTH_FLOW.md's
explicitly **deprecated** install-code/device-code model ("remain live
only for machines paired before the `/link-node` flow"). They were left
untouched (not debris, just superseded) but `daemon/pairing.mjs` no
longer reads them — this Node is unpaired under the current model until
it goes through `/link-node` for real.

**Verified against the real production API (2026-08-23), not just unit
logic:** ran the actual loopback server, opened a real browser tab to
`psyntient.io/link-node`, and simulated the callback locally with a fake
token/id — confirmed `node.key` writes correctly (right schema, mode
600), `isPaired()` flips correctly, the nonce-mismatch and `denied=1`
paths both reject/cancel correctly. Then called `heartbeat()` with the
fake token against the **real** `https://psyntient.io/api/public/nodes/heartbeat`
endpoint — it correctly returned 401 "Invalid or revoked token", which
correctly triggered wiping `node.key` per the spec's non-negotiable rule
5. No real pairing was completed by that test itself (all test data was
synthetic/rejected) — but real pairing **did** happen minutes later, when
the user completed the actual browser sign-in/approval during a
background integration test. Confirmed via a genuine `heartbeat()` call:
`ok: true`, correct `node_id`/`context_id`, `vault: null` (correct, Phase
H not done). **This Node is actually paired.**

### Continuous heartbeat loop (closed, 2026-08-23)

Was a real, documented gap — now built. `daemon/heartbeat-loop.mjs` is the
actual long-running process (ticks `heartbeat()` at startup, then every
`INTERVAL_MS` = 5 minutes, matching AUTH_FLOW.md 3.1's "keep it ≤5 min"
revocation-latency requirement; keeps ticking even while unpaired,
checking `isPaired()` each cycle, so a pairing completed later via the
non-blocking `pairIfNeeded()` is picked up automatically without
restarting the loop). `daemon/heartbeat-control.mjs` manages it as a
detached background process with PID-file tracking
(`~/.psyntient/heartbeat.pid`, logs at `logs/heartbeat.log`) — **the same
pattern as `interface-control.mjs`**, deliberately not a launchd/systemd
service yet (shared follow-up scope with the Interface's own version of
this gap, see section 7 above). `ensureRunning()` is idempotent and
synchronous; `daemon/launch.mjs` calls it unconditionally at the very top
of `main()`, before the Gateway/key/pairing checks, since Node↔psyntient.io
heartbeating has nothing to do with LLM keys.

Verified for real: started the loop, confirmed an immediate genuine
heartbeat succeeded against the live API (`heartbeat ok` in the log),
confirmed a second `ensureRunning()` call correctly detected the running
process and did not spawn a duplicate, confirmed `stop()` terminates it
cleanly (SIGTERM, logged, PID file removed, no stray process), then ran
the full `daemon/launch.mjs` flow end-to-end and confirmed it starts the
loop correctly as part of normal launch.

**Plane C (Interface ↔ daemon local session, AUTH_FLOW.md section 4:
`/pair-interface`, `noetic_session` cookie) is still not built.** Separate
concern from Node pairing above — the spec itself notes an
  already-paired Node doesn't need this to keep chatting. Deferred as its
  own follow-up, not part of this pass.

### Running WebClaw locally (dev mode)

- `Noetic_Interface/web/` is its own git clone (like `Cortex/Open-Claw` and
  `Cortex/Cortex_Agent` — see rule 2's pattern). Our changes live on a
  `psyntient` branch, not `main` — `main` tracks upstream so it stays
  pullable without conflicting with our patches. Installed ref/branch
  recorded in `Noetic_Interface/config.json`.
- `.env` (gitignored, machine-local) needs `CLAWDBOT_GATEWAY_URL` and
  `CLAWDBOT_GATEWAY_TOKEN` (the real value is in
  `~/.psyntient/openclaw-state/openclaw.json`'s `gateway.auth.token`,
  redacted from CLI output — read the config file directly). The app reads
  these via bare `process.env`, not Vite's `import.meta.env`, so a plain
  `.env` file is **not** auto-loaded by `vite dev` — the dev command must
  explicitly `source .env` first (see `.claude/launch.json`'s
  `noetic-interface` config for the working incantation).
- **Required patch, not optional/cosmetic:** upstream webclaw `main`
  hardcodes Gateway protocol version 3
  (`apps/webclaw/src/server/gateway.ts`, `minProtocol`/`maxProtocol`), but
  our bundled OpenClaw requires protocol 4 minimum. No upstream tag/release
  fixes this as of 2026-08-23 (checked — no tags exist at all). Without
  this bump the app cannot connect to the Gateway at all (every API route
  fails). This is committed on the `psyntient` branch and must be
  re-applied (or re-verified as no longer needed) on every WebClaw update,
  same as the branding pass below — check the live `PROTOCOL_VERSION` in
  `Cortex/Open-Claw/packages/gateway-protocol/src/version.ts` against
  webclaw's hardcoded value whenever either side updates.

### Known issue: live stream display could stick on "Generating..." — mitigated, root cause still deferred

Upstream bug (not our protocol patch, not the Gateway/agent/daemon) in
`apps/webclaw/src/screens/chat/hooks/use-chat-stream.ts`. Its `EventSource`
reconnects on every session load (opens a generic-friendlyId stream, then
immediately replaces it with a session-key-specific one), and if an agent
run's `final` event arrives during that reconnect window, the UI never
gets the event that would trigger `refreshHistory()`. **Data is never lost
or wrong** — `GET /api/history` always has the real, complete conversation.

**Mitigated (2026-08-23):** `chat-screen.tsx`'s `startRun()` already had a
safety-net timeout that force-refetches history if the live event never
arrives — it was just set to 120s, so the app looked permanently broken
long before it self-healed. Reduced to 15s. Resets on every `delta` event,
so a genuinely slow tool call or thinking pause doesn't trigger it early.
This does not fix the underlying reconnect race (still deferred — the
merge/dedup logic in `use-chat-stream.ts` is substantial, ~700 lines,
worth a dedicated pass) but bounds the worst case from "requires a manual
reload" to "self-heals within ~15s."

**Separately, a real (non-flaky) bug was found and fixed in the same
area:** `textFromMessage()` in `screens/chat/utils.ts` only ever read
`msg.content` as an array-of-parts, but the Gateway sends **user**
message content as a plain string — every user message rendered as an
empty bubble, unconditionally, not intermittently. Fixed to handle both
shapes; `GatewayMessage.content`'s type widened to match. This was the
actual cause of "chat doesn't show the text I submitted," separate from
the stream-timing issue above.

### Production serving: daemon/interface-control.mjs

The launcher (`daemon/launch.mjs`) does **not** run `vite dev` — that's
dev-only tooling. It runs a real production build
(`pnpm build` in `Noetic_Interface/web/`, output at
`apps/webclaw/dist/server/server.js`) served via `vite preview` as a
detached background child process, tracked by PID file
(`~/.psyntient/interface.pid`), fixed port `3210` (distinct from the port
used for ad-hoc dev testing — see `.claude/launch.json`'s
`noetic-interface` config, currently `3111` — so both can run at once
without conflict). Logs at `logs/interface.log`.

**This is deliberately NOT a launchd/systemd service yet** — no
install/start/stop/status parity with `daemon/openclaw-control.mjs`'s
Gateway management. That's real follow-up scope, not done. The
`ensureRunning()`/`stop()`/`url()` API in `interface-control.mjs` is
written so upgrading to a real service later doesn't change callers.

**Gotcha found by testing, not documented anywhere obvious:** both `vite
preview` (production) and `vite dev` (dev testing) bind IPv6 `::1` only
by default — `curl`/`fetch` against `127.0.0.1` gets a bare connection
refused even though the server is genuinely up and `localhost` works
fine. Must pass `--host 127.0.0.1` explicitly to both. If a future change
to how the Interface is served drops this flag, health checks will
silently fail to connect even though the process is running — don't
assume "not listening on 127.0.0.1" means "not running." For `vite dev`
specifically, passing the flag through `pnpm dev -- --host 127.0.0.1`
does NOT work — pnpm's multi-hop script forwarding (root → app package →
vite) mangles the `--` separator; `.claude/launch.json`'s dev config
bypasses this by calling `npx vite dev` directly inside
`apps/webclaw/` instead of going through the `pnpm dev` script chain.

**Gateway token wiring:** `getGatewayEnv()` in `interface-control.mjs`
reads `gateway.auth.token` directly from `openclaw.json` — the CLI's own
`gateway status --json` redacts it (`__OPENCLAW_REDACTED__`), so this is
the one place in the daemon layer that reads the raw config file instead
of going through `openclaw-cli.mjs`'s `runCli()`.

**Also observed:** the same transient Gateway-WS-reconnect flakiness
documented above for dev mode also shows up in this production-preview
serving path (a `ping` briefly returned "Timed out waiting for
connect.challenge event" once, then was consistently healthy again within
seconds). Same category, same non-issue for data integrity.

### Service worker (`public/sw.js`) must never cache the HTML document cache-first

Found via a real user-reported `ERR_FAILED` (2026-08-23), not proactively.
The Phase F service worker originally used one blanket
stale-while-revalidate strategy for every same-origin GET, including the
navigation/HTML request itself. Production build asset filenames are
content-hashed and change every build; a cached HTML document from before
a rebuild references old-hashed JS/CSS files that no longer exist once
`dist/client` gets replaced (not merged) by the next build. Made worse by
`CACHE_NAME` being a static string that never changed across rebuilds, so
the `activate` handler's own cleanup logic never actually fired.

Fixed: navigation/HTML requests are **network-first** (always fetch the
current shell when online, which then references current asset hashes;
cache is only a fallback for genuine offline use). Everything else
same-origin (JS/CSS/images) stays cache-first, which is actually safe —
a content-hashed filename never changes meaning once fetched. If this
service worker is ever touched again: never go back to caching the HTML
document cache-first, and bump `CACHE_NAME` on any change so the existing
cleanup logic actually clears old buckets.

A server-side rebuild + restart does **not** immediately fix this for a
user with an already-registered old service worker/stale cache — the
browser needs to actually pick up the new `sw.js` (normally automatic on
next navigation, since the new worker calls `skipWaiting()` +
`clients.claim()`) or, for a stuck installed PWA specifically, may need a
manual DevTools → Application → Service Workers "Unregister" + Cache
Storage clear, or an uninstall/reinstall of the PWA.

### Safe WebClaw update procedure

Updating WebClaw means replacing `Noetic_Interface/web/` and re-applying
`Noetic_Interface/branding/` **and** the protocol-version patch above on
top. Never wipe `Working_Memory/`, `Neural_Vault/`, or `~/.psyntient/` as
part of a WebClaw update — those are unrelated to the Interface's own code
and must survive it exactly like OpenClaw state must survive an OpenClaw
update (rule 3 above).

## 8. Vault storage and installer — phase rules

Follow the locked phase order; don't build the full native installer
early, don't require cloud storage at install or first launch.

**Vaults are always LOCAL; cloud is BACKUP, not storage (decided
2026-08-28).** This supersedes spec v2.4 §5's "Relocating the Vault" to a
cloud drive as a storage mode, and the `switchToCloud()` framing in
`daemon/vault.mjs`. The Node is the access layer, not the storage layer —
nothing reads a Vault except the daemon on the same machine, so a remote
Vault only means "the daemon reads its own files over a network", which buys
latency and nothing else. **To reach a Vault from elsewhere, run a Node where
the data should live** (a cloud server), rather than pointing a Node at
remote files. This also makes unrepresentable the corruption case of two
Nodes writing one synced folder — the same hazard the Phase L
install-location rule already covers. `daemon/vault-storage.mjs` is the one
place Vault reads happen and rejects remote storage explicitly.

Two things this changes that are **not yet built**: backup targets (Google
Drive, or a user-provisioned Git remote — Git suits the text/metadata tier,
but years of capture volume will bloat it without bound, so don't offer Git
for a whole Vault), and **encryption**, which spec §5 already promises
("cloud providers see encrypted blobs only") and which nothing implements.
As backup, encryption is the only thing between a third party and raw user
data — build it before any backup ships, not alongside.

**Vaults are never registered with psyntient.io — by design, permanently,
not a temporary scoping decision.** Vaults contain private user data;
psyntient.io never knows where a vault lives (local path, or which cloud
account/folder) or what it contains. The **only** thing the website knows
is that a Node is paired under a given Account Context (`AUTH_FLOW.md`
Plane B) — nothing about vault location or contents ever crosses that
boundary. This means:

- **`AUTH_FLOW.md`'s heartbeat `vault` field is not authoritative for
  vault path/provider and must never be acted on that way** —
  `MIGRATION_GUIDE.md`'s checklist item "treat `vault` from heartbeat as
  authoritative; handle reassignment" does **not** apply to this
  implementation. If a future heartbeat response happens to include a
  `vault` block, treat it as informational/unrelated to storage location
  (likely entitlement/tier metadata, not a storage pointer) — do not wire
  any vault-switching logic to it. `daemon/pairing.mjs`'s `heartbeat()`
  already just passes `data` through generically without acting on
  `vault` — keep it that way.
- All vault configuration (`Neural_Vault/vault.config.json`'s
  `storageMode`, local path, cloud provider/account) is decided and
  stored **entirely on the Node**, with zero network calls to
  psyntient.io for vault specifics. Cloud storage OAuth (Google Drive
  first) happens directly between the Node/daemon and the cloud
  provider — psyntient.io is not a party to it and never holds those
  tokens, same sovereignty principle as everything else in this file.

- **Default Vault is local**: `Neural_Vault/` under the Node root
  (`/Users/woodleybrown/Psyntient_Node/Neural_Vault`, already scaffolded
  in Phase A with `vault.config.json`'s `storageMode: "local"`). The Node
  must work fully with local-only Vault — cloud is never a hard
  requirement.
- **Cloud Vault is optional and later** (Phase H): add an Interface
  Settings UI so the user can switch Vault provider from Local to cloud
  (Google Drive first).
- **Phase H** = local Vault activation + the Settings UI to relocate/
  switch provider (local path or Google Drive). Started and completed
  2026-08-23. Built: `daemon/vault.mjs` (readConfig/writeConfig against
  `Neural_Vault/vault.config.json`, `activateLocal()` wired into
  `launch.mjs`'s `main()`, `setLocalPath()` which *moves* existing
  contents rather than stranding them, `switchToCloud()` which throws a
  clear, honest "not wired up yet" error rather than pretending to
  work — no Google OAuth client credentials exist in this repo yet); a
  `/api/vault` Interface route (GET status, POST set-local/switch-cloud)
  following the same subprocess-shell-out pattern as
  `/api/provider-key`; and a VAULT section in the Settings dialog
  (storage mode + path, relocate field/button, "Switch to Google Drive"
  button that surfaces the honest 501). Google Drive itself remains
  unimplemented on purpose — real scope, deferred until real OAuth
  credentials exist, not a stub to "finish" opportunistically.
- **Phase L (Installer)** = the full native installer (pkg/msi/etc.,
  install targets, GUI shortcut). Leave this until the end — until then,
  use the existing directory layout and the launcher/daemon work from
  earlier phases (see `daemon/interface-control.mjs`'s PID-file approach,
  section 7's "Production serving" note above — that's intentionally not
  a real launchd/systemd service yet, and doesn't need to become one
  before Phase L).
  - **Hard requirement for the install-location step, decided
    2026-08-24 (from real prior experience, not a hypothetical):** the
    §3.1 spec's "Install root (default `~/Psyntient_Node/`)" field must
    not let a *local* install land inside a cloud-sync folder without a
    hard-to-miss warning + explicit confirmation. Detect known
    cloud-sync paths (`~/Library/Mobile Documents/com~apple~CloudDocs/`,
    `~/Dropbox/`, `~/OneDrive/`, `~/Google Drive/`, and `~/Desktop`/
    `~/Documents` on both macOS and Windows, since both now
    default-sync those) before accepting a custom path. Real failure
    modes, not theoretical: SQLite state/Working_Memory/Vault files
    corrupt under concurrent app-write + cloud-sync-upload; macOS's
    "Optimize Mac Storage" and Windows 11's OneDrive Files On-Demand can
    evict `Cortex/Open-Claw/`'s files to cloud-only placeholders,
    breaking Node's synchronous `require()` outright; and it silently
    routes supposedly-local, sovereign Vault data through a third-party
    cloud provider the user never chose for that purpose. Warn and
    require confirmation, don't silently block — a power user may have
    a real reason — but the default path must never be one of these.
    Does not apply to the remote-server/droplet install path (different
    disk entirely).
- **MVP does not include** the full installer or cloud Vault — only
  Gateway up, BYO API key on first launch, pairing, and chat via WebClaw
  against the bundled OpenClaw. ("Pairing when needed" was the original
  MVP list's phrasing; per the policy reversal in section 7 above,
  pairing is now required, not conditional — the target onboarding flow
  makes it a non-skippable step, since it will eventually gate
  subscription status.)

Full installer-flow and Vault-provider product details:
`Psyntient_Node_Project_v2.md`. Phase timing (H then L): the Development
Plan.

---

## 9. Working_Memory (Phase I, complete 2026-08-23)

`daemon/working-memory.mjs` implements `Psyntient_Node_Project_v2.md`
§2/§5's `Working_Memory/` layout:

```
Working_Memory/
├── chat_context/<thread_id>/     # messages.jsonl, .meta.json
└── cortex_projects/<project_id>/ # notes.md, scratch/, logs/
```

Two distinct things live here — don't conflate them:

- **`chat_context/<thread_id>/`** — a materialized **mirror** of a
  WebClaw session's transcript (`thread_id` = WebClaw's `friendlyId`).
  The Gateway's own session store (`~/.psyntient/openclaw-state/`)
  remains ground truth; this directory exists so the transcript
  survives in a stable plain-file format for the Cortex Agent and
  future Noetic_API to read directly, and so it physically lives in
  Working_Memory per the spec. Kept in sync automatically — no user
  action needed. **`/api/working-memory`** (Interface route) fetches
  `chat.history` from the Gateway (ground truth, not a client-supplied
  payload) and shells out to `working-memory.mjs sync-thread`. Wired
  from `chat-screen.tsx` via a `useEffect` on `displayMessages` (fires
  once a turn is no longer in flight) plus a 20s idle poll as a
  backstop — **not** the SSE stream's `'final'` event. Testing found
  that event unreliable in this app (see "Known issue" note in section
  7 above, which documents the same general area as already fragile):
  instrumented the live EventSource and confirmed it only ever
  delivered `connect.challenge`/`health`/`presence`/`tick`, never
  `chat`/`agent`/`chat.history`, despite the UI correctly showing
  completed replies via some other already-existing update path in this
  codebase. Don't re-wire this to `onChatEvent`'s `'final'` state on the
  assumption it "should" work — it was tried and confirmed unreliable
  here.
- **`cortex_projects/<project_id>/`** — a heavier, deliberate Vault-backed
  "Project" per §5's lifecycle: create → scaffold into Working_Memory →
  active work → sync back to `Neural_Vault/Devices/<device_name>/<project_id>/`
  → erase the working copy (Vault copy remains). Device name is
  `os.hostname()` via `daemon/device-name.mjs` (shared with
  `pairing.mjs`, so the two never drift). `createProject()`/
  `syncProjectToVault()`/`eraseProjectWorkingCopy()`/`getProjectStatus()`
  are real and CLI-tested (`node daemon/working-memory.mjs
  create-project|sync-project|erase-project|project-status <id>`), but
  **nothing calls them yet** — WebClaw has no "create a project" UI
  action (its sidebar "Projects" are still just renamed Gateway
  sessions, one per `chat_context` thread, not Vault-backed projects).
  Same honest-stub posture as `vault.mjs`'s `switchToCloud()` in Phase
  H — don't build fake UI for this; wire it for real once there's an
  actual "create a project" flow to hang it off.

Sync-to-Vault field mapping (a deliberate call, not spec-literal — the
spec doesn't define one): `notes.md` → Vault `notes/`, `logs/` → Vault
`sessions/`, `scratch/` → Vault `exports/`. Vault `analyses/` is
scaffolded but nothing currently writes to it.

`eraseProjectWorkingCopy()`'s safety guard checks `.project.json`'s
`lastSyncedAt` field, not mere file existence — `createProject()`
already stamps an empty `.project.json` when it scaffolds the Vault
side, so checking existence alone would never actually refuse (a real
bug found and fixed during Phase I testing). If this function is ever
touched again, keep that distinction.

---

## 10. Noetic API backend (Phase J) — lives outside this repo, on a droplet

Real, substantial infrastructure exists for this already, but **none
of it is in `Psyntient_Node` git history** — it's entirely on a
separate DigitalOcean droplet (SSH access scope explicitly limited to
`/opt/Noetic_Archive_Current/` on that box; the droplet's own code is
git-tracked there, just not here). Status as of 2026-08-24: **paused**,
blocked on a DNS record (`archive.psyntient.io`) that hasn't been
confirmed yet — don't assume it exists, check first. Full detail,
exact resume steps, and things not to assume: `NEXT_SESSION.md`'s
"Phase J" section. Don't rebuild any of this from scratch without
reading that first.

---

See `Psyntient_Node_Development_Plan.md` and `Psyntient_Node_Project_v2.md`
(spec v2.4, wins on conflicts) for full product context.
