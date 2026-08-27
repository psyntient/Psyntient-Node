# Noetic Interface — UI modification plan (Stage 4)

Written 2026-08-27, after the speed problem was solved (see
`PATH_C_DASHBOARD_FORK.md`). The fork is currently **stock OpenClaw Control
UI + Psyntient branding, nothing more**. This plan covers what to add, what
to remove, and what to rebuild.

Scope note: everything here is **Lit**, not React. Nothing from WebClaw can be
copied; each ported item is a rewrite against the same daemon endpoints.

---

## 1. Route surface — what we inherited

The Control UI ships **26 route directories**. Most are operator/coding
surfaces we do not need. Counting source files as a rough weight:

### DROP — coding, infra, and operator surfaces (~183 files)

| route | files | why |
|---|---|---|
| `workboard` | 23 | coding task board |
| `agents` | 20 | multi-agent management; Psyntient has one agent |
| `skill-workshop` | 19 | authoring skills |
| `custodian` | 17 | infra babysitting |
| `nodes` | 11 | remote node fleet |
| `cron` | 10 | scheduled jobs |
| `plugins` / `plugin` | 9 + 8 | plugin management is now a config concern |
| `logs` | 7 | operator surface |
| `tasks` | 5 | coding tasks |
| `apps` | 5 | app catalog |
| `debug` | 4 | operator |
| `labs` | 4 | experimental |
| `worktrees` | 3 | git worktrees — pure coding |
| `approvals` | 3 | exec approvals; tied to tools we disable |
| `channels` | 29 | Telegram/Slack/etc. **Decide deliberately** — dropping forecloses the messaging-channel product direction. Default: drop from nav, keep the code. |

**Removal method:** prune from navigation first, not by deleting files.
Nav entries live in `app/server-prefs.ts` (`SIDEBAR_NAV_ROUTES`) and the
sidebar components. Deleting route directories risks breaking imports across
a tree we do not own; hiding them is reversible and safe on OpenClaw updates.

### KEEP — genuinely useful for a research Node

| route | files | role in Psyntient |
|---|---|---|
| `chat` | 171 | the product |
| `sessions` | 11 | becomes **Projects** (rename + reframe) |
| `config` | 30 | source of **Settings**; trim heavily |
| `usage` | 25 | token/cost visibility (matches the pending usage plan) |
| `model-setup` | 16 | **onboarding step 2** — already has `first-run.ts` |
| `model-providers` | 12 | provider key management |
| `memory-import` | 5 | research-relevant: bring a corpus in |
| `profile` | 10 | user identity |
| `activity` | 7 | lightweight status; evaluate |
| `about` | 5 | trim to a Psyntient about box |

---

## 2. Port from WebClaw (rewrite in Lit)

Only the pieces that are genuinely Psyntient-specific. Anything OpenClaw
already does well is **not** ported — that duplication is what Path C exists
to avoid (same reasoning that retired our voice-to-text and our
provider-key flow).

| WebClaw component | lines | disposition |
|---|---|---|
| `suggestion-chips.tsx` | 67 | **PORT.** "What Cortex can do" helper chips. Small, high value for onboarding, no OpenClaw equivalent. |
| `project-detail-dialog.tsx` | 128 | **PORT.** Backs the Projects view. Pair with `daemon/working-memory.mjs`'s real `createProject`/`syncProjectToVault`/`eraseProjectWorkingCopy`, which are built and CLI-tested but have **no UI caller yet**. |
| `vault-badge.tsx` | 89 | **PORT.** Vault sync indicator + provider badge; spec §6 requires it. Needs the `/__openclaw__/psyntient/vault` route from Stage 2. |
| `elf-avatar.tsx` | 135 | **PORT.** See §4. |
| `settings-dialog.tsx` | 539 | **PARTIAL.** Port only the Psyntient sections (Provider key, Vault). OpenClaw's `config` page already covers theme, chat display, and model settings — do not rebuild those. |
| `chat-sidebar.tsx` | 466 | **DO NOT PORT.** OpenClaw's sessions sidebar is equivalent; take the *rename* (Sessions → Projects), not the code. |

### Projects: resolve the ambiguity first

WebClaw's "Projects" were only renamed Gateway sessions. `Working_Memory/`
has a second, heavier meaning (`cortex_projects/<id>/` with a Vault-backed
lifecycle). **Decide which one the UI exposes before building**, or the
Projects view will mean two things at once. Recommendation: sidebar
"Projects" = sessions (cheap, matches user mental model); the Vault-backed
project lifecycle gets its own explicit "Create project" action in the
Projects detail dialog.

---

## 3. Chat graphics — keep OpenClaw's explanation, restore the elf

The user wants both: *"open claw dashboard chat graphics do explain more of
what the agent is doing. Maybe keep that. But we need the magic elf vibes and
graphics back too."* These are not in conflict — they occupy different slots.

**KEEP (OpenClaw's, already working):**
- `pages/chat/tool-stream.ts` — live tool call stream
- `pages/chat/tool-titles.ts` — human-readable tool titles
  (`getToolCallTitle`)
- `pages/chat/chat-progress.ts` — working/progress state, compaction dividers
- `pages/chat/steered-chip.ts` — steering affordance

This is the "explains what the agent is doing" layer and it is better than
what WebClaw had. Do not replace it.

**RESTORE (ours):**
- The elf avatar as the **assistant** avatar, with idle/blink/talk frames and
  the gold sparkle particles while speaking.

**Integration point is already there:** `pages/chat/chat-avatar.ts` (411
lines) exports `renderChatAvatar()` and the layout reserves an avatar gutter
(`styles/chat/grouped.css`, `--chat-group-avatar-column`). The elf slots into
the existing assistant branch — no new layout work.

Carry forward the corrections from the WebClaw version: the avatar must stay
**solid and vivid** through the animation (no fade-out), and there must be
**no flashing gold ring** while thinking — that ring was removed once already
and should not reappear. Respect `prefers-reduced-motion`.

---

## 3b. Settings — comb-through (decided 2026-08-27)

OpenClaw's Settings is **22 routes in 5 groups** (`SETTINGS_NAVIGATION_GROUPS`
in `ui/src/app-navigation.ts:204`). Verdicts:

| route | verdict | note |
|---|---|---|
| `profile` | **KEEP — and extend** | the natural home for the Psyntient.io account (see below) |
| `appearance` | **KEEP** | theme + text size; our Psyntient theme lives here |
| `config` | **KEEP, trim** | general prefs |
| `notifications` | **KEEP** | real value for a desktop app |
| `connection` | **KEEP** | gateway URL/token |
| `model-providers` | **KEEP** | this is the **API key** surface the user requires in Settings |
| `mcp` | **KEEP (evaluate)** | MCP servers are genuinely useful for a research Node — extra tools without our code |
| `security` | **KEEP, trim** | |
| `about` | **KEEP, trim** | Psyntient about box |
| `custodian` | drop | infra babysitting |
| `channels` / `communications` | hide | product decision, code stays |
| `nodes` | drop | remote fleet |
| `agents` / `ai-agents` | drop | Psyntient runs one agent |
| `labs` / `automation` | drop | |
| `approvals` | drop | tied to exec tools we disable |
| `infrastructure` / `advanced` / `debug` / `logs` | drop | operator surfaces |

**Do NOT build our own usage/token view.** OpenClaw's `usage` page already
does this. The plan at `~/.claude/plans/swirling-munching-glade.md` (model +
token display for WebClaw) is **superseded** — do not implement it here.

### Psyntient.io account in Settings (user's idea, worth doing)

Put the real pairing state on the `profile` page as a "Psyntient Account"
section: paired/unpaired, `node_id`, `context_id`, `paired_at`, and a link out
to psyntient.io. Data comes from the Stage 2 route
`/__openclaw__/psyntient/pairing` (GET returns `isPaired`), backed by
`daemon/pairing.mjs` which reads `~/.psyntient/node.key`.

Constraint from `CLAUDE.md`: pairing and the LLM key stay **decoupled** — a
bad API key must never surface as an account/pairing problem, and vice versa.
Two separate sections, two separate error states.

### PWA install

Must live in Settings. No OpenClaw equivalent — this is a genuine port from
WebClaw (`install-banner.tsx`, `screens/onboarding/install-step.tsx`). Ties
into the unresolved **PWA origin change** in `PATH_C_DASHBOARD_FORK.md`:
whatever we build should install from whichever origin ends up serving the
Interface.

## 4. Sequencing

1. **Nav prune** — hide the drop-list routes. Cheapest, biggest immediate
   change in feel, fully reversible.
2. **Rename** Sessions → Projects (strings only, 21 locales).
3. **Elf avatar** in `chat-avatar.ts` — self-contained, high brand value.
4. **Suggestion chips** — small, helps first-run comprehension.
5. **Settings trim** + Psyntient sections (needs Stage 2 routes live).
6. **Vault badge** (needs Stage 2 vault route).
7. **Projects view** + wire `working-memory.mjs` for real.
8. **Usage view** — adopt OpenClaw's `usage` page instead of building ours.

Steps 1-4 need no backend work and can land immediately. Steps 5-7 depend on
the Stage 2 plugin routes, which are written but not yet loading (the shim
path fix is in `psyntient-routes.ts` and needs a rebuild).

## 6. Open considerations (raised 2026-08-27, decide after the first pass)

Not decisions yet. Each is a genuine product fork in the road.

### Multi-agent instances — powerful, but a complexity cliff

The Control UI can create and manage **separate agent instances** (`pages/agents`,
20 files). For researchers this is real capability: one agent per project or
per line of inquiry, each with its own workspace, memory and model. Psyntient
currently ships one agent (`Cortex_Agent`).

The tension the user named: it could overwhelm non-developer users. Options,
roughly in order of increasing ambition:

1. **Hide it** (current plan). One agent, no concept to learn.
2. **Expose it renamed** — surface agents as "Research Contexts" or similar,
   with a sane default, so the power is there without the operator framing.
3. **Derive it** — create an agent implicitly when a Project is created, so
   users get isolation without ever seeing an "agents" concept.

Option 3 is the most Psyntient-shaped and the most work. **Note:** each extra
agent has a real cost — this is the same machinery whose plugin loading cost
~22s per cold run, so per-agent isolation is not free.

### Session sharing / multi-researcher on one Node — real, and unexplored

`src/gateway/session-sharing.ts` is real: `resolveSessionVisibility`,
`allowedSessionVisibilities`, `isSessionVisibilityAllowed`,
`resolveSessionSharingTarget`, plus `isGatewayAdmin`. Sessions have a
**visibility** model and a sharing target. Combined with thread branching
(`sessions.branches.list`), the shape the user spotted is genuinely there:
**multiple researchers collaborating on one Node.**

Unanswered and load-bearing before any of this ships:
- How does a second person authenticate? Today the Control UI is a single
  device-bound admin token (`openclaw dashboard` mints a per-browser link).
  Multi-user needs an identity model we do not have.
- How does it interact with **psyntient.io pairing**, which is per-Node and
  will gate subscription? Is a shared Node one seat or many?
- Sovereignty: `CLAUDE.md` section 8 is emphatic that Vault contents never
  leave the Node. Sharing sessions across people is a different boundary than
  sharing across devices — think it through before enabling.

**Do not enable sharing by default** until those are answered.

### Automations and plugins — recommendation: drop automations, keep plugins as config

- **`automation`** — drop. It is scheduled/triggered agent runs, an operator
  feature, and overlaps `cron` which is already dropped.
- **`plugins` / `plugin` pages** — drop the *management UI*, but plugins
  themselves are now load-bearing: the `plugins.allow` list is what made the
  Node fast. That belongs in config, not a browsable catalog. If users ever
  need to toggle capability, expose a small curated "Capabilities" section in
  Settings rather than OpenClaw's full plugin manager.
- **`mcp`** — keep (see 3b). It is the one extension surface that adds real
  research capability without us writing code.

## 5. Rules carried over

- Every change to `ui/` grows the re-apply surface on OpenClaw updates. The
  current surface is 10 files (see `PATH_C_DASHBOARD_FORK.md` Stage 1).
  Prefer config/nav changes over code edits where both work.
- Do not reimplement anything OpenClaw already does (voice input,
  provider-key setup, usage, model catalog).
- Branding: **Psyntient Node** is the product; *Noetic Interface* is the
  internal component name and must not appear in user-facing strings.
