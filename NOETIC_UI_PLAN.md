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

### Projects sit ABOVE threads — correcting §2 of this plan

`CLAUDE.md` §9 already defines the hierarchy and it is **not** "Projects =
renamed sessions". The earlier recommendation in §2 of this file was wrong
against the designed model:

```
Project (cortex_projects/<project_id>/)      <- Vault-backed, durable
  notes.md, scratch/, logs/
  syncs to Neural_Vault/Devices/<device>/<project_id>/
  └── chat threads (chat_context/<thread_id>/)   <- session transcripts
```

A **Project** is the durable research unit with a Vault lifecycle (create ->
scaffold -> work -> sync to Vault -> erase working copy). **Threads** are
conversations inside it. WebClaw only ever had the flat version because the
Project machinery in `daemon/working-memory.mjs` has no UI caller yet.

So the sidebar should be **two levels**: Projects, expanding to their threads.
Do not ship the flat rename as the final model — it is fine as an interim
label, but the nesting is the design.

### Node Teams — session sharing becomes a paid tier (decided 2026-08-27)

Multi-researcher sharing is a **subscription tier**, not a free capability:
higher tier = **Node Teams (multi-seat)**. This resolves the seat question
cleanly — psyntient.io owns entitlement, and the Node already asks it.

`daemon/heartbeat-loop.mjs` ticks `heartbeat()` every 5 minutes against
`psyntient.io/api/public/nodes/heartbeat`, so the entitlement channel exists
today. Gate sharing on the heartbeat response.

Two constraints that still stand:
- **Second-user identity is still unbuilt.** Today the Control UI is a single
  device-bound admin token per browser. Tier entitlement says *whether* a Node
  may have seats; it does not say *who* the second person is. That is Plane C
  (`/pair-interface`, `noetic_session`) in `daemon/docs/AUTH_FLOW.md`, still
  not built.
- **Vault sovereignty is unchanged.** Sharing sessions across *people* is a
  different boundary than across devices. Nothing about a paid tier changes
  `CLAUDE.md` §8 — psyntient.io still never learns where a Vault lives or what
  is in it.

### Multi-agent instances — cheaper than first assessed

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

Option 3 is the most Psyntient-shaped and the most work.

**Correction to the earlier cost warning.** That caution was based on the
~22s cold-run figure — measured *before* the `plugins.allow` fix. Actual cost
of an additional agent, measured:

- **448 KB** of disk for a second agent (`agents/agent/`), against 89 MB for
  the accumulated `agents/main/`
- **~1.2s** cold pre-model time now, not 22s

So per-agent isolation is **materially affordable**. The real costs are
conceptual (a second thing to understand) and state sprawl over time, not
latency.

**Creating an instance needs no identity — confirmed.** `openclaw agents add
[name]` takes an *optional* name, and `--non-interactive` requires only
`--workspace`. Model and everything else inherit `agents.defaults`. A "New
Project" button could create an instance silently; the user never meets an
"agent" concept or names one. That was the user's main worry and it does not
apply.

**The real catch: agent identity is workspace-relative.** `AGENTS.md`,
`SOUL.md`, `MEMORY.md` and `CAPABILITIES.md` live inside
`Cortex/Cortex_Agent/`. Point a per-Project agent at its own workspace
directory and it inherits none of them — it is a blank agent, not Cortex.
That is the opposite of the intent ("they should all be Cortex agent, but
different instances").

So the work is **persona coherence across instances**, not disk or latency.
Options, unevaluated:
1. Scaffold each Project workspace with the Cortex identity files (copy on
   create; they then drift per project — possibly desirable for MEMORY.md,
   definitely not for SOUL.md).
2. Keep one shared identity directory and give each Project only its own
   memory/scratch (needs OpenClaw to support split identity vs. state, which
   is unverified).
3. Do not create agents at all — one Cortex, with memory scoped per Project.
   Cheapest if `memory-core` supports it.

**Projects must map to real Vault projects.** A Project is not merely an agent
instance: it is `cortex_projects/<project_id>/` with the Vault lifecycle in
`daemon/working-memory.mjs`, created by Cortex with the user or added
programmatically later. Whatever agent model is chosen, the Project record is
the durable thing and the agent instance is an implementation detail hanging
off it — never the reverse.

**Opinion, asked for 2026-08-27:** worth it for a research lab, as an
**opt-in toggle, default off**.

- The value is not speed, it is **memory isolation** — findings from one line
  of inquiry not bleeding into another. For research integrity that is
  substantive, not cosmetic, and it is exactly what a lab with several
  parallel projects would want.
- Default *on* would be wrong: it multiplies state and creates a confusing
  failure mode ("why doesn't it remember what I told it last week?") for the
  single-project user who never asked for isolation.
- **Try the cheaper path first:** if `memory-core` supports per-session or
  per-project scoping, isolation may be achievable inside one agent, with no
  agent multiplication at all. Verify that before building per-Project agents
  — it could make the whole question moot.
- If built: bind it to Project creation (option 3), never expose an "agents"
  concept, and make the toggle a property of the Project.

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

## 7. RESEARCH TASK — "Project = agent instance" (queued, after Stages 2-4)

User framing 2026-08-27, worth quoting because it is the target UX:

> "When I click on New Agent it brings me to a page which offers me the
> ability to manually edit soul.md and other identity files for the new agent.
> That is not what we would want. We would want **1 click, 1 new instance,
> same identity**."

And the payoff: *"a different agent per project... would create a very good
organization (different context, different chat threads). Kind of analogous to
Slack channels."*

That analogy is the right one — a Project is a **channel**: its own context,
its own threads, one shared persona across all of them.

### What is already known (do not re-derive)

- Creating an instance needs **no identity**: `agents add [name]` takes an
  optional name and `--non-interactive` needs only `--workspace`.
- Cost is small: **448 KB** disk, **~1.2s** cold pre-model after the
  `plugins.allow` fix.
- **The blocker is that identity is workspace-relative.** `SOUL.md`,
  `AGENTS.md`, `MEMORY.md`, `CAPABILITIES.md` live in the workspace, so a new
  workspace = a blank agent. OpenClaw's own New Agent page exposes editing
  those files, which is exactly the flow to avoid.

### The research question

**Can one identity be shared across many agent instances, with only
memory/context per instance?** Specifically:

1. Does OpenClaw separate *identity* (SOUL/AGENTS/CAPABILITIES) from *state*
   (MEMORY, sessions, scratch), or is the workspace the only unit?
2. If not separable: is scaffolding a project workspace from a Cortex template
   acceptable? Which files should be copied (per-project MEMORY.md is arguably
   *desirable*) versus shared/symlinked (SOUL.md must never drift)?
3. Does `memory-core` support per-session or per-project scoping? **Check this
   first** — if yes, one Cortex with scoped memory delivers the organization
   benefit with no agent multiplication and no persona problem at all.
4. What does `agents.create` do with `agents.defaults.workspace` — inherit,
   or require an override?

### Constraints on any answer

- One click. No identity editor, no naming step, no file authoring.
- All instances are **Cortex**. Same soul, same capabilities.
- The Vault-backed Project record (`cortex_projects/<id>/`) stays the durable
  thing; the agent instance hangs off it, never the reverse.

## 5. Rules carried over

- Every change to `ui/` grows the re-apply surface on OpenClaw updates. The
  current surface is 10 files (see `PATH_C_DASHBOARD_FORK.md` Stage 1).
  Prefer config/nav changes over code edits where both work.
- Do not reimplement anything OpenClaw already does (voice input,
  provider-key setup, usage, model catalog).
- Branding: **Psyntient Node** is the product; *Noetic Interface* is the
  internal component name and must not appear in user-facing strings.
