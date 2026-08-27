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

## Stage 3 — Speed test (checkpoint)

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

## Stage 4 — Port the agent surface, in stages

Order: chat → working-memory sync → PWA → compaction. Test speed after each.

Then prune operator routes from nav (`/debug`, `/cron`, `/custodian`,
`/infrastructure`) and add product views (Projects, Neural Vault) as new Lit
components.

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
`provider-key` `send` `sessions` `stream` `transcribe` `usage` `vault`
`working-memory`

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
`pairing` `provider-test` `providers` `vault` `voice-transcription-control`
`voice-transcription` `working-memory`

These are already correct and verified against the real production API.
The port is a **UI-layer port** — do not rewrite these. But every one of
them has a caller on the interface side that must be re-established.

### Features that must not be lost
- Voice-to-text (`transcribe` route + `voice-transcription*.mjs`)
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
