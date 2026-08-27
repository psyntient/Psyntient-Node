# Project = Agent — research findings

Researched 2026-08-27 against the pinned OpenClaw checkout. **Conclusion: it
is achievable, the mechanism already exists in OpenClaw, and the shape is a
symlinked workspace.** Details below are read from source and verified on
disk, not inferred.

Target UX (user's words): *"1 click, 1 new instance, same identity"* — and
Projects behaving like Slack channels: own context, own threads, one shared
persona.

---

## 1. The finding that makes it work: workspace and agentDir are separate

`createAgent()` (`src/agents/agent-create.ts:119`) takes **`workspace` and
`agentDir` as independent parameters**:

```
const requestedWorkspace = params.entry?.workspace ?? params.workspace;
const requestedAgentDir  = params.entry?.agentDir  ?? params.agentDir;
```

Verified on disk what each actually holds:

| | path | contents |
|---|---|---|
| **workspace** | `Cortex/Cortex_Agent/` | `SOUL.md`, `AGENTS.md`, `IDENTITY.md`, `CAPABILITIES.md`, `TOOLS.md`, `USER.md`, **`MEMORY.md`**, `memory/`, `research/`, `skills/` |
| **agentDir** | `~/.psyntient/openclaw-state/agents/main/agent/` | `openclaw-agent.sqlite` only — sessions, auth, state |

**The complication:** persona *and* memory both live in the workspace. So the
obvious approach — many agents, one shared workspace — gives one persona but
**no memory isolation**, which is the opposite of what Projects need.

## 2. Memory is workspace-scoped, not agent-scoped

Counted references in the built `memory-core` plugin:

```
workspaceDir  67
workspaceRoot  7
workspace      3
agentDir       3
```

and it indexes `MEMORY.md` and `memory/`. **Memory follows the workspace.**
This is the single fact that decides the architecture: to isolate memory per
Project, each Project needs its own workspace directory.

## 3. The answer: per-Project workspace with symlinked identity

```
Neural_Vault/Projects/<project_id>/          <- the Project's workspace
├── SOUL.md          -> ../../Cortex_Agent/SOUL.md          (symlink, shared)
├── AGENTS.md        -> ../../Cortex_Agent/AGENTS.md        (symlink, shared)
├── IDENTITY.md                                 REAL — this Project's nameplate
├── CAPABILITIES.md  -> ../../Cortex_Agent/CAPABILITIES.md  (symlink, shared)
├── TOOLS.md         -> ../../Cortex_Agent/TOOLS.md         (symlink, shared)
├── USER.md          -> ../../Cortex_Agent/USER.md          (symlink, shared)
├── skills/          -> ../../Cortex_Agent/skills/          (symlink, shared)
├── MEMORY.md                                   REAL — this Project's memory
├── memory/                                     REAL — this Project's logs
└── notes.md, scratch/, logs/                   the Vault project lifecycle
```

Identity cannot drift, because it is literally the same file. Memory is
genuinely separate. That is exactly the Slack-channel model: one Cortex, many
channels, each with its own context.

### Verified, not assumed

- **OpenClaw accepts symlinks in a workspace.** `src/agents/workspace.ts:1070`
  explicitly tests `entry.isFile() || entry.isSymbolicLink()`.
- **Identity loading follows symlinks and is READ-ONLY.**
  `loadIdentityFromFile()` (`src/agents/identity-file.ts:256`) does
  `fs.realpathSync(identityPath)` then `readRegularFileSync`. Nothing writes
  back through the link during load.
- **Scaffolded and read it for real** (scratchpad):
  `realpath IDENTITY.md -> Cortex_Agent/IDENTITY.md`, content reads through,
  `statSync().isFile() === true`, `lstatSync().isSymbolicLink() === true`,
  and the Project's `MEMORY.md` is confirmed a different inode from the
  shared one.
- **OpenClaw already expects overlapping workspaces.**
  `src/agents/agent-delete-safety.ts` exists solely for *"deleting agents
  whose workspaces may overlap other agents"* — `workspacePathsOverlap()` and
  `findOverlappingWorkspaceAgentIds()`. This pattern is anticipated upstream,
  not fought.

## 4. Cost, measured

- **448 KB** disk for an additional agentDir
- **~1.2s** cold pre-model time after the `plugins.allow` fix (was 22s before)
- Creating one needs **no identity input**: `agents add [name]` takes an
  optional name, and `--non-interactive` requires only `--workspace`

So "1 click, 1 new instance" is genuinely cheap.

## 5. Open risks — resolve before building

1. ~~`createAgent` writes an identity file into the workspace.~~
   **RESOLVED, and it makes the design better.**

   `DEFAULT_IDENTITY_FILENAME = "IDENTITY.md"` (`src/agents/workspace.ts:49`),
   and `createAgent` does write it. But OpenClaw's safe-fs layer **refuses to
   write or delete through a symlink**: `src/infra/fs-safe.ts:86` checks
   `!stat.isSymbolicLink()`, and `src/infra/fs-safe-remove.ts:70` throws
   `symlink not allowed`. A write through a symlinked identity fails loudly as
   `unsafe-identity-file` rather than silently mutating the shared persona.

   **So: do NOT symlink `IDENTITY.md`. Give each Project a real one.** That is
   the right split anyway — `IDENTITY.md` is the *nameplate* (name, emoji,
   avatar), which each Project legitimately wants its own of, while `SOUL.md`
   is the *persona*, which must never diverge.

   The refusal is a safety feature for this design: a Project cannot corrupt
   the shared Cortex persona even by accident, because the filesystem layer
   will not let it.

   **Corrected layout:** symlink `SOUL.md`, `AGENTS.md`, `CAPABILITIES.md`,
   `TOOLS.md`, `USER.md`, `skills/`. Keep `IDENTITY.md`, `MEMORY.md`,
   `memory/` real and per-Project.
2. **Vault sync interaction.** `daemon/working-memory.mjs` syncs a project to
   `Neural_Vault/Devices/<device>/<project_id>/`. If the workspace contains
   symlinks, decide explicitly whether sync follows them (would duplicate the
   persona into every project's Vault copy — almost certainly wrong) or
   skips them.
3. **Windows.** Symlinks need developer mode or elevation on Windows. A
   cross-platform fallback (copy-on-create, or a pointer file) is needed
   before shipping beyond macOS/Linux.
4. **`skills/` sharing** is assumed desirable — one Cortex, one skill set. If
   per-project skills are ever wanted, that link becomes a real directory.

## 6. The selector already exists

`components/agent-select.ts` (`openclaw-agent-select`) is the existing agent
switcher. Under this model it becomes the **Projects selector** unchanged —
same control, different noun. No new navigation model to design.

## 7. Recommended build order

1. **Test risk #1** — find `DEFAULT_IDENTITY_FILENAME`, create an agent against
   a symlinked workspace, and confirm the shared identity is not mutated.
2. Extend `daemon/working-memory.mjs`'s `createProject()` to scaffold the
   symlinked workspace above.
3. Create the agent as part of project creation (`agentDir` under the state
   dir, `workspace` = the project dir). No naming step, no identity editor.
4. Surface Projects with `openclaw-agent-select`, relabelled.
5. Only then decide whether to unhide OpenClaw's `agents` settings route —
   probably not; Projects should be the only presentation.

## 8. What this does NOT need

- No fork of OpenClaw's agent system
- No changes to `daemon/pairing.mjs` or the auth protocol
- No new selector component
- No per-project identity authoring — the thing the user explicitly does not
  want is simply never built
