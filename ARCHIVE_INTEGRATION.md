# Archive integration — how the Node reaches the Noetic Archive

Designed 2026-08-27, grounded in psyntient.io's own published architecture
(`/marketplace`, `/node/interface`, `/archive`) rather than invented here.
Those pages are the product contract; where this document and they disagree,
they win.

## The one structural fact everything follows from

> "Every Application in the Marketplace is either a **Node plugin** (extending
> the Cortex with new capabilities) or a **Node consumer** (calling the Node
> API from the outside). Same architecture, two deployment shapes."
> — psyntient.io/marketplace

and

> "The Node API is the programmatic surface of the Node. Its conversational
> counterpart — the Noetic Interface — is how humans talk to the same Node
> directly. **Both are part of every Node.**"
> — psyntient.io/node/interface

So there is **one** programmatic surface, the Node API. The Node "owns the
connections to the user's Neural Vault and, with consent, the Noetic Archive —
so you never have to." Everything else is a shape on top of it.

**Cortex is not privileged.** It is a consumer of the same Node API a third
party calls. This is not tidiness — it is the enforcement property. Consent,
provenance and auth are enforced at the Node API boundary, so any path that
goes around it is a path around consent. If Cortex talked to the Archive
directly, that boundary would have a hole in it shaped exactly like the
product's most sensitive capability.

## Three consumer classes, not two

The site names three audiences for the Node API, and they want genuinely
different things from the Archive:

| class | what they ask for | shape |
|---|---|---|
| **Researcher via Cortex** | "what does the Archive say about X?" | conversational traversal, small N, cited |
| **App / device developer** | this user's Vault + consented Archive lookups | scoped per-user queries |
| **AI training lab** | "Archive-scale batches ... versioned Editions, calibrated ground truth, and explicit contributor consent" | bulk Edition draw |

The third is not a bigger version of the first. Query and export are different
operations with different failure modes, and conflating them is the main
design risk here.

---

## Q1 — Should the Node download the Archive, or traverse it?

**Traverse. Never mirror.** For the Psyntient Node specifically, four reasons,
in order of how load-bearing they are:

1. **Mirroring defeats revocation.** Archive access is gated per request on an
   active paired Node (`app/auth.py` → psyntient.io's `verify-token`). The
   backend already accepts a 60s cache as a known revocation-latency
   trade-off. A local mirror turns that 60-second window into forever.
2. **Contributor consent is revocable and packets are append-only.** A mirror
   is a frozen copy of consent state. When a contributor withdraws, a
   traversing Node stops seeing the packet on its next call; a mirroring Node
   keeps it and does not know it should not.
3. **It inverts the Vault's meaning.** CLAUDE.md section 8 makes
   `Neural_Vault/` the user's own private data. Dropping a copy of a shared
   corpus inside it means the Vault is no longer purely theirs — a boundary
   worth more than the convenience.
4. **Freshness and size.** The Archive grows with every consented session.

**But traversal alone is not enough, and this is the part that is easy to miss.**
The Archive's whole reproducibility claim is Edition-anchored:

> "any claim the Archive makes can be reproduced against the exact Edition that
> produced it" — psyntient.io/archive

So every Archive read must be **Edition-pinned**, and whatever Cortex actually
used must be **materialised into the project**: the packet ids, the Edition
version, the query, the retrieval timestamp. Not the corpus — the citation and
the specific records the analysis rests on.

That gives the property mirroring was reaching for (an analysis that still
works, and can be re-checked, later) without any of its costs. It is a
bibliography, not a photocopy of the library.

**The AI-lab case is the deliberate exception.** "Pull versioned Editions" is a
real, named capability for labs. That is a bulk Edition draw against a frozen,
citable snapshot — a different operation, different entitlement, different
endpoint (see the gap list below). It is not the researcher Node's path.

## Q2 — Is traversal using a map? Should the Edition carry one?

**Yes, and it should not be invented — the Edition contract already promises
one:**

> "Each Edition is a self-contained, Git-versioned snapshot of canonical
> archetypes and packets **with an accompanying scientific overview**."
> — psyntient.io/archive

That overview is the human-readable map. What is missing is its machine-readable
twin, and the split matters: prose is for the researcher, a manifest is for the
traversal planner. Hand-maintained Markdown as the machine input would drift
from the data it describes on the first Edition where someone forgets.

**Serve both from `/api/v1/meta`, per Edition:**

- `edition` — id, semver, release date, git ref, changelog URL
- `counts` — archetypes, packets, mappings
- `archetypeIndex` — id, name, one-line description, exemplar count, status
  (candidate vs established)
- `modalities` — which instruments are actually represented, and how much
- `schemaVersion` — Observation Packet schema this Edition validates against
- `overviewUrl` — the scientific overview prose

**The archetype index *is* the map.** The Archive is explicitly
archetype-centric — "neural archetypes are the primary semantic objects" — and
the index is small (25 today), stable, and semantically meaningful. Packets are
the volume and the churn. So:

> **Cache the catalogue. Fetch the books.**

Cortex keeps the manifest + archetype index locally (cheap, refreshed on
Edition change, safe to put in context). Packets are traversed on demand,
Edition-pinned. That is the whole efficiency answer, and it needs no new
concept — just `/api/v1/meta` returning more than it does today.

**Ask of the Architect:** `ARCHITECT_RELEASE_CONTRACT.md` already governs what
ships in an Edition. Extend it to require the manifest above as a build
artifact, so it is generated from the Edition rather than written about it.

## Q3 — What functions should Cortex use?

**Not the REST endpoints.** Handing a model eight HTTP routes makes it do query
planning across an API, which is the thing models are worst at, and it burns a
turn per hop. Give it intent-shaped tools instead — few, and named for what the
researcher wants:

| tool | purpose |
|---|---|
| `archive_map()` | Edition manifest + archetype index. Cheap, cached, the orientation call. |
| `archive_search(query, filters)` | Ranked archetypes/packets with ids and snippets. Filters: archetype, modality, date, edition. |
| `archive_get(id)` | One full record — packet or archetype — with its provenance chain. |
| `archive_pin(ids, projectId)` | **The citation step.** Materialises those records plus the Edition version into the project. This is what makes Q1's traversal reproducible. |

`archive_pin` is the non-obvious one and the one to not drop. Without it,
"traverse, don't mirror" quietly means "analyses stop being reproducible."

**Upload is not in this list on purpose.** SOUL.md: uploads happen "always with
the user's explicit consent." Publishing to the Archive must be a confirmed
action with a human in the loop, not a tool the model can decide to call. It
belongs behind the same confirmation as any other outward-facing action.

**Where it lives:** `daemon/archive-client.mjs`, surfaced as agent tools by the
gateway plugin. Daemon-side, not browser-side, because `~/.psyntient/node.key`
is mode 600 and must never reach a web context. This settles the open question
left in `NEXT_SESSION.md` step 5 — it is the daemon, and the Interface reaches
the same client through a plugin route when it needs to render Archive content.

## Q4 — Separate functions for developers?

**No. One Node API, three shapes over it.** The Marketplace line already
decides this: plugin or consumer, same architecture. Two implementations would
drift, and the one Cortex does not use would rot.

The useful invariant:

> **Cortex's tools are built on the Node API, not beside it. If Cortex can do
> something a developer cannot, the API is incomplete.**

What legitimately differs is presentation and entitlement, not capability:

| | agent tools | dev / lab surface |
|---|---|---|
| shape | few, intent-shaped, forgiving | complete, typed, paginated |
| results | summarised to a token budget | exact, lossless |
| auth | the Node's own identity | scoped token the Node issues |
| transport | in-process plugin | HTTP to the local Node |

Note the auth row — the site is specific and it is **not** what the Node does
today: "Every call carries a **scoped access token issued by the user's Node**.
Scopes map to specific packets, sessions, or Vault capabilities, and can be
revoked by the user at any time." That makes the Node a local authorization
server. It does not have one; `node.key` is a single all-or-nothing token.

That is genuinely good design, and worth stating plainly: a third-party app
never holds the user's Archive credential. It holds a scoped, revocable token
minted by the Node, and the Node holds the real one. Third-party code gets
Archive reach without ever touching the key — the same sovereignty property
BYO LLM keys and pairing already have.

---

## Is the Archive prepped for AI-lab draws? — partly. It is prepped for query, not export.

Assessed against the recorded endpoint inventory (`/api/v1/meta`,
`/archetypes` + `/{id}` + `/{id}/packets`, `/packets` + `/{id}` +
`/{id}/archetypes`, `/search`, `POST /ingest/packets`,
`GET /ingest/status/{id}`). **Not yet confirmed against the live
`/api/v1/openapi.json`** — that is on the droplet and unreachable until SSH
works. Treat this as a review of what was written down, and re-check it first
thing once the origin serves.

What is there is a clean **query** API, which covers the researcher Node and
most app developers. For "Archive-scale batches ... versioned Editions" it is
missing the export half:

1. **No Editions endpoint at all.** There is no `/editions`,
   `/editions/{version}`, or any way to pin, diff or download a snapshot — yet
   the Edition is the citable unit the whole reproducibility claim rests on,
   and the specific thing labs are promised. This is the biggest gap, and it
   is not only a lab problem: `archive_pin` (Q3) needs an Edition identifier
   to record.
2. ~~**No bulk/streaming export.**~~ **Superseded** — see the Git section
   above. Git at a tag already provides resumable, checksummed, deterministic
   bulk transfer, so no streaming endpoint is needed. What is needed instead is
   a signed snapshot download for the *current* Edition, so paying bulk
   consumers do not have to be provisioned GitHub access.
3. **No consent snapshot, and no revocation feed.** Consent is revocable and
   packets are append-only, so a batch drawn today is a claim about consent
   *at draw time*. A lab needs (a) that snapshot recorded with the batch and
   (b) a way to learn what has since been withdrawn. Without the second,
   "explicit contributor consent" cannot survive contact with a training set
   that outlives the draw.
4. **No reproducibility manifest.** Same Edition + same query should yield a
   byte-identical batch, provable by checksum. Nothing emits one.
5. **Auth has no tiers.** `app/auth.py` is a single boolean — a valid paired
   Node token. It cannot distinguish a researcher asking one question from a
   lab pulling the corpus, so entitlement cannot be enforced and the scoped
   tokens the Marketplace promises have nowhere to live.

**Recommended order**, since (1) unblocks the most: Editions endpoint →
manifest in `/api/v1/meta` → scoped tokens → bulk export → revocation feed.
The first two also serve the researcher Node, so they are not lab-only work.

## Git or API for Edition access? — split by access mode, not by edition age

Decided 2026-08-27 after establishing that only the *current* Edition is live
on the droplet; previous Editions exist as tags in the (currently private)
`psyntient/The-Noetic-Archive` repo. Confirmed: the `psyntient` org reports 0
public repos today.

**Use both, for different operations:**

> **Git is the distribution and citation format for frozen Editions. The API is
> the query surface over the current one.**

They are not competing answers, and neither can do the other's job:

- **Git cannot answer a question.** The researcher case is "what does the
  Archive say about open awareness?" — that is search and per-record lookup.
  Cloning a corpus to answer it is absurd, and gets worse as packets (neural
  recordings) grow. Git's only access mode is "all of it."
- **The API should not carry bulk.** Git already does resumable, checksummed,
  deterministic, tag-addressable bulk transfer, for free. **This corrects gap
  2 below** — a streaming export endpoint was over-engineering. The Edition
  repo already is the export mechanism.

**The Node never clones.** It queries, and pins citations as
`{edition version, git tag, packet ids, query, timestamp}`. The git tag makes
the pin *resolvable later by a human or a lab* — the Node itself never fetches
it. Git is the citation namespace; the API is the access path. A paper cites a
DOI without hosting the journal.

For this to work, `/api/v1/meta` **must** expose the current Edition's git ref.
Without it a pin is unresolvable, and that is the whole point of pinning.

### Mapping the free/paid split onto this

Intended model: historical Editions free, current Edition gated on
psyntient.io subscription status.

**Gate at the API, not at GitHub.** Publishing historical Editions to a public
repo is the right move and needs no gate at all — free means no mechanism.
Gating the *current* Edition through GitHub ACLs would be the mistake:

- It requires every subscriber to have a GitHub account and be provisioned as
  a collaborator — a miserable onboarding step for a non-technical
  consciousness researcher, and a fragile dependency on a third party's
  permission system.
- Subscription lapse cannot un-clone a private repo. Git is distributed by
  design; there is no revocation once fetched.
- The API gate **already exists and already means the right thing**:
  `app/auth.py` → psyntient.io, which is where subscription status lives.

So: public repo for historical Editions; the API for the current one; and for
paying bulk consumers, serve the current Edition as a signed, time-limited
snapshot download from the API rather than provisioning GitHub access. That
reuses the auth already built and keeps GitHub out of the entitlement path.

### The consent problem this creates — raise before publishing anything

Published Editions are immutable and, once public, distributed. A contributor
who later withdraws **cannot** be removed from an Edition someone has already
cloned. That is in direct tension with the site's current wording:

> "Every contribution is voluntary and revocable." — psyntient.io/archive

Both can be true only if "revocable" is scoped precisely: **withdrawal removes
a contributor from future Editions; it cannot retract an Edition already
published.** That is a normal, defensible position — most data repositories
work this way — but it has to be stated at *consent time*, not discovered
afterwards, and the site language should say so. This is worth settling before
the first public Edition ships, because it cannot be fixed retroactively.

## How do developers authenticate? — by account, not by Node

The original plan was that every developer installs a Node and routes through
it. **Recommend against.** It breaks for exactly the consumers that matter
commercially, and it buys no safety.

The confusion comes from one word covering two very different resources:

| resource | where it lives | can anything but a Node reach it? |
|---|---|---|
| **a user's Vault** | that user's machine | **No.** Nothing else can. |
| **the Archive** | a server | Yes. Nothing about it is local. |

Once separated, the answer is forced:

- **Vault access → Node-mediated, always.** Not policy, physics: the Vault is
  on the user's disk and the Node is the only thing that can reach it. Scoped,
  revocable tokens issued by that Node — exactly what the site describes.
- **Archive access → account-mediated, no Node required.** A server-side app
  with 100k users cannot run 100k Nodes. An AI lab drawing training data has no
  user and no Vault in the transaction at all; requiring a Node there is pure
  ceremony that protects nothing.

**The Node is the first-party consumer of the Archive API, not a toll booth on
it.** That is also the more honest product story: the Node earns its place by
making a user's *own* data sovereign and usable, not by being mandatory
middleware for reading a database.

### The implementation is small, because the pattern already exists

`app/auth.py` already resolves a credential by calling psyntient.io
(`POST /api/public/nodes/verify-token`, `X-Internal-Service-Key`). Generalise
that to resolve **any** Psyntient credential — node token or developer key —
returning `{ valid, subject, plan, scopes }`. The Archive then stops caring
which kind it holds, and psyntient.io stays the single source of entitlement
truth, where subscriptions already live. Revocation works identically for both.

| credential | issued to | typical consumer | Vault reach |
|---|---|---|---|
| node token (`node.key`) | a paired Node | Cortex, the researcher's own Node | that Node's Vault |
| developer API key | a psyntient.io developer account | server-side app, CI, lab pipeline | **none** |
| scoped token | issued *by* a Node to an app | an app acting for one user | that user's Vault, scoped |

An app needing both — user Vault data *and* Archive context — carries both
credentials. That is correct, not redundant: it means an app can never use its
own Archive entitlement to reach a Vault, and never use a user's consent to
bulk-draw the Archive. The separation is the safety property.

**Site wording to revisit:** "The Node owns the connections to the user's
Neural Vault and, with consent, the Noetic Archive — so you never have to"
currently reads as Node-mandatory for Archive access. True for Vault, too
strong for Archive.

## Blocked on

SSH to the droplet. `ssh root@147.182.188.20` refuses publickey; a public key
is generated locally and waiting to be installed (`ssh-copy-id`). Until then:
the origin serves nothing on 80/443 (see `NEXT_SESSION.md`), so no endpoint
here can be verified live, and none of the above should be treated as
confirmed against running code.
