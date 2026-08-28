# CAPABILITIES.md — What You Can Actually Do

Reference for your real capabilities. Check it when unsure what you can do,
rather than guessing or promising something you can't deliver.

**Keep this accurate and short.** Update it when a capability changes. Record
decisions, not narratives — long rationale belongs in git commit messages, not
here. This file is loaded into your system prompt on every single message, so
every paragraph costs latency and money on every turn.

## Chat & Conversation

Baseline conversational ability, no tooling required. Ordinary chat, jokes,
opinions, and creative writing (poems, stories) need **no capability check and
no tools** — just answer.

## Memory

- **`memory_search`** — hybrid FTS5 keyword + vector search over `MEMORY.md`
  and `memory/*.md`. Use before broad file crawls for prior-work questions.
  **Currently degraded:** the local embedding provider (`llama-cpp`) fails to
  load, so semantic/vector search is not actually working — keyword search
  still functions.
- **`MEMORY.md`** — durable decisions, architecture, lessons. Main sessions only.
- **`memory/YYYY-MM-DD.md`** — raw session logs. Periodically fold what matters
  into `MEMORY.md`.
- **Retrieval policy** — the active conversation is primary. Don't search memory
  for ordinary chat answerable from context. Search when the user implies prior
  work ("remember", "continue", "what did we decide", "last time").
- Context continuity is automatic via compaction `memoryFlush`.

## Research Agent

Full workflow: `skills/research-agent/SKILL.md`.

- **Trigger:** explicit request for research, deep analysis, or a multi-session
  investigation. **Not for ordinary questions.**
- **Study planning:** write `plan.md` before analyzing.
- **Protocols:** `research/protocols/<name>.md` — the user's own methodology.
  Ask, don't invent, when none exists.
- **Vault data:** read from whatever `node daemon/vault.mjs status` reports as
  the Vault root (today: local, `Neural_Vault/local/`, empty). Report honestly
  when there's no data.
- **Project lifecycle** (`daemon/working-memory.mjs`, run from Node root):
  `create-project <id> [title] [modality]`, `project-status <id>`,
  `sync-project <id>`, `erase-project <id>` (refuses unless already synced).
- **Model escalation:** `sessions_spawn({ model: "openrouter/auto" })` for
  actual analysis. Check `resolvedModel` — an invalid override fails silently
  into the default.
- **Background analysis:** `sessions_spawn` (`mode="run"`) genuinely runs async.
  No push notification when it finishes — you or the user must check.
- **Charts/figures:** save to a project's `scratch/<file>.png` (or svg/jpg/gif/
  webp/pdf), reference as
  `![...](/api/artifact?project=<id>&file=<file>.png)` to render inline.
  Requires a plotting library actually installed — check, don't assume.

## Documents

All verified working on this Node.

- **Reading attached PDFs** — `document-extract` plugin, already enabled.
- **Summarize/transcribe** PDFs, URLs, videos, articles — `summarize` CLI.
- **Edit an existing PDF** — `nano-pdf edit file.pdf 1 "..."` (editing only).
- **Create polished documents** — `pandoc`:
  - `pandoc report.md -o report.docx`
  - `pandoc report.md --pdf-engine=typst -o report.pdf` (keep `--pdf-engine=typst`;
    the default needs a multi-GB LaTeX install that isn't present)
  Save output into the project's `scratch/`. PDFs/docx don't render inline —
  tell the user where the file landed.
- **Not enabled:** `open-prose` (deliberate — plain chat editing covers this).

## Vault & Storage

`daemon/vault.mjs status` reports storage mode and root path. Local is the
default and only fully-built mode; cloud (Google Drive) is scaffolded, not wired.
Current: local, `Neural_Vault/local/`, empty.

## Working Memory (two separate systems — don't conflate)

- **`Working_Memory/chat_context/<thread_id>/`** — plain-file mirror of chat
  transcripts, synced automatically. Not indexed or searched.
- **`Working_Memory/cortex_projects/<id>/`** — Vault-backed research project
  lifecycle (see Research Agent). This is what the research-agent skill uses.

## Model Tiering (OpenRouter Nodes only)

Ordinary chat defaults to `openrouter/google/gemini-2.5-flash`; the
research-agent skill escalates to `openrouter/auto` per-invocation.

Known constraints, measured:
- Prompt caching **works** (~19.7K tokens cache-read confirmed).
- OpenRouter adds a **~1.2s floor** to every request regardless of prompt size.
- Generation throughput varies widely (42–170 tok/s) across requests.
- `gemini-3.7-flash` was tried and reverted — it's a reasoning model with much
  higher latency, and gave worse instruction-following here.
- `:nitro` routing was tested and made throughput worse.

## Skills

Check a skill's own `SKILL.md` when you need it. Bundled OpenClaw skills live in
`Cortex/Open-Claw/skills/`. Workspace-specific skills (like `research-agent`)
live in `skills/` here, at highest load precedence.

## Noetic Archive

**Live.** `archive.psyntient.io`, reached with this Node's own pairing token.
Four tools, in the order you normally want them:

- **`archive_map`** — the current Edition and the full archetype index (id,
  name, description, exemplar count, confidence tier). Cheap; call it first to
  orient rather than searching blind.
- **`archive_search`** — plain-language search over archetypes and packets.
- **`archive_get`** — one full record by id. Works for archetypes and packets;
  you do not need to know which kind an id is.
- **`archive_pin`** — record what an analysis actually used into a project,
  with the Edition it came from. **Do this whenever a claim rests on Archive
  material.** The Node keeps no copy of the Archive, and the Archive is
  append-only with revocable consent, so re-running the same query later is not
  guaranteed to return the same thing.

### What the Archive currently holds

Edition `edition-002-beta-v2-schema`: 25 species archetypes and **zero
observation packets or mappings**. So archetypes have descriptions, invariants
and neural-signature notes, but no raw evidence attached. Say that plainly if
someone asks what the evidence looks like — do not imply packets exist.

### Taxonomy

Archetypes are primarily **species**. A **genus** groups related species,
either by shared deep structure (Kind A) or as ordered stages of an arc
(Kind B), via a `parent_archetype` field. Most archetypes have no genus in this
Edition. When someone asks about an archetype, offering its family — or saying
there isn't one yet — is a genuinely useful next step.

## Explicitly NOT Available

Described on psyntient.io but not present in this Node. Say so plainly rather
than simulating:

- **Contributing to the Archive** — `sessions/` packets can be submitted, but
  nothing on this Node converts raw recordings into Observation Packets yet, so
  in practice there is usually nothing to send.
- **Node API / "Noetic API"** — separate in-progress effort, out of scope.
- **Entitlement / subscription gating** — nothing gates capabilities by tier.
- **Multi-Node / cross-device sync** — each Node operates independently.
