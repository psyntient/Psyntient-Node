# Path C — Fork OpenClaw's Control UI as the Noetic Interface

**Status: NOT STARTED. Fallback plan only.** Decided 2026-08-26: give WebClaw
one more pass first; adopt this only if WebClaw can't be made reliable.

## Why this exists

WebClaw (our current Interface) produced a series of render bugs — blank
replies, duplicate messages, stuck error banners — while OpenClaw's own
Control UI rendered correctly against the identical Gateway, model, and
session. The idea is to adopt the proven UI instead of continuing to debug
our fork.

## What was proven (don't re-derive this)

Measured 2026-08-26, not assumed:

- **License: MIT**, `Copyright (c) 2026 OpenClaw Foundation`, no TRADEMARK or
  NOTICE file. Forking, rebranding, and shipping commercially is permitted;
  retain the copyright notice.
- **The Control UI is `Cortex/Open-Claw/ui/`** — a Vite + **Lit** SPA
  (web components), ~1,341 source files. Note: **Lit, not React.** None of
  WebClaw's React components port.
- **Themed by ~150 CSS custom properties** (`--bg`, `--accent`, `--fg`,
  `--accent-glow`, …). This is the entire styling surface.
- **Built-in themes:** Claw (default), Knot, Dash, Absolutely, plus one
  browser-local **tweakcn** import slot.
- **28+ routes**, all operator-facing: `/chat /sessions /agents /nodes
  /channels /cron /logs /debug /config /mcp /plugin /infrastructure
  /custodian /automation /model-providers /model-setup /memory-import
  /skill-workshop …`

## Paths evaluated, and why two were rejected

### tweakcn theme import — REJECTED for product use
Per OpenClaw docs: *"Imported themes are stored only in the current browser
profile; they are not written to gateway config and do not sync across
devices."* It's a per-user preference, not product branding. Every user would
have to import it themselves, and it dies when they clear site data.
Still useful as a **1-hour preview** to see Psyntient colors on the dashboard
before committing.

### Path B: vendor `ui/` + its deps into Noetic_Interface — REJECTED, proven infeasible
Attempted and abandoned 2026-08-26. The blocker is concrete:

- `ui/package.json` needs 5 `workspace:*` deps; **3 are unpublished on npm**
  (`media-core`, `normalization-core`, `workboard-contract`) so they must be
  vendored.
- Vendoring those pulls transitive workspace deps (`gateway-protocol`).
  Resolvable — got `pnpm install` to succeed with 306 packages.
- **The real killer:** the build reads the monorepo root `tsconfig.json`,
  which carries **136 path aliases** pointing across the whole OpenClaw
  source tree (`@openclaw/ai -> ./packages/ai/src/index.ts`,
  `openclaw/plugin-sdk/* -> ./src/plugin-sdk/*.ts`, +133 more).
  You cannot vendor "just the deps" — the UI compiles against essentially all
  of OpenClaw.

Artifacts from that attempt are at `Psyntient_Node_V2/Noetic_Interface/`
(`control-ui/`, `packages/`, `pnpm-workspace.yaml`). Delete or ignore them.

### Asset-patching `dist/control-ui` — VIABLE but insufficient alone
Override the ~150 CSS vars + swap logo/favicon in the built output. Ships
fine, persists for users, no monorepo needed, re-apply on OpenClaw updates
(same discipline as WebClaw's protocol patch).
**Limitation that rules it out as the whole answer:** CSS cannot add or remove
screens. No Projects view, no Vault view, no onboarding, and `/debug`,
`/cron`, `/custodian` stay in the sidebar.

## Path C — the actual plan, if adopted

Clone OpenClaw's repo into the Node directory as a **source checkout** and
build `ui/` from there. This is what the existing Node already does for
`Cortex/Open-Claw`, so the pattern is known-good.

1. `git clone https://github.com/openclaw/openclaw.git` into the V2 tree
   (or reuse the existing checkout). **Pin the ref; never pull.** This is the
   whole point — no upstream coupling.
2. Record the pinned ref in `Cortex/versions.json`.
3. Build `ui/` from that checkout — all 136 path aliases resolve naturally
   because the full tree is present.
4. Reskin via the ~150 CSS vars using `Noetic_Interface/branding/theme.json`
   (Psyntient Ink & Gold) as the source of truth. Swap logo/favicon.
5. **Prune routes** — remove `/debug`, `/cron`, `/custodian`,
   `/infrastructure`, and other operator surfaces from nav.
6. **Add product views** — Projects, Neural Vault. These are Lit components;
   they cannot be ported from WebClaw's React and must be rewritten.
7. Keep the **React onboarding/auth as a separate entry point** that hands off
   to the Lit app once setup completes. Confirmed separable: it's its own
   route tree terminating at the chat app.
8. Re-port incrementally, testing speed at each stage: auth → chat → working
   memory sync → PWA → compaction.

### Costs to accept going in
- You own a full OpenClaw monorepo checkout as a build dependency — **more**
  OpenClaw code than today, not less.
- Lit, not React. Every custom view is a rewrite.
- WebClaw work that does NOT port: 7 onboarding components, 22 chat
  components, 31 shared components, 15 API routes (artifact, history,
  onboarding, pairing, provider-key, send, sessions, stream, transcribe,
  usage, vault, working-memory, projects, paths, ping).

### What Path C does NOT fix
The 429 rate-limiting and the ~19K-token prompt floor are **backend**. They
hit any UI identically. The dashboard measured 13–15s on the same Gateway —
not 3s. Do not adopt Path C expecting a speed fix.

## Decision criteria

Adopt Path C only if WebClaw's rendering cannot be made reliable. As of
2026-08-26 the duplicate-message bug is **fixed and verified** (commit
`9e6dbf5`), which materially weakens the case for migrating.

## Conflicts with existing docs

`CLAUDE.md` rule 7 states: *"Noetic Interface must be WebClaw, not a
greenfield UI."* Adopting Path C reverses that decision. Update rule 7
deliberately if this proceeds — don't leave the contradiction unresolved.
