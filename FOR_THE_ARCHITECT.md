# Node → Archive sync: how the Node side now works, and what it needs from you

From the Psyntient Node side, 2026-08-28. Written after reading the live API
(`/api/v1/openapi.json`), `Ingestion_Queue/README.md`,
`ARCHITECT_RELEASE_CONTRACT.md`, and `ingestion_tools/` on the droplet.

Nothing here changes your code. It is (1) what the Node now guarantees, (2) a
proposed division of labour for raw→packet conversion, and (3) four concrete
asks, three of which are things your own release contract already requires.

---

## 1. What the Node now guarantees

**Every project declares its data types at creation.** A closed vocabulary,
validated, drawn from what psyntient.io/archive says the Archive accepts:
`eeg, fmri, mri, fnirs, meg, ecog, bci, hrv, eda, eye-tracking,
motion-capture`, plus `self-report-only` and `none`. Creation fails on an empty
or unknown value.

That declaration **is** the eligibility decision. A project declaring no
instrument record can never submit, because a report alone is not a packet.
Most projects are legitimately `none` — planning, reading, analysis.

**Only `sessions/` is ever submitted.** A project also holds `notes.md`,
`citations/`, `scratch/` and `logs/`, and chat transcripts live outside the
project entirely. None of those are ever candidates for submission, so there is
no per-item judgement to get wrong at contribution time. You will never receive
a chat transcript from a Node.

**A ledger indexes what is submittable** (`daemon/vault-ledger.mjs`). It
classifies each file in `sessions/` as packet-shaped or not, so "this project
has data" and "this project has something you would accept" are distinct. It is
derived from disk on every read, never authoritative.

**Nothing is ever pushed without consent.** Auto-sync is being added as an
explicit, default-off, per-project toggle. It changes who initiates a
submission, not whether the user agreed to it.

---

## 2. The question your ingestion tools raise: where does conversion happen?

`ingestion_tools/README.md` describes producer-side tools that turn raw device
recordings into v1 Session Packets, and says of each modality's feature set:

> "this is the Archive's formal methodological commitment for that modality"

That sentence is the whole design constraint, and it cuts against putting
conversion wherever is convenient.

### Recommendation: convert on the Node, never upload raw

**Volume.** An hour of EEG is hundreds of megabytes. Its feature packet —
band powers, IAF, frontal alpha asymmetry — is kilobytes. Across "all Nodes and
other apps", that is the difference between terabytes and gigabytes of
ingestion traffic and storage. Converting at the edge is the only version of
this that scales.

**Privacy.** Raw neural signal is far more identifiable than summary features.
Keeping raw in the user's Vault and shipping only derived features is the same
sovereignty property that governs BYO keys and vault location. It also means a
Node can contribute without ever handing you a recording it cannot take back.

**Cost.** Conversion CPU distributes across Nodes instead of concentrating on
the droplet, which matters most exactly when the queue is busiest.

### But this breaks unless the methodology is versioned

If Node A runs one pipeline and Node B runs another, their packets are not
comparable, and "standardized neurophenomenological datasets" stops being true.
Today's packet carries `schema_version: 1`, which versions the *shape* but not
the *method* — two packets with identical shape can have incomparable
`summary_features`.

**Ask: add a `pipeline_version` (or `feature_spec_version`) per modality**,
distinct from `schema_version`, and publish the current value. Then:

- The Node stamps every packet with the pipeline version it used.
- You reject or quarantine packets from unknown or retired pipelines instead of
  silently mixing methodologies.
- When you change feature extraction, you bump it, and stale Nodes fail loudly
  rather than contributing quietly-wrong data.

Without this, edge conversion is a slow-motion data-quality incident. With it,
it is just a distributed build with a pinned toolchain.

### What that implies for `ingestion_tools/`

They stay yours and stay canonical. What the Node needs is not a copy of them
but a **published spec per modality**: input formats, preprocessing steps,
feature list, and the version. The Node implements to that spec, stamps the
version, and you enforce it. Your README already documents exactly this for
EEG — it just needs a version number and a machine-readable form.

If you would rather not maintain that boundary, the alternative is a
server-side conversion endpoint that accepts raw uploads. It is simpler to keep
correct and much more expensive to run, and it puts raw recordings on your disk.
I would not choose it, but the decision is yours and the Node can target either.

---

## 3. The queue will not survive its own success as a directory

`Ingestion_Queue/pending/<submission_id>.json`, one file per submission, shared
by every Node and Marketplace app. Four problems that only appear at scale, all
cheap to fix now and expensive later:

**Sharding.** A single directory holding millions of files makes every
listing O(n) and slows the filesystem itself. Shard by date or by the first
bytes of the submission id (`pending/2026-08-28/`, or `pending/a3/`) before it
matters, not after.

**Idempotency.** Nodes retry on network failure — that is not a bug, it is what
a reliable client does. Today a retry creates a second queue entry for the same
`session_id`, and you get duplicates that look like independent evidence, which
is worse than a dropped submission. **Ask: accept an idempotency key** (the
`session_id` is a natural one) and return the original `submission_id` on a
repeat rather than queueing again.

**Batching.** One packet per POST is fine for a live capture and wasteful for a
Node syncing a backlog. A batch endpoint returning per-item results would cut
request volume substantially. Not urgent; worth designing before it is.

**Backpressure.** There is no way for the Node to learn the queue is saturated,
so a busy period turns into a retry storm. Even a `429` with `Retry-After`
would let clients behave.

---

## 3b. Ship an archetype index as a markdown artifact per Edition

**Ask: `release_edition` should emit `ARCHETYPES.md` alongside `manifest.json`
and `INTEGRITY.txt`** — one entry per archetype in the Edition, containing:

```markdown
### Grand Vastness Awe
- id: NA-0012-grand-vastness-awe
- confidence: tentative (1 exemplar)
- family: NA-0026-numinous-encounter        # omit when there is no genus

A breath-catching response to something immense — a landscape, a starry sky,
the scale of time or nature. The self feels small but not diminished...
```

### Why this shape

It makes **coarse-to-fine retrieval** possible, which is what a growing
taxonomy needs. The Node reasons over this one file to shortlist candidates,
then pulls full records for only those ids, and narrows again if needed. It
never has to hold the whole Archive to answer "what is the thing I
experienced?"

**Markdown rather than JSON, deliberately.** The consumer is a language model,
and markdown carries the same content in meaningfully fewer tokens than JSON
(no repeated keys, braces or quotes) — measured at ~10.0 KB slim JSON versus
~7 KB markdown for the current 26 archetypes. That saving lands on every
search, not just once.

**Include the `id`.** Title and description alone force the Node to map names
back to ids before it can fetch full records, and names are exactly what a
living taxonomy renames. The id makes the second stage exact.

**Include confidence and family.** Both are one line and both are things a
researcher filters on — "which of these are actually well supported", "what
else is in this family" — and having them in the cheap stage avoids fetching
full records just to discard them.

### Why this is the right unit to version

It is derived from the Edition, so it should be *generated* by `release.py`
rather than maintained, ship inside `editions/<edition_id>/`, and be covered by
`INTEGRITY.txt` like everything else. Then a Node can cache it keyed to
`edition_id` and know exactly when the cache is stale — which matters because
archetypes get renamed and merged between Editions, and a stale index would
produce confident answers naming archetypes that no longer exist.

### The honest ceiling

This does not remove the need for server-side semantic search; it defers it.
At ~385 bytes per archetype, this artifact stays context-sized to roughly
500–1,000 archetypes. Beyond that even titles and descriptions stop fitting,
and the answer becomes embeddings in the API — which the whitepaper already
reserves space for in Layer 4 (`manifold_coordinates`, `dimensions`, "largely
empty in Edition 002"). This design buys one to two orders of magnitude of
headroom cheaply, and should be understood as the bridge rather than the
destination.

## 4. Concrete asks, in priority order

1. **Ship the complete edition directory.** `release.py` already produces
   `packets/`, `mappings.jsonl`, `edition.sqlite`, `manifest.json` and
   `INTEGRITY.txt`. The published `edition-002-beta-v2-schema` contains only
   `archetypes/` and `generalized/` — 38 files — which is why the API serves 25
   archetypes and **0 packets**. Your own contract's "What went wrong" section
   already documents this.
2. **Expose the manifest through `/api/v1/meta`** — at minimum `git_commit`,
   `edition_number` and `integrity_sha256`. Right now `/meta` returns an
   `edition_id` and three counts, so a Node can cite an Edition by name but
   cannot resolve that citation back to an exact Git tag. Reproducibility
   *against the exact Edition that produced a claim* is the Archive's own
   stated property, and it currently cannot be exercised from outside.
3. **Emit `ARCHETYPES.md` per Edition** (section 3b) — cheapest of these to
   add, and it unblocks natural-language search over a taxonomy whose names
   researchers cannot be expected to know.
4. **Add `pipeline_version` per modality** (section 2).
5. **Idempotency key on ingest** (section 3).

(1) and (2) also unblock the Node's citation feature, which pins Archive
records into a project so an analysis stays checkable later. They are not
lab-only work.

---

## 5. Things the Node will never do, so you can rely on them

- Never send a chat transcript, note, or scratch file. Only `sessions/`.
- Never send raw recordings unsolicited.
- Never submit without a consent decision recorded for that submission.
- Never mirror the Archive. It traverses and cites; it does not keep a copy.
  A revoked Node loses access on its next call rather than keeping a stale copy
  of a corpus whose consent state has moved on.
