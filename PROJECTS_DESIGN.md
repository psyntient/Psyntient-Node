# Projects — the Slack model, without multi-agent

Decided 2026-08-27 after the Project = Agent research
(`PROJECT_AS_AGENT_RESEARCH.md`). **Projects are a scope over threads plus a
Vault-backed record — not separate agents.**

## Why not agents

The research established that separate agents were only ever needed to
isolate *memory*, because memory is `workspaceDir`-scoped. The user's
clarification — *"its ok for memory to be shared, in fact good, in case a
researcher wants to access data from other chats"* — removes that
requirement, and with it every hard part: symlinked workspaces, persona
drift, Windows symlink permissions, `IDENTITY.md` write conflicts.

The other two stated requirements are already met without agents:

| requirement | already satisfied by |
|---|---|
| distinct chat context per Project | sessions — each has its own transcript, window, compaction |
| simultaneous processing across Projects | per-session locks: `${sessionFile}.lock`, one per transcript. No per-agent run mutex exists, and `sessions_spawn(mode:"run")` already runs async within one agent |
| shared memory / Vault | the default — one workspace |

What separate agents would still buy: per-Project **model**, per-Project
**tool policy**, per-Project **channel bindings** (e.g. Telegram routed to one
Project). None are currently wanted. If they become wanted, the research
document has the full mechanism.

## The interaction

> "When you select a project, the UI displays chat threads related to that
> project. When you select another project, you see the chat threads related
> to that other project."

A **scope filter**, not a section list — Slack's workspace switcher rather
than its channel list. One Project active at a time; the sidebar shows only
its threads.

```
┌──────────────────────────┐
│  ⌄  Thesis Chapter 3     │   <- Project selector (replaces the agent chip)
├──────────────────────────┤
│  PAGES                   │
│    Home                  │
│  THREADS                 │      only this Project's threads
│    Literature review     │
│    Method notes          │
│    Reviewer replies      │
├──────────────────────────┤
│  ◦ Local Vault           │
│  AC Account              │
└──────────────────────────┘
```

## How it maps onto what already exists

Nothing here needs new infrastructure. Every piece is an existing seam:

| need | existing mechanism |
|---|---|
| Project = named container of threads | `row.category` — already on every session row (`lib/sessions/grouping.ts:81`) |
| assign a thread to a Project | `assignCategory()` -> `sessions.patch({ category })` (`pages/sessions/sessions-page.ts:844`) |
| **scope the sidebar to one Project** | `selectedAgentSessionRows()` (`app-sidebar-session-navigation.ts:519`) already filters rows before rendering, via `filterVisibleSessionRows(rows, {...})`. Add a category predicate. |
| the selector control | `openclaw-agent-select` (`components/agent-select.ts`) — same control, relabelled, sitting where the agent chip is now |
| durable Project record | `daemon/working-memory.mjs` `createProject()` / `syncProjectToVault()` / `getProjectStatus()` — built and CLI-tested, **no UI caller yet** |

## Build order

1. **Project store.** A Project is `cortex_projects/<project_id>/` (the Vault
   record) whose `project_id` is also the session `category` string. One
   identifier, two representations — do not invent a second mapping table.
2. **Plugin route** `/__openclaw__/psyntient/projects`:
   `GET` list, `POST` create. Wraps the existing `working-memory.mjs`
   functions, which finally gives them the caller they have lacked.
3. **Selector.** Reuse `openclaw-agent-select` in the sidebar header. Its
   items become Projects; a "New Project" item calls `POST`.
4. **Scope the list.** Extend `selectedAgentSessionRows()` with a category
   filter driven by the selected Project.
5. **Inherit on create.** A thread started while a Project is active is
   patched with that `category` immediately, so it lands in the right place
   without the user filing it.
6. **A Default Project**, created on first run. See below.

## The Default Project

A real Project, not a pseudo-scope: general chat, ideas, personal use — the
`#general` of the Node. Better than the "All threads" filter this document
originally proposed, because it means casual thinking still gets a Vault
record and can be synced, searched and kept like anything else. Nothing a
researcher types is stranded outside the Vault.

**Verified 2026-08-27: one does not exist today.** `Working_Memory/cortex_projects/`
is empty and `Neural_Vault/local/Devices/<device>/` is empty — the Vault
scaffolds the *structure* but has never created a project, because
`createProject()` still has no caller. Meanwhile `chat_context/` already holds
**30 thread mirrors**, so every existing thread is currently project-less.

Requirements:

- Created on first run if absent, by the same `createProject()` everything
  else uses — no special-cased second path.
- **Existing uncategorised threads belong to it** by resolution, not by
  migration: a row with no `category` resolves to the Default Project rather
  than being patched. That keeps the 30 existing threads visible with no
  rewrite, and means a thread never has to be "filed" to be reachable.
- Cannot be deleted. Deleting other Projects unfiles their threads back to it.
- Its `project_id` should be a stable reserved string (e.g. `default`) so the
  resolution rule above is a constant, not a lookup.

## Decisions to make before building
- **Does creating a Project create its Vault directory immediately, or lazily
  on first sync?** `createProject()` scaffolds eagerly today.
- **Deleting a Project:** must not delete its threads by default. Recommend
  unfiling them to "All threads" and leaving the Vault copy intact — the Vault
  record is the durable artefact, per CLAUDE.md section 9.

## What this explicitly does NOT do

- No new agents, no `agents` settings route, no identity editor
- No symlinked workspaces
- No change to memory scoping — it stays shared, deliberately
- No new selector component
