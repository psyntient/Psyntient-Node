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

## Stage 1 — Reskin (do first)

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

## Stage 3 — Speed test (checkpoint)

Measure with the same method the user used: stopwatch, real UI, "how are
you". Compare against the recorded baselines:
- WebClaw: 6s → 12s → 16s across three attempts, flattening at 15-17s.
- OpenClaw dashboard, same Gateway/model/session: 13-15s.
- Backend reply production: **~3.3s**. SSE transit: **1ms**.

**Path C is not expected to fix speed.** The 429 rate-limiting and the
~19K-token prompt floor are backend and hit any UI identically. If the
dashboard fork also lands at 13-17s, that is the expected result and the
remaining latency is a separate backend investigation — do not treat it as
a Path C failure.

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

## Costs accepted going in

- You own a full OpenClaw monorepo checkout as a build dependency — **more**
  OpenClaw code than today, not less.
- WebClaw work that does **not** port: 7 onboarding components, 22 chat
  components, 31 shared components, 15 API routes (artifact, history,
  onboarding, pairing, provider-key, send, sessions, stream, transcribe,
  usage, vault, working-memory, projects, paths, ping).

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
