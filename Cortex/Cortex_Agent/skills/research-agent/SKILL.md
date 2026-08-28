---
name: research-agent
description: "Deep research/analysis mode for Cortex — delegates to a heavier model and creates a Vault-backed project. Use only when the user explicitly asks for research, deep analysis, or a multi-session investigation, not for ordinary chat."
---

# Research Agent

Deep-research and scientific-analysis mode. This is the local, buildable slice of
what psyntient.io calls the "Research Agent" — see the "Not available yet" section
below for what's deliberately left out and why.

## When to use this

**Explicit invocation only.** Triggers: "research X," "do a deep analysis of...,"
"look into this properly," "start a project on...," "plan a study for..." Ordinary
substantive questions are still just ordinary chat — this skill is for a distinct,
multi-step investigation the user is knowingly starting, not every hard question.

## Workflow

All commands run from the Node root (`/Users/woodleybrown/Psyntient_Node`), **not**
from `Cortex/Open-Claw/` — `working-memory.mjs` and `vault.mjs` resolve
`Working_Memory/` and `Neural_Vault/` relative to that root.

1. **Start the project.** Every project must declare its **data types** —
   required, not optional, and validated against a closed vocabulary. **Ask
   the user; never guess.**

   ```
   node daemon/working-memory.mjs create-project <project-id> "<title>" <types,comma,separated>
   ```

   Valid values (`DATA_TYPES` in `daemon/working-memory.mjs` is the one
   definition — read it rather than trusting this list if they ever disagree):

   - Recording instruments, any combination: `eeg`, `fmri`, `mri`, `fnirs`,
     `meg`, `ecog`, `bci`, `hrv`, `eda`, `eye-tracking`, `motion-capture`
   - `self-report-only` — first-person reports, no instrument record
   - `none` — planning, reading, analysis of existing work. Cannot be combined
     with anything else.

   **This is the Archive-eligibility decision, not a hint.** A project that
   declares no instrument record can never contribute an Observation Packet,
   because the Archive requires a recording — a report alone is not a packet.
   Most projects are legitimately `none`, and that is a normal answer, not a
   lesser one. Say so plainly when it applies rather than steering the user
   toward a type they do not have.

   Creation fails outright on an empty or unknown type, so a project cannot
   end up silently uncontributable the way every project made before this
   change did.

   Use `node daemon/working-memory.mjs project-status <project-id>` any time you
   need to check state rather than assuming.

2. **Plan before analyzing.** Write `Working_Memory/cortex_projects/<project-id>/plan.md`
   before doing open-ended analysis: the research question, which protocol applies
   (below), and the planned analysis steps. This is a distinct step, not a formality
   — skipping straight to analysis defeats the point of planning.

3. **Find or define the research protocol.** "Analyzing Vault data using your own
   research protocols" is the core of this skill. Check
   `Cortex_Agent/research/protocols/` for an existing named methodology that fits
   this project. If none exists or none matches:
   - Ask the user to describe their preferred experimental methodology for this
     kind of analysis — don't invent one on their behalf.
   - Once they describe it, save it as a new file,
     `research/protocols/<protocol-name>.md`, so it's reusable across future
     projects without re-asking.
   - Reference the protocol (by filename) in this project's `plan.md` and
     `notes.md` so the applied methodology stays traceable later.

4. **Analyze the user's actual Vault data.** Run `node daemon/vault.mjs status`
   immediately to get the real path — **don't guess it via `ls`/`find`.** The Vault
   root is `Neural_Vault/` at the Node root (`/Users/woodleybrown/Psyntient_Node/`),
   a sibling of `Cortex/`, **not** nested under `Cortex/` — a live test of this
   skill wasted several tool calls exploring `Cortex/Vault` and similar wrong
   guesses before running the documented command. Once you have the real path,
   read those files directly — there's no special read API, it's a real directory.
   **If the Vault is empty or doesn't contain what the project needs, say so
   plainly.** Do not fabricate findings or pretend data exists that doesn't.

5. **Delegate the actual analysis work to a heavier model.** Don't do deep analysis
   inline on the default (fast/cheap) chat model — spawn a sub-agent with an
   explicit override:
   ```
   sessions_spawn({
     prompt: "<research task>",
     model: "openrouter/auto",
     taskName: "research: <short label>"
   })
   ```
   `openrouter/auto` (not a newly-pinned model) is the deliberate choice here — see
   `Cortex_Agent/MEMORY.md`'s "Model Tiering" entry for why. **Check the tool
   result's `resolvedModel` field afterward.** An invalid model string is skipped
   *silently* into the default model with only a warning in the result — a
   successful-looking spawn does not by itself prove the override took.

6. **Write findings as you go.**
   - `Working_Memory/cortex_projects/<project-id>/notes.md` — durable narrative:
     what you found, what it means, open questions.
   - `.../scratch/` — work product, exports, intermediate artifacts.
   - `.../logs/` — session logs.
   This is the exact field mapping `syncProjectToVault()` already codes for — don't
   invent a different layout.

   **Charts and other visual output**: if analysis produces a chart, plot,
   or figure (matplotlib/plotly script, or any tool that writes an image
   file), save it into `.../scratch/<filename>.png` (or `.svg`/`.jpg`/`.gif`/
   `.webp`/`.pdf`), then reference it in your chat reply with a normal
   markdown image tag:
   ```
   ![<description>](/api/artifact?project=<project-id>&file=<filename>.png)
   ```
   It renders inline in the Interface automatically — no extra step. This
   only works for the exact filename saved in that project's `scratch/` (or,
   after a sync, the Vault's `exports/`) — don't reference files elsewhere.
   Generating the chart itself needs an actual plotting library (matplotlib,
   plotly, etc., or MNE-Python for EEG-specific plots) available in the
   Python environment you run scripts in — if that's missing, say so and
   offer to help install it rather than silently failing or faking a result.

   **Turning findings into a deliverable report**: write it as markdown in
   `notes.md` (or a dedicated `report.md`) first, then convert with
   `pandoc` — `pandoc report.md -o report.docx` for Word, or
   `pandoc report.md --pdf-engine=typst -o report.pdf` for PDF. See
   CAPABILITIES.md's "Documents" section for the full toolset (reading,
   summarizing, editing, and creating documents) — it's more than just this.

7. **Sync to the Vault at natural checkpoints.**
   ```
   node daemon/working-memory.mjs sync-project <project-id>
   ```
   This is what actually persists the work past a working-copy erase, to
   `Neural_Vault/Devices/<hostname>/<project-id>/`.

8. **Erase the working copy only after a successful sync.**
   ```
   node daemon/working-memory.mjs erase-project <project-id>
   ```
   The function already refuses if `lastSyncedAt` isn't stamped — a real safety
   net, not just a courtesy. Don't work around it.

## Scope note: `cortex_projects/`, never `chat_context/`

`Working_Memory/chat_context/<thread_id>/` is a separate mechanism — a mirror of
WebClaw chat transcripts, unrelated to research artifacts. This skill only ever
reads/writes `cortex_projects/`. Don't conflate the two.

## Archive access, and what is still missing

**Reading the Archive works.** Use `archive_map`, `archive_search` and
`archive_get`, and **`archive_pin` whenever an analysis rests on Archive
material** — the Node keeps no copy, and the Archive is append-only with
revocable consent, so re-running a query later is not guaranteed to return the
same records. A pin writes them into the project with the Edition they came
from, which is what keeps a claim checkable later.

**Cross-referencing personal data against archived records is thin, not
blocked.** The current Edition has 25 archetypes and **zero observation
packets**, so there is nothing yet to correlate a participant's data against.
Say that rather than implying the comparison was run and found nothing.

**Creating Observation Packets is genuinely not built.** Nothing on this Node
converts a raw recording into packet form, so contribution usually has nothing
to send even from an eligible project.

There is no subscription-tier or entitlement gating locally; this skill is
available to any user of this Node once installed, regardless of what the
marketing site's "activates based on subscription tier" language implies.
The data types from step 1 are what decide whether a project could ever
contribute: `archiveEligible` in its `.project.json` is derived from them. The
Archive itself is reachable now (see the `archive_*` tools in
CAPABILITIES.md), but contributing *to* it is not built yet — reading is.

## Primary domain, general-purpose tool

This skill's primary edict is consciousness / neurophenomenological research
— that's what the data-type list above is drawn from, and what to assume when
a request is ambiguous. But the mechanism itself (plan → protocol → analyze →
write up → sync) is general-purpose: use it for any kind of research the user
asks for, not just neuro/consciousness work.
