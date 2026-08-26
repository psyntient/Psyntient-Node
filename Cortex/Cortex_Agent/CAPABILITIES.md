# CAPABILITIES.md - What You Can Actually Do

This is the living reference for your real capabilities: what exists, where it
lives, and when to use it. Check it when you're unsure what you can do, rather
than guessing or promising something you can't deliver.

**Keep this accurate.** Whenever you build, discover, or change a capability (new
skill, script, workflow, config behavior), update this file in the same session.
A stale capabilities doc is worse than none — it actively misleads future-you.

## Chat & Conversation

Baseline conversational ability — no special tooling required. Runs on this
Node's default model (see "Model Tiering" below for what that means on
OpenRouter Nodes).

## Memory

- **Semantic + keyword search** (`memory_search` tool): searches `MEMORY.md` and
  `memory/*.md`, hybrid FTS5 keyword + vector semantic search. Vector search runs
  on a local embedding model (`memory.search.provider: "local"`, via
  `@openclaw/llama-cpp-provider`) — no cloud key required. Use this before broad
  file crawls for any prior-work question.
- **Long-term memory**: `MEMORY.md` — curated decisions, architecture, lessons.
  Read/write freely in main sessions only (never in shared/group contexts).
- **Daily notes**: `memory/YYYY-MM-DD.md` — raw session logs. Periodically fold
  what's worth keeping into `MEMORY.md`.
- **Context continuity**: already handled automatically — compaction
  (`agents.defaults.compaction.memoryFlush`) reminds you to save important notes
  to memory files before the context window fills, so context loss across a long
  session is already mitigated. Nothing to build here; just use memory files
  consistently.

## Research Agent

See `skills/research-agent/SKILL.md` for the full workflow. Summary:

- **Trigger**: explicit user request for research, deep analysis, or a
  multi-session investigation. Not for ordinary questions.
- **Study planning**: write a `plan.md` before analyzing — research question,
  chosen protocol, planned steps.
- **Research protocols**: `research/protocols/<name>.md` — the user's own
  preferred experimental methodology, defined once and reused. Ask, don't invent,
  when none exists yet.
- **Vault data analysis**: the user's actual scientific data, read directly from
  wherever `node daemon/vault.mjs status` reports as the Vault root (today:
  local, `Neural_Vault/local/`, currently empty). No special read API — just
  real files. Report honestly when there's no data to analyze.
- **Project lifecycle** (`daemon/working-memory.mjs`, run from the Node root):
  - `create-project <id> [title] [modality]` — start a new investigation.
    `modality` is a loose tag (e.g. `eeg`, `fmri`, `self-report-only`) for
    projects with an actual dataset — helps pick the right analysis
    approach now, and is forward-compatible groundwork for Archive
    integration later. Not a validated schema; see SKILL.md.
  - `project-status <id>` — check state before assuming.
  - `sync-project <id>` — persist working-copy notes/scratch/logs to
    `Neural_Vault/Devices/<hostname>/<id>/`.
  - `erase-project <id>` — clear the working copy; refuses unless already synced.
- **Model escalation**: `sessions_spawn({ model: "openrouter/auto" })` for the
  actual analysis work, on OpenRouter Nodes. Check the tool result's
  `resolvedModel` — an invalid override fails silently into the default model.
- **Background analysis**: `sessions_spawn` (`mode="run"`) genuinely runs in
  the background — spawn it, then do other/non-overlapping work; the run's
  result returns asynchronously rather than blocking. This is the real
  mechanism behind "go analyze this and write a report" while the user does
  something else, including when this Node runs on a server. There's no
  push notification to the Interface when a spawned run finishes today — the
  user (or you) has to check the project or ask.
- **Chart/figure rendering**: save a generated image (matplotlib/plotly/etc.,
  or MNE-Python for EEG) to a project's `scratch/<file>.png` (or
  `.svg`/`.jpg`/`.gif`/`.webp`/`.pdf`), then reference it in your reply with
  `![...](/api/artifact?project=<id>&file=<file>.png)` — it renders inline
  in the Interface. See `skills/research-agent/SKILL.md`. Requires an actual
  plotting library in whatever Python environment you run scripts in — not
  guaranteed to be installed; check first rather than assuming.

## Documents

Reading, converting, and finishing real document files — reports, papers,
PDFs a user shares. All verified working on this Node (2026-08-24), not
just installed.

- **Reading PDFs the user attaches**: `document-extract` (bundled OpenClaw
  plugin, already enabled — confirmed via `openclaw plugins list`) extracts
  text and fallback page images from PDF attachments automatically. No
  action needed to use it; it's already live.
- **Summarizing/transcribing PDFs, URLs, videos, articles**: the
  `summarize` skill (`summarize` CLI, installed) — "what's this paper
  about," "summarize this article," transcribe a YouTube/podcast link.
  See its own `SKILL.md` in `Cortex/Open-Claw/skills/summarize/`.
- **Editing an existing PDF**: the `nano-pdf` skill (`nano-pdf` CLI,
  installed) — natural-language edits to a specific page
  (`nano-pdf edit file.pdf 1 "..."`). Editing only, not creation from
  scratch — see below for that.
- **Creating a polished document from a markdown report/draft**: `pandoc`
  (installed) converts markdown to real deliverable formats:
  - `pandoc report.md -o report.docx` — real Word doc, works out of the box.
  - `pandoc report.md --pdf-engine=typst -o report.pdf` — real PDF via
    `typst` (installed, lightweight — do **not** drop `--pdf-engine=typst`;
    pandoc's default PDF path needs a full LaTeX install, which isn't
    present and shouldn't be silently installed, it's a multi-GB download).
  This is the actual path from a research project's `notes.md` to a
  deliverable report file — write the markdown, convert with pandoc, save
  the output into the project's `scratch/` (so it can sync to the Vault's
  `exports/` and, if it's an image-renderable type, be referenced via the
  artifact route above — PDFs/docx aren't inline-renderable in chat, so for
  those, tell the user where the file landed instead).
- **Not enabled**: `open-prose` (bundled plugin, `/prose` — a full
  multi-agent orchestration DSL for scripted workflows). Deliberately left
  disabled — real capability, but far more machinery than report writing or
  copy-editing needs; plain chat editing already covers that. Reconsider
  only if a genuinely multi-step, branching writing workflow comes up.

## Vault & Storage

- `daemon/vault.mjs` — `status` reports current storage mode (local/cloud) and
  root path. Local is the default and only fully-built mode today; cloud
  (Google Drive) is scaffolded but not wired up.
- Current state on this Node: local, `Neural_Vault/local/`, empty.

## Working Memory (two separate systems — don't conflate)

- **`Working_Memory/chat_context/<thread_id>/`** — a plain-file mirror of
  WebClaw chat transcripts. Synced automatically by the Interface. Not indexed
  or searched by the memory system above; not relevant to research work.
- **`Working_Memory/cortex_projects/<id>/`** — Vault-backed research project
  lifecycle (see "Research Agent" above). This is what the research-agent skill
  uses; `chat_context/` is not.

## Model Tiering (OpenRouter Nodes only)

If this Node's provider is OpenRouter: ordinary chat defaults to
`openrouter/google/gemini-3.7-flash` — the research-agent skill escalates to
`openrouter/auto` per-invocation for actual analysis work.

**Tried and reverted 2026-08-25: `claude-3-haiku` for cost.** Every message
on this Node reprocesses the full ~20-28K-token system prompt from scratch
with zero prompt-cache reuse (confirmed live, `cacheRead:0, cacheWrite:0`
either way — a real upstream OpenRouter+Anthropic caching regression,
tracked in [openclaw/openclaw#129005](https://github.com/openclaw/openclaw/issues/129005),
not something fixable here). `claude-3-haiku` was tried as a cheaper
per-token match (~0.67x Gemini's pricing), but two real problems followed:
(1) it has no extended-thinking support at all and initially broke every
message until thinking was forced off for that model key, and (2) handing
that large, fully-uncached system prompt to an older/weaker model on every
single turn measurably increased spurious tool-call behavior — caught live
in a real transcript, a plain "write a poem" request triggering an
unwanted tool call. Reverted back to Gemini 3.7 Flash the same day: a cost
optimization isn't worth trading away basic instruction-following.
Revisit only once the caching regression above is fixed upstream, which
would make the whole tiering question moot (cache reuse matters far more
than base per-token price at this system-prompt size).

**This switch is a cost reduction, not a caching fix.** Initially assumed
Claude-via-OpenRouter already gets `cache_control` support "for free" (a
compat-matrix rule exists for it) — but a live two-message-same-session test
with `claude-3-haiku` showed zero cache activity too. Turned out OpenClaw
had this genuinely working before (fixed Feb 2026 in
[openclaw/openclaw#17473](https://github.com/openclaw/openclaw/pull/17473))
and it's since regressed — the wiring still looks present in current source
but empirically doesn't fire. Tracked upstream:
[openclaw/openclaw#129005](https://github.com/openclaw/openclaw/issues/129005)
(retitled after the regression was found). Known tradeoff: Claude 3 Haiku
is an older model generation, chosen for cost-match, not raw capability —
revisit if quality issues show up in practice, and re-check caching once
the upstream regression is fixed.

Non-OpenRouter Nodes: this doesn't apply, the provider's own default model is
used for everything.

## Skills

Skills provide tools beyond baseline chat. Check a skill's own `SKILL.md` when
you need it. Bundled OpenClaw skills (general-purpose: calendar, notes, weather,
GitHub, etc.) live in `Cortex/Open-Claw/skills/` — not enumerated here since
that list isn't Psyntient-specific and changes independently of this workspace.
Workspace-level skills (Psyntient-specific, like `research-agent`) live in
`skills/` right here, at the highest load precedence.

## Explicitly NOT Available

These are described on psyntient.io as part of the broader Psyntient ecosystem
but do not exist in this Node. If asked, say so plainly rather than simulating
them:

- **Noetic Archive** — cross-referencing personal data against shared/archived
  records. The Archive backend is a separate, currently-paused effort on
  infrastructure outside this repo (see root `CLAUDE.md` §10).
- **Observation Packets** — no schema, storage shape, or API exists locally.
- **Node API** (aka "Noetic API")** — the programmatic surface for third-party
  integration. A separate, already-in-progress effort, out of scope here.
- **Entitlement / subscription-tier gating** — no local infrastructure checks
  or gates capabilities by subscription status. Every capability documented
  above is available to any user of this Node, full stop.
- **Multi-Node / cross-device sync** — each Node operates independently; no
  mechanism syncs state across multiple Psyntient Nodes.
