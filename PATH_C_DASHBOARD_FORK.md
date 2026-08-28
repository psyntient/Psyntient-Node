# Path C — Fork OpenClaw's Control UI as the Noetic Interface

**Status: ADOPTED and STARTED, 2026-08-26.** Supersedes the earlier
"fallback plan only" framing in this file.

Decision by the user: *"i am confident that the problem is not in the
openclaw layer because it works in the open claw dashboard correctly.
lets skip telegram and proceed to Path C. start work on it"*

## Staged order (authoritative — user-specified 2026-08-26)

Do these in order. Do not jump ahead; each stage gates the next.

1. **Reskin with Psyntient branding** (§ "Stage 1" below).
2. **Port the setup / auth flow** — onboarding wizard, key gate, pairing
   (§ "Stage 2").
3. **Test speed.** This is a real checkpoint, not a formality — the whole
   premise of Path C is that the dashboard renders reliably where WebClaw
   did not. Measure before building anything further on top.
4. **Port the agent surface in stages** (§ "Stage 4") — chat, then working
   memory sync, then PWA, then compaction. Test speed at each stage.

## Proven facts (measured, do not re-derive)

- **`ui/` builds from the existing pinned checkout: 8.18s, exit 0, 47 MB
  output** to `Cortex/Open-Claw/dist/control-ui`. Verified 2026-08-26.
  This is the fact that made Path C viable — all 136 monorepo path aliases
  resolve naturally because the full tree is present. **No second 4.8 GB
  clone is needed.** Build with:
  ```
  cd /Users/woodleybrown/Psyntient_Node/Cortex/Open-Claw/ui && pnpm build
  ```
- Pinned ref: `eb4eaea39b7`, tag
  `release-publish/556a2ee276f0-20260718-1542-geb4eaea39b7`. **Never pull.**
- **License: MIT**, `Copyright (c) 2026 OpenClaw Foundation`, no TRADEMARK
  or NOTICE file. Forking/rebranding/shipping commercially is permitted;
  retain the copyright notice.
- **The Control UI is Lit, not React** (~1,341 source files, Vite + Lit web
  components). No WebClaw React component ports. Every custom view is a
  rewrite.
- **Theming surface: `ui/src/styles/base.css`.** `:root` defines **103 CSS
  custom properties**; theme families are registered as
  `:root[data-theme="<name>"]` blocks that override only the accent subset
  (see the `dash` block at `base.css:448` as the copy-template — it also
  carries a WCAG contrast audit in comments, worth imitating).
  `ui/src/app/theme.ts` declares
  `type ThemeName = "claw" | "knot" | "dash" | "custom"` plus a
  `VALID_THEME_NAMES` Set — **both must be edited to add a family.**
- **`ui/src/pages/model-setup/` already contains `first-run.ts`** — the Lit
  app has its own first-run concept. Read it before porting our onboarding;
  extending it is likely cheaper than grafting our flow beside it.
- 28+ operator-facing routes exist: `/chat /sessions /agents /nodes
  /channels /cron /logs /debug /config /mcp /plugin /infrastructure
  /custodian /automation /model-providers /model-setup /memory-import
  /skill-workshop …`

## Stage 1 — Reskin — **DONE 2026-08-27** (`6fcfe4258da` on branch `psyntient`)

Built and visually verified on the live Gateway. Every token matches
`theme.json` exactly (checked via computed style, not by eye):
`--bg #0c0a1d`, `--accent`/`--primary #eebc4a`, `--card #14122b`,
`--text-strong #fef4e3`, `--accent-2 #e38f00`, `--destructive #db1f25`.

**Re-apply surface — 8 files. Every one was required for the default to
actually hold; changing only `theme.ts` is not enough:**

| file | why it had to change |
|---|---|
| `ui/src/styles/base.css` | the `:root[data-theme="psyntient"]` family |
| `ui/src/app/theme.ts` | `ThemeName`/`ResolvedTheme` unions, allowlist, dark-only resolve |
| `ui/src/app/settings.ts` | **the real boot default** (was `"claw"` at line 413) |
| `ui/src/app/server-prefs.ts` | allowlist — without it the choice never persists to the gateway |
| `ui/index.html` | anti-FOUC pre-boot script **duplicates** the resolve logic; also the fresh-install path |
| `ui/src/styles/config.css` | theme-picker preview chips |
| `ui/src/pages/config/view-appearance.ts` | theme-picker card |
| `ui/src/i18n/locales/*.ts` (21) | picker label + login subtitle |

**Two traps worth remembering for any future theme work here:**
1. `theme.ts`'s `parseThemeSelection` fallback is **not** the boot default.
   The real default is `settings.ts:413`. Patching the former does nothing
   visible.
2. `index.html` carries a standalone pre-boot script that re-implements
   theme resolution in plain JS for anti-FOUC. Upstream's version
   `return`s early when no settings are stored — leaving **no**
   `data-theme` at all, so a fresh install fell through to the bare
   `:root` block, which is the Claw palette. That early return *is* the
   first-run path for a product fork, so it now paints Psyntient.

Branding also applied: login mark (`public/psyntient-mark.png`), wordmark
"Psyntient", subtitle "Noetic Interface" (all 21 locales), page title,
`favicon.svg`/`favicon-32.png`/`apple-touch-icon.png`, and the webmanifest
(name/short_name/theme_color/background_color).

Upstream's pre-commit lint hook ran and passed on all 27 checked files, so
the locale edits are correctly formatted — not just syntactically valid.

### Original Stage 1 spec (kept for reference)


Source of truth: `Noetic_Interface/branding/BRANDING.md` (authoritative),
with `theme.json` as the machine-readable token subset. Palette:

| token | value |
|---|---|
| background | `#0C0A1D` |
| foreground | `#FEF4E3` |
| card / popover | `#14122B` |
| primary / ring (gold) | `#EEBC4A` |
| primaryForeground | `#0C0A1D` |
| secondary / muted | `#191731` |
| accent | `#241737` |
| border / input | `#302F4B` |
| destructive | `#E5484D` |
| goldLight / goldDeep / goldPressed | `#F7DC9A` / `#E38F00` / `#D9A233` |

Type: display **Instrument Serif** 400 (fallback `ui-serif, Georgia,
serif`), body **Work Sans**.

Steps:
1. Add a `:root[data-theme="psyntient"]` block to `base.css`, modeled on the
   `dash` block. Include the same WCAG contrast audit comment — gold
   `#EEBC4A` on `#0C0A1D` needs verifying, not assuming.
2. Add `"psyntient"` to `ThemeName` and `VALID_THEME_NAMES` in
   `app/theme.ts`, and make it the **default** — this is product branding,
   not a user preference. (Contrast with tweakcn imports, which are
   browser-profile-local and were rejected for exactly this reason.)
3. Swap logo/favicon from `Noetic_Interface/branding/assets/`
   (`noetic-app-icon-*.png`, `noetic-elf-avatar-128.png`).
4. Keep the reskin as a **diff against the pinned checkout**, recorded so it
   can be re-applied — same discipline as WebClaw's protocol-version patch.

**Do not ship WebClaw's default look or OpenClaw's Claw red.**

## Stage 2 — Transport decision (settled 2026-08-27)

The Control UI is a **static SPA served by the gateway** — unlike WebClaw,
which was full-stack and could spawn `daemon/*.mjs` from its own server
routes. So the first Stage 2 question was how the SPA reaches the daemon at
all. Settled as follows.

**Provider key: no transport needed.** OpenClaw already ships this natively —
`ui/src/pages/model-setup/` with its own `first-run.ts` gate (structurally
the same job as WebClaw's `OnboardingGate`). Extend/reskin it rather than
porting ours. `daemon/providers.mjs` and `/api/provider-key` are not needed
for the UI path.

**Pairing / Vault / onboarding marker: gateway HTTP routes.** These are
Psyntient-only with no OpenClaw equivalent. The logic lives at
`Noetic_Interface/gateway-plugin/index.js` — **outside** the OpenClaw tree,
so an update cannot touch it — and calls the unchanged daemon modules
directly (`pairing.mjs`, `vault.mjs`, `onboarding.mjs`). It runs inside the
gateway's own Node process: no subprocess spawn, no second port, no CORS,
same-origin with the SPA.

### Two hard-won facts about gateway routes

1. **The `/__openclaw__/` prefix is mandatory.** The gateway answers any
   ordinary path with the SPA's `index.html` before plugin routes are
   consulted — silently, no warning, no diagnostic. Verified by comparison:
   the bundled canvas plugin's `/__openclaw__/a2ui` returns `401
   application/json`, while an unprefixed path returns SPA HTML. Do not
   "tidy" this prefix away.
2. **`plugins.load.paths` does not work for this.** Tried first, as the
   intended mechanism. The plugin is discovered, listed as enabled, and its
   `register()` genuinely runs in the gateway process with
   `registrationMode: "full"` — confirmed by probe — and `registerHttpRoute`
   accepts the routes without throwing. They still never reach the registry
   the gateway serves from, and the plugin never appears in the gateway's
   active-plugin list. No diagnostic is emitted. Ruled out along the way:
   ESM-vs-CJS export shape (`resolvePluginModuleExport` handles both),
   missing manifest/`configSchema` (fixed, config validates), invalid `auth`
   (`"gateway"` and `"plugin"` are the only valid values and both were
   tried), path normalization, and the peer-link verification gate (applies
   only to plugins declaring an `openclaw` peerDependency).

   **Do not re-attempt `plugins.load.paths` for HTTP routes without new
   information.** A useful false signal to ignore: `plugins list --json`
   reports `httpRoutes: 0` for *every* plugin including bundled ones, because
   the CLI pass does not activate routes. That number says nothing.

### The shim

`Cortex/Open-Claw/src/gateway/psyntient-routes.ts` — **the only Psyntient
code inside the OpenClaw tree.** It imports the external plugin module and
pushes the route objects it produces into the serving registry, so all the
existing dispatch, auth, and scope machinery still applies. Called from
`server-runtime-state.ts`'s plugin request handler, before the
empty-registry short circuit. Idempotent, and never throws — a missing
Interface plugin degrades to "those routes 404", never a dead gateway.

**This grows the re-apply surface from 8 files to 10** (`psyntient-routes.ts`
plus the `server-runtime-state.ts` call site). Keep it thin: new endpoints
belong in the external plugin module, not here.

## Stage 2 — Port setup / auth

Port to the Lit app, in this order: provider-key gate → pairing → vault
step → completion marker. Backing daemon modules are unchanged and already
work (`daemon/providers.mjs`, `daemon/pairing.mjs`, `daemon/vault.mjs`,
`daemon/onboarding.mjs`) — this is a **UI port only**, the protocol side is
done and verified against the real production API.

Non-negotiables carried over from `CLAUDE.md`:
- **Pairing is required, not skippable** (it will gate subscription status).
- Key rotation and device pairing stay **decoupled** — a bad LLM key must
  never trigger re-pairing.
- `hasAnyProvider()` costs ~10-15s of genuine CLI work. Cache it
  (`sessionStorage`, as WebClaw did) or the gate becomes a per-page-load
  regression. Always show a "Checking your setup…" state, never a blank.
- The gate must set its own `checked` state on the redirect-to-onboarding
  branch too, or it blocks its own destination forever. (Real bug, already
  hit once in WebClaw.)
- Full protocol: `daemon/docs/AUTH_FLOW.md` v1.0. Read it first.

## Blocked: automated UI speed measurement in the sandboxed browser

Attempted 2026-08-27, could not complete — recording so it is not retried
blindly.

The dashboard's own trivial-message latency is the decisive open question
(see Stage 3). Measuring it needs an **authenticated** dashboard session,
and the sandboxed browser pane is a fresh profile with no stored token:
- `openclaw dashboard --no-open --json` (the documented way to mint an
  authed URL) **hung past 2 minutes** and wrote nothing, despite the
  Gateway being up and answering HTTP 200. Not diagnosed further.
- Reading `gateway.auth.token` from `openclaw.json` to build the
  `#gatewayUrl=…&token=…` URL the app accepts (`app/startup-settings.ts`)
  was **blocked by the safety classifier**. Not worked around.
- The user's real Chrome (which already has an authenticated dashboard)
  reported no connected browsers, so that route was unavailable too.

**The measurement itself is trivial for the user to run** with the same
stopwatch method used for every other number in this file — open the
dashboard, send "how are you", time until it renders. That single number
decides whether Path C fixes speed. It does not block Stage 2.

## ACTUAL ROOT CAUSE: plugin tool construction, ~22s per cold agent run

Found 2026-08-27 from the runtime's own trace, which had been in the log all
along. User observation that cracked it: *"it takes like 30 seconds to
respond... but the UI states it took 3 seconds."* The UI was honest — it
times the model call. The wait sits in front of it, invisible to the UI.

Measured on a **clean** state dir (so contamination is ruled out):

```
chat.send        11:15:57.010
model request    11:16:24.014   <- 27.0s pre-model
model responded  11:16:27.223   <-  3.2s inference
```

`[trace:embedded-run] prep stages` breaks that down exactly:

| stage | ms |
|---|---|
| workspace-sandbox | 102 |
| skills | 2 |
| **core-plugin-tools** | **22008** |
| bootstrap-context | 781 |
| bundle-tools | 63 |
| system-prompt | 53 |
| session-resource-loader | 32 |
| agent-session | 16 |
| stream-setup | 120 |

and within that: `openclaw-tools:plugin-tools: 21936ms`. Every other
sub-stage is 0-21ms.

**It is module loading, not factory execution.** `shouldWarnPluginToolFactoryTimings`
warns at `PLUGIN_TOOL_FACTORY_WARN_TOTAL_MS = 5_000`
(`src/plugins/tools.ts:81`), and 21.9s produced **no warning** — so
`factoryTimings` was empty and the cost is the lazy dynamic import of the
plugin modules, proportional to how many plugins are active. Consistent with
the second turn in the same session costing only 8.8s pre-model: partially
warmed.

**FIX CONFIRMED 2026-08-27.** `plugins.allow: ["openrouter","memory-core"]`
— gateway reports `2 plugins` instead of 18.

| | before | after |
|---|---|---|
| pre-model, cold turn | 27.0s | **1.21s** |
| pre-model, 2nd turn | 8.8s | **1.22s** |

**~22x, and now flat.** The cold/warm gap disappearing is the real proof the
lazy module loading is gone rather than merely warmed. `[trace:embedded-run]`
stopped emitting on the fixed gateway (it only fires when a phase is slow).
User-observed end to end: **~5s for one-word replies, ~10s for a 500-word
essay** (was 27-30s and 13-15s).

**Cost of the fix — decide deliberately, do not let it be discovered later:**
16 plugins are off, including `browser`, `canvas`, `file-transfer`,
`talk-voice`, `acpx`, `opencode`, `ollama`, `device-pair`, `phone-control`,
`bonjour`, and the meeting integrations. Chat and memory work; anything
depending on those does not. Add back one at a time — each now has a
measurable startup cost, so the trade is visible.

**The UI still shows "loading context, workspace, model" per message.** Those
are real phases (`bootstrap-context`, `workspace-sandbox`, the model call),
not cosmetic; they now complete in ~1.2s total so they flash past. Hiding
them is a Stage 4 UI tweak, not a performance issue.

**Still to do:** this fix lives only on the clean state dir used for testing.
The production Node (port 18789, `~/.psyntient/openclaw-state`) is untouched
and still slow.

### What this corrects

Several earlier conclusions in this file were wrong, and are superseded:

- **Not the UI.** Path C's fork is branding-only and cannot affect this.
- **Not config tuning.** compaction/tools.profile/heartbeat/utilityModel/
  sessionObserver were all aligned to the original install with no
  improvement.
- **Not UI polling contention, not the GitHub/PR calls.** Both real
  observations, neither causal.
- **Not state contamination.** That *is* real and worth fixing — it makes
  RPCs 10-20x slower (below) — but the 27s pre-model delay reproduced on a
  completely clean state dir.

**Lesson for next time: read `[trace:embedded-run]` first.** The runtime
already emits a per-stage breakdown of exactly where a turn's time goes. It
would have pointed at this immediately instead of after a long detour through
UI, config, and state.

## Secondary (real, but not the cause): we ported the contaminated state

The user's framing was correct and is the finding: *"The entire point of the
bisection we did with v2 was to start fresh... so not port over the problem.
It seems like we did port over the problem."* We did. The fork was pointed at
the **old state dir**, so it inherited everything V2 existed to escape.

### The bisection, in order

1. **Dashboard code — exonerated.** `git diff eb4eaea39b7..HEAD` is 14 files,
   all branding (theme block, icons, wordmark, title, manifest, picker card,
   a 4-line settings migration). Nothing touches chat, sessions, streaming,
   or gateway RPC. The clone cannot be slower than stock; it *is* stock.
2. **Config tuning — exonerated.** Aligned all six deltas against the
   original install (removed `compaction.*`, `heartbeat`, `utilityModel`,
   `tools.allow`; `tools.profile` minimal -> coding; `sessionObserver` back
   to default). Result: **no improvement, slightly worse** (7.7-9.2s ->
   9.5-12.0s). Settings restored afterwards.
3. **State — confirmed cause.** Same built code, same model, same workspace,
   same auth; only a fresh state dir. Measured as real gateway RPCs on both
   sides (see the retraction below for why the first attempt did not count):

   | RPC | contaminated | fresh |
   |---|---|---|
   | `sessions.list` | 2409-4083ms | **178ms** |
   | `sessions.branches.list` | 880-1365ms | **103ms** |
   | `chat.history` | 902-1386ms | **152ms** |
   | plugin load at startup | 6.8s | **3.5s** |
   | startup verification/degraded/conflicting warnings | **57** | **0** |

   **10-20x on identical code.**

   **Retracted:** an earlier pass claimed "3x faster (7.7-12.0s -> 3.1-4.4s)"
   from `openclaw sessions list`. That comparison was invalid — the clean run
   printed `Sessions listed: 0` reading a local store, not the gateway
   round-trip the contaminated run did. Do not cite that number. Also, the
   first clean gateway never bound: port 18790 was already held by our own
   `daemon/voice-transcription.mjs serve`, so those measurements hit a
   different process entirely.

### What is wrong with the old state

- **1.4 GB single broken plugin**: `npm/projects/openclaw-llama-cpp-provider`,
  which fails payload verification every start
  (`missing-openclaw-peer-link`). The original install's whole `npm` dir is
  **76 KB**.
- Doctor also reports conflicting plugin install metadata for `brave`.
- 18 plugins take **6.8s** to load at every gateway start.

### Measurement notes (so these are not re-derived)

- `openclaw sessions list` is a good UI-free proxy: CLI process startup is
  only **0.11s**, so the wall time is essentially the gateway RPC.
- Session *count* is not the driver: the fast original store has **47**
  sessions, the slow one **20**.
- Transcripts are tiny (4-12 KB) and the session SQLite is 4.3 MB. Not data
  volume.

### Gotchas when standing up a fresh state dir

Hit in order, each one blocked startup:

1. **`gateway.mode` is required** — without it the gateway refuses to start
   ("existing config is missing gateway.mode... suspicious or clobbered").
   Carry `mode` and `bind` along with `port`.
2. **The API key is NOT in `openclaw.json`.** It lives in the agent's SQLite
   auth store (`agents/main/agent/openclaw-agent.sqlite`). Copying
   `auth.profiles` from config only carries the *declaration*, so the agent
   fails with `missing-provider-auth`. Do **not** copy that sqlite across to
   fix it — it is 45.9 MB (plus two 15 MB backups) and would reimport the
   contamination. Re-paste the key instead:
   `openclaw models auth paste-api-key --provider openrouter`.
3. **Restart after pasting the key.** The gateway caches its model-catalog
   snapshot at startup; adding auth to a running gateway yields
   `prepared model catalog owner was not published for the requested config`
   (`src/agents/prepared-model-catalog.ts:193`).

### Not caused by contamination (present on clean state too)

`controlUi.sessionPullRequests` still fails `UNAVAILABLE` (475-1284ms) on a
clean store. Cause is unrelated: `gh` is not authenticated, and the workspace
sits in a repo with a GitHub remote, so the Control UI queries PRs and times
out. Worth removing in the fork — it buys nothing here.

### Consequence for the plan

**V2 must be built on a fresh state dir.** Carry over identity only —
`gateway.auth`, `auth.profiles`, `agents.defaults.model`, `agents.defaults.workspace`
(and `gateway.mode`, without which the gateway refuses to start). Do **not**
copy `npm/`, `agents/`, plugin install indexes, or session history. A clean
config for this is at `~/.psyntient/openclaw-state-clean/openclaw.json`, and
a clean gateway runs from it on port 18790 for A/B testing.

## Stage 3 RESULT — measured 2026-08-27. **The UI was never the bottleneck.**

First real run of the forked dashboard against the live Node. Timings taken
from the gateway log, not a stopwatch:

```
10:33:34.332  chat.send accepted
10:33:55.425  model request leaves for openrouter   <- 21.1s of PRE-MODEL work
10:33:57.711  model responded 200                   <-  2.3s of inference
```

**90% of the turn is spent before the model is called.** The provider and
model are fine (2.3s for gemini-2.5-flash). This is the same on the
dashboard as it was on WebClaw, which settles the open question: **Path C
does not fix the speed problem, because the problem was never in the UI.**
The user's on-screen observation — "it loads context, loads workspace, then
starts model" — is literally what the log shows.

### What fills the 21 seconds

During that window the gateway is doing, repeatedly:

| operation | observed durations |
|---|---|
| `sessions.list` | 2409ms, 1323ms, 3926ms, 3990ms |
| `chat.history` | 1302ms, 902ms, 1386ms, 1043ms |
| `sessions.branches.list` | ~880-1365ms each |
| `controlUi.sessionPullRequests` | **16980ms**, then failed `UNAVAILABLE` |
| tool-policy recompute | ran **3 times** in one turn |

**This is not data volume.** The store holds only 20 sessions and a 4.3 MB
SQLite. `sessions.list` taking 2-4 seconds against 20 sessions is anomalous
in itself, and the Control UI polls it continuously.

**Leading hypothesis, not yet proven:** the Control UI's own polling
(`sessions.list` with `includeLastMessage` + `includeDerivedTitles`,
`sessions.branches.list`, `controlUi.sessionPullRequests`) contends with the
agent's context assembly on the same process. A 17s `controlUi.sessionPullRequests`
that ends in `UNAVAILABLE` is pure waste and a prime suspect. Next step is to
measure a turn with the UI closed (send via CLI) — if the pre-model phase
collapses, contention is confirmed; if it stays ~20s, the cost is genuinely
in context/workspace assembly.

### Consequences for the plan

- **Do not expect Stage 4 to improve latency.** Porting more UI cannot move a
  number that is 90% server-side.
- The speed work is a **separate backend track**: context assembly, the
  session-store query cost, and the redundant/failing Control UI polls.
- Path C is still justified on its original grounds — rendering reliability
  and not maintaining a second UI — just not on speed.

## Stage 3 — Speed test (original plan, kept for reference)

Measure with the same method the user used: stopwatch, real UI.

**Test both workloads separately — this distinction is the whole point:**
- a trivial message ("how are you")
- a substantial generation (~500-word essay)

Recorded baselines, with their workloads made explicit:

| surface | workload | time |
|---|---|---|
| WebClaw | "how are you" (trivial) | 6s → 12s → 16s, flattening 15-17s |
| OpenClaw dashboard | **500-word essay** | 13-15s |
| backend reply production | trivial | **~3.3s** |
| SSE transit (our transport) | — | **1ms** |

**Correction, 2026-08-26 (user):** an earlier version of this file compared
the dashboard's 13-15s against WebClaw's 15-17s and concluded Path C would
not fix speed. That comparison was wrong — different workloads. The
dashboard was writing a 500-word essay; WebClaw was answering "how are
you." **Path C may well fix the speed issue.**

The supporting evidence points the same way: the backend produces a trivial
reply in ~3.3s and SSE transit is 1ms, so the ~15s floor WebClaw showed on
trivial messages was **not** backend cost — it was a frontend artifact
(consistent with the diagnosed 15s safety-net-refetch path, which is
exactly the kind of fixed floor that no model or token change could move).

So: do not prejudge this checkpoint in either direction. If the dashboard
fork answers "how are you" in ~3s, the frontend was the problem and Path C
solved it. If it also sits at 15s, the remaining latency is backend (429
rate-limiting, the ~19K-token prompt floor) and becomes a separate
investigation.

## PWA origin change — a real migration, plan it (flagged 2026-08-27)

The installed PWA was installed from the **WebClaw Interface at
`127.0.0.1:3210`**. The forked Control UI is served by the gateway at
`127.0.0.1:18789`. A PWA is bound to the origin it was installed from, so:

- The existing PWA **keeps working** against WebClaw for as long as
  `interface-control.mjs` keeps serving 3210. Verified 2026-08-27: process
  alive, `/` -> `/chat/main`. Nothing in Stage 1/2 touched it.
- It will **never** pick up the fork, the reskin, or anything built after
  this point — different app, different origin.
- When WebClaw is decommissioned the installed PWA does not migrate. It
  becomes an icon pointing at a dead port, and the user must install the new
  one from `18789` by hand.

**Do not treat this as a detail.** This project has already lost real time to
PWA install/caching behaviour twice (the icon-shape saga, and the
service-worker `ERR_FAILED` from caching the HTML document cache-first — see
CLAUDE.md section 7). Decide the migration deliberately at Stage 4:
whether to serve the fork on 3210 instead, to keep a redirect stub alive at
the old origin, or to accept a one-time manual reinstall and tell the user
plainly.

Carry forward the hard-won service-worker rule to whatever ships next: never
cache the HTML document cache-first; only content-hashed `/assets/*` are
safe, and bump `CACHE_NAME` on any change.

## Stage 4 — Port the agent surface, in stages

Order: chat → working-memory sync → PWA → compaction. Test speed after each.

Then prune operator routes from nav (`/debug`, `/cron`, `/custodian`,
`/infrastructure`) and add product views (Projects, Neural Vault) as new Lit
components.

## Protocol drift: why Path C cannot repeat the WebClaw break

Verified in source 2026-08-27, in answer to "will this block users who
download the app if OpenClaw gets updated?" **No — structurally.**

- **WebClaw hardcoded it.** `apps/webclaw/src/server/gateway.ts` set
  `minProtocol`/`maxProtocol` to a literal `3`. A separate app pointing at
  a gateway it did not ship with, so when the bundled gateway required 4
  every API route failed. Hence the hand-applied patch on every update.
- **The Control UI imports it.** `ui/src/api/gateway.ts:75-76` sends
  `clientMinProtocol: MIN_CLIENT_PROTOCOL_VERSION` / `clientMaxProtocol:
  PROTOCOL_VERSION`, both from `packages/gateway-protocol` — the same
  package the gateway reads its own value from. No independent number
  exists to drift.
- **The gateway serves the UI from its own package.**
  `resolveControlUiRootSync` (`src/infra/control-ui-assets.ts:189`) walks
  candidates relative to the gateway's own module/exec dir
  (`dist/control-ui`, `../Resources/control-ui`). UI and gateway ship as
  one artifact and advance together.
- Mismatch handling, for reference: `connect-admission.ts` logs
  `PROTOCOL_MISMATCH` and closes with `1002`.

**What IS at risk on an OpenClaw update: the reskin, not connectivity.**
The Stage 1 patch lives in the upstream tree. Replace `Cortex/Open-Claw/`
without re-applying the `psyntient` branch and users get a fully working
dashboard in OpenClaw red. Unbranded, not blocked.

**The one way to recreate the WebClaw bug — decide this deliberately at
Stage 4, not by accident:** shipping our reskinned `dist/control-ui` as a
*separate* artifact on its own port (the way the current Interface runs on
3210) while the gateway updates independently. That restores the exact
drift. Keep building the UI from the same checkout shipped as the gateway,
and let the gateway serve it.

**End-user auth is not a blocker either:** users never type a token; the
gateway serves the UI same-origin and mints credentials. The auth blocker
recorded above was an artifact of a sandboxed fresh browser profile only.

## Typechecking this fork — the ONLY correct command

```bash
cd Cortex/Open-Claw && node scripts/run-tsgo.mjs -p tsconfig.ui.json
```

**`npx tsc --noEmit -p tsconfig.json` run from `ui/` is a silent no-op** —
there is no `ui/tsconfig.json`. It exits 0 having checked nothing, so it reads
as a clean typecheck. Every "typecheck clean" claim made against it during the
Projects build was meaningless; running the real lane afterwards surfaced 12
genuine errors (unused imports left by the sidebar/settings trim, plus a
protected-member access in `app-sidebar-render.ts`). Root `AGENTS.md` says it
outright: *"Typecheck: `tsgo` lanes only; never add `tsc --noEmit`."*

Note the build does not catch these: `node scripts/ui.js build` is esbuild-based
and strips types without checking them, so a UI bundle builds and runs fine
while the typecheck is red.

## Heartbeat cron disabled on the Node (2026-08-27)

OpenClaw auto-registers a `heartbeat:<agentId>` cron job that wakes the agent
every 30 minutes (`DEFAULT_HEARTBEAT_EVERY`, `src/cron/heartbeat-monitor.ts`).
On this Node every wake failed with *"No route-compatible authentication source
is configured for openai"* and **wrote "The agent run failed before producing a
reply." straight into the main session's transcript**, where the user sees it.
It was also what produced the "1 cron job(s) overdue" chip.

Disabled via `agents.defaults.heartbeat.every = "0m"` in
`~/.psyntient/openclaw-state/openclaw.json` (`resolveHeartbeatIntervalMs`
returns `null` for `ms <= 0`, which sets the job `enabled: false`; after a
gateway restart `cron list` reports "No cron jobs"). Backup at
`openclaw.json.bak-heartbeat`.

This is the right default for Psyntient regardless of the openai key: a
local research assistant should not self-poll every 30 minutes, burning
tokens and appending noise to the user's chat. **The installer must write this
setting** — a fresh Node would otherwise reproduce the same failing wake loop.

## Known debt: hand-edited locale bundles

`Cortex/Open-Claw/ui/CLAUDE.md` states: *"Do not hand-edit non-English locale
bundles"* — they are generated output, with `ui/src/i18n/locales/en.ts` as the
only source of truth.

**Every Psyntient string change in this fork edited all 21 locale files**
(theme name, Projects, onboarding, vault badge, account, suggestions...). It
works, but it is debt:

- It inflates the OpenClaw-update re-apply surface from ~10 files to ~30.
- It would conflict with `pnpm ui:i18n:sync` / `ui:i18n:check` if those are
  ever run.

**Fix when convenient:** keep Psyntient strings in `en.ts` only and let the
runtime fall back for other locales — verify the fallback path first. Foreign
translations for a single-user research Node are low value; the 20 extra files
are pure maintenance cost.

Not urgent: the strings render correctly today, and this fork does not run
upstream's i18n workflow.

## Rejected paths (do not retry)

- **tweakcn theme import** — stored per browser profile, never synced to
  gateway config. A user preference, not product branding.
- **Path B: vendor `ui/` + deps into `Noetic_Interface/`** — attempted and
  proven infeasible. 3 of 5 `workspace:*` deps are unpublished; the real
  killer is the root `tsconfig.json`'s **136 path aliases** spanning the
  whole tree. The UI compiles against essentially all of OpenClaw.
  Artifacts from that attempt were **deleted** from
  `Psyntient_Node_V2/Noetic_Interface/` on 2026-08-26.
- **Asset-patching `dist/control-ui` only** — viable for CSS, but cannot add
  or remove screens. Insufficient alone.

## Port inventory — EVERYTHING interface-related must come over

User directive, 2026-08-26: *"make sure you dont forget that we have to
port over everything to do with the interface."* This is the checklist.
Nothing here is optional; mark items done as they land, do not silently
drop any.

### API routes (15) — `web/apps/webclaw/src/routes/api/`
`artifact` `history` `onboarding` `pairing` `paths` `ping` `projects`
`provider-key` `send` `sessions` `stream` `usage` `vault` `working-memory`

**`transcribe` is NOT ported — retired by decision 2026-08-27.** See
"Voice-to-text" below.

These are server-side handlers that shell out to the daemon or call
`gatewayRpc`. The Lit app has its own server surface — each of these needs a
decision: reimplement against the dashboard's own transport, or keep as a
sidecar. **Do not assume the dashboard already covers them** — `pairing`,
`vault`, `working-memory`, `projects`, `onboarding`, and `provider-key` are
Psyntient-specific and have no OpenClaw equivalent.

### Top-level routes (5)
`__root` (hosts `OnboardingGate`) `connect` `index` `new` `onboarding`

### Onboarding screens (7) — `screens/onboarding/`
`welcome-step` `api-key-step` `pairing-step` `vault-step` `install-step`
`onboarding-stepper` `processing-spinner`

### Chat components (17) — `screens/chat/components/`
`capabilities-dialog` `chat-composer` `chat-header` `chat-message-list`
`chat-sidebar` `command-session` `context-meter` `gateway-status-message`
`install-banner` `message-actions-bar` `message-item` `message-status`
`message-timestamp` `project-detail-dialog` `settings-dialog`
`suggestion-chips` `vault-badge`

### Chat hooks (12) — `screens/chat/hooks/`
`use-chat-error-state` `use-chat-history` `use-chat-measurements`
`use-chat-mobile` `use-chat-pending-send` `use-chat-redirect`
`use-chat-sessions` `use-chat-settings` `use-chat-stream`
`use-delete-session` `use-rename-session` `use-session-shortcuts`

### Shared components (~35) — `components/`
`elf-avatar` (the brand mascot — animated idle/blink/talk + gold sparkles,
**must survive the port**), `attachment-button` `attachment-preview`
`boot-progress-bar` `export-menu`, the `prompt-kit/` set (`chat-container`
`code-block` `markdown` `message` `prompt-input` `scroll-button`
`streaming-bubble` `text-shimmer` `thinking` `tool` `typing-indicator`),
and the `ui/` primitives (`alert-dialog` `autocomplete` `button`
`collapsible` `command` `dialog` `input` `menu` `preview-card` `scroll-area`
`switch` `tabs` `tooltip`).

The `ui/` primitives and `prompt-kit/` likely have Lit-side equivalents
already in the dashboard — check before rewriting. `elf-avatar` does not.

### PWA / static — `web/apps/webclaw/public/`
`manifest.json` `sw.js` `favicon.svg` `brand/` `cover.jpg` `robots.txt`

`sw.js` carries a hard-won rule: **never cache the HTML document
cache-first**; only content-hashed `/assets/*` are safe cache-first, and
bump `CACHE_NAME` on any change.

### Daemon modules (16) — `daemon/`, unchanged by the port
`device-name` `heartbeat-control` `heartbeat-loop` `interface-control`
`launch` `onboarding` `open-browser` `openclaw-cli` `openclaw-control`
`pairing` `provider-test` `providers` `vault` `working-memory`

~~`voice-transcription-control` `voice-transcription`~~ — **retired**, see
"Voice-to-text" below.

These are already correct and verified against the real production API.
The port is a **UI-layer port** — do not rewrite these. But every one of
them has a caller on the interface side that must be re-established.

### Voice-to-text: use OpenClaw's, retire ours (decided 2026-08-27)

User decision: *"lets use the openclaw dashboard voice-to-text rather than
the one we built before. retire the one we built."*

The Control UI ships its own voice input, so porting ours would mean
maintaining a second implementation of a feature the fork already has —
exactly the duplication Path C exists to avoid (same reasoning as the
provider-key step, where OpenClaw's native `model-setup` replaces our
`/api/provider-key` flow).

**Retire, do not port:**
- `apps/webclaw/src/routes/api/transcribe.ts`
- `daemon/voice-transcription.mjs`
- `daemon/voice-transcription-control.mjs`

Retire them at the point WebClaw is actually decommissioned, not before —
the current Interface still serves them until the fork replaces it.

**Checked: retirement is clean.** `daemon/launch.mjs` does *not* start the
voice transcription process (unlike `interface-control.mjs` and
`heartbeat-control.mjs`, whose PID-file pattern it shares), and the only
references anywhere are the three files themselves. Deleting them together
breaks nothing else.

### Features that must not be lost
- ~~Voice-to-text (ours)~~ — **use OpenClaw's built-in instead**, see below
- Streaming text appearance / highlight
- Working-memory sync on turn completion (wired via `displayMessages`
  effect + 20s idle poll — **not** the SSE `final` event, which was tested
  and confirmed unreliable here)
- Model + token usage display (see the pending plan at
  `~/.claude/plans/swirling-munching-glade.md`)
- Sessions→Projects rename, Vault badge, Settings dialog

## Costs accepted going in

- You own a full OpenClaw monorepo checkout as a build dependency — **more**
  OpenClaw code than today, not less.
- **Lit, not React.** No WebClaw component ports as-is; every custom view in
  the inventory above is a rewrite, not a copy.

## Doc conflict to resolve

`CLAUDE.md` rule 7 says *"Noetic Interface must be WebClaw, not a greenfield
UI."* Path C reverses that. **Update rule 7 once Stage 1 lands** — don't
leave the contradiction unresolved.

## WebClaw fixes worth carrying forward as knowledge

These were real bugs found in WebClaw. The Lit app may or may not share
them, but the failure modes are worth checking for:
- **Session-key mismatch:** sending literal `"main"` instead of the
  canonical `"agent:main:main"` pooled a *different* WebSocket than the one
  the event stream listened on. Every event for the default session was
  emitted where nobody was subscribed. Always resolve to the canonical key.
- **Duplicate messages:** a time-window check running *before* text
  comparison. Identical text is proof of identity on its own; never let a
  time gate veto it.
- **Service worker:** never cache the HTML document cache-first. Only
  content-hashed `/assets/*` are safe cache-first.
