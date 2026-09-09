# The Archive Viewer

A reading surface for the Noetic Archive — a way to see what the Archive
knows without already knowing what to ask. Lives at the "Archive Viewer"
sidebar entry, backed by `ui/src/pages/archive/archive-page.ts`
(`<psyntient-archive-page>`).

This doc covers what it displays, how it's organized (archetypes, families,
genera), and how caching works end to end — client, gateway route, and the
daemon-side Archive client.

## Why this exists alongside Cortex

Asking and browsing are different modes. You ask a question when you already
know what you're looking for; a researcher meeting the Archive for the first
time has never seen the archetype vocabulary and can't form a good question
yet. `confidence_tier` and `n_exemplars` are also comparative — "which of
these are actually well-supported" is a scanning question a laid-out field
answers instantly and a chat reply answers badly.

It's deliberately a **reading surface**, not an analysis tool. Questions hand
off to Cortex (`askCortex()` stashes a prompt via `handOffPrompt()` and
navigates to `/new`) rather than growing a query language here.

## The three-layer taxonomy

The Archive organizes archetypes into three tiers (per the Architect's own
whitepaper §2.3):

1. **Species** — an individual archetype record. Most records in the Archive
   are this. Example: "Anxious Interoceptive Contraction."
2. **Genus** — an archetype record *of* archetypes: a grouping that itself
   has an id and a detail page, linked from a species via that species'
   `parent_archetype` field. A genus record carries `taxonomic_rank: "genus"`
   and a `members` array (the species inside it) instead of exemplar packets.
3. **Family** — the label the UI uses for "the genus this species belongs
   to." When a species has a `parent_archetype`, the detail panel shows a
   **Family** chip linking to that genus. When it doesn't, the panel says so
   plainly: *"Not grouped into an archetype family yet — this Edition
   defines species but no genera."*

**As of the Edition this was written against (Edition 002), that's not a
hypothetical fallback — it's the live state.** The Archive ships zero live
genera today. Its one genus record was a smoke test the Architect
deliberately dissolved, so every species currently shows the "no family yet"
message. The taxonomy layer is real and wired up end to end (search, links,
detail rendering, the Cortex hand-off prompt), just waiting on the Architect
to actually group species into genera in a future Edition.

Nothing in the client hardcodes "there are no genera" — it reads
`taxonomic_rank` and `parent_archetype` off whatever the Archive returns, so
the moment a real genus ships, the family chips and genus detail pages
start working with no client change.

## What it displays

### The hero

Edition stats, fetched once on load: archetype count, packet count, mapping
count, and the Edition id (`Edition {id}`). If `packetCount === 0` — also the
live state today — a notice says so outright: *"This Edition ships the
archetype vocabulary but no observation packets yet, so nothing here has raw
evidence attached to it."* Stated rather than hidden, because implying
otherwise would be the most misleading thing the viewer could do.

### The grid

One card per archetype (or per genus, when browsing one — genus records
render through the same card/detail code as species). Cards are **not** a
table and there's deliberately no relationship graph or clustering layout:
the Archive exposes `related: {id: why}` edges (real, authored by the
Architect, shown as links in the detail panel) but zero packet↔archetype
`mappings` today, and a similarity layout without real mapping data would be
inventing structure that isn't there.

**Sort order** (`displayOrder()`): tier first (established → emerging →
tentative → anything else), then exemplar count descending within a tier.
The reader's first question is "what does this Archive actually know," not
"what's alphabetically first."

**Visual weight**: each card's border/accent strength (`--psy-arch-weight`,
a CSS custom property set inline per card) is the archetype's exemplar count
relative to the *best-supported archetype currently in view* — so the field
reads the same whether the Archive holds 25 exemplars total or 25,000.
Better-evidenced archetypes sit forward with a stronger accent border and a
more opaque left-edge bar, rather than shouting in a different color.

### The detail panel

Opens over the grid (`role="dialog"`) on a card click. Shows:

- Tier badge, name, description
- Exemplar count, or a "Genus" chip (+ `genus_kind_label` if the Archive
  supplies one) when viewing a genus record
- Modality coverage chips (e.g. `EEG · 12`)
- The Family chip (species) or member species list (genus) — see taxonomy
  above
- `phenomenological_signature.invariants` ("Always present") and
  `.common_variants` ("Common variations")
- `neural_signature.hypothesized` ("What the recordings suggest")
- `boundary_conditions.not` ("What this is not") and `.near_neighbors`
  ("Easily confused with") — how the Architect keeps closely-related
  archetypes distinguishable from each other
- `related` edges ("Related shapes"), each with its own stated reason
- `open_questions` ("Still unresolved")
- Prev/next stepping through the *current* sorted list (wraps at both ends)
  — hidden when the open record isn't in that list, e.g. a genus reached via
  a family link, where "next" has no meaningful referent
- "Ask Cortex about this" — hands off a prompt naming the genus explicitly
  when known, or asking Cortex to offer the family as a follow-up (and to
  say plainly if this Edition hasn't grouped the archetype into a genus yet)
  when not

Every section uses `renderSection()`, which renders nothing at all when the
underlying field is absent or empty — no empty headers for data the Archive
didn't supply.

### Search

Two distinct paths, both hitting the same grid:

- **Plain literal search** — `GET /archive?query=`, matches archetype title/
  description text server-side. Fast, but only useful when you already know
  roughly what the archetype is called.
- **Semantic search** (`archive-search.mjs`, streamed over SSE) — the actual
  point of this feature. A single plain-language description (*"that feeling
  when time slows down during a crash"*) gets matched against the whole
  archetype index by a real model call, coarse-to-fine:
  1. **Stage 1** — the compact index (every archetype's id + name +
     description, rendered as markdown — ~7 KB vs ~10 KB as JSON for the
     same 26 archetypes, and that saving lands on every search) goes to the
     model in one prompt via `openclaw infer model run --gateway`. The model
     returns a JSON array of matching ids, ranked, capped at 8, filtered
     against the real id set (a hallucinated id becomes a dropped result,
     not a failed fetch).
  2. **Stage 2** — one batched request (`POST /archetypes/batch`) pulls full
     records for just the matched ids. The Node never needs to hold the
     whole Archive to answer one question about it.

  Streamed rather than a blocking request because stage 1 is a real model
  call taking tens of seconds — a request held open that long with nothing
  on the wire is indistinguishable from a hang. The client shows real stage
  labels (`reading-index` → `matching` → `fetching`) over Server-Sent
  Events, plus a progress bar that eases toward ~92% on elapsed time and
  only ever reaches 100% when the actual result lands — motion means
  "working," not "this fraction is done," so a genuinely slow stage never
  looks stalled.

  `EventSource` isn't used for this: it can't set an `Authorization` header,
  and the alternative — a bearer token in the query string — puts a
  credential in URLs, browser history, and any access log in the path.
  Plain `fetch` + a manually-parsed SSE stream sidesteps both.

  A search with no matches doesn't dead-end: `showAll` resets back to the
  full unfiltered index.

## The three layers of caching

Caching is layered client → gateway → daemon, and only one of those layers
actually caches anything.

### 1. The browser page (`archive-page.ts`) — no cache, by design

Every `open()` re-fetches `?id=` from the gateway route. The page holds
whatever's currently on screen in Lit `@state()` fields and nothing more —
no client-side store, no `localStorage`. A page refresh always re-asks the
gateway.

### 2. The gateway route (`gateway-plugin/index.js`) — pure pass-through

`GET /__openclaw__/psyntient/archive` and `.../archive/search` add no
caching of their own. They exist for exactly one reason stated in the code:
the Archive bearer token lives in `~/.psyntient/node.key` (mode 600) and
must never reach a browser context, so the viewer talks to this route and
the *daemon* — not the browser — holds the credential. Every request this
route receives goes straight to `daemon/archive-client.mjs` or
`archive-search.mjs`.

### 3. The daemon client (`archive-client.mjs`) — the real cache

This is where caching actually happens, and it's deliberately narrow: an
**in-memory, process-local, session-length record cache** — not a mirror of
the Archive.

**What's cached**: individual archetype (and genus) *records* — the payload
`getRecord(id)` and `batchGetArchetypes(ids)` return. Not the edition
manifest, not the archetype index list, not search results as a unit — just
individual records, keyed by id, in a plain `Map` (`RECORD_CACHE`).

**Why records specifically**: search batch-pulls a shortlist of full records
in stage 2 up front. By the time the grid renders those as clickable chips,
the records are already sitting in the cache — clicking one costs nothing.
Without this, the viewer would re-fetch an archetype the Node had downloaded
seconds earlier, on every click.

**Lifetime — `CACHE_TTL_MS = 4 hours`**, deliberately session-length rather
than minutes:

> A researcher working one topic keeps meeting the same archetypes, and a
> short TTL made them re-download records they had just looked at.

But *not* unbounded, for two named reasons:

- **Time**: the gateway is a LaunchAgent that runs for days. "No TTL" would
  effectively mean "cached until reboot" — and the Archive is append-only
  with revocable consent, so a record cached indefinitely is a small mirror,
  which is exactly what `ARCHIVE_INTEGRATION.md`'s design rules out.
- **Correctness across Editions**: archetypes get renamed and merged between
  Editions, so a record cached from a previous Edition isn't merely stale —
  it can describe something that no longer exists under that id, or exists
  differently. `noteEdition(editionId)` runs on every `getMap()` call; if the
  Edition id changes from what was last seen, the whole cache is wiped
  (`RECORD_CACHE.clear()`) before anything new gets cached under it.

**Clear points**:
- Automatic: a changed Edition id (`noteEdition`)
- Automatic: TTL expiry, swept lazily (`cacheSweep()` walks and drops expired
  entries; there's no background timer — it runs opportunistically inside
  `cacheStats()`, not on a schedule)
- A **gateway restart** — this is a plain in-memory `Map`, so it empties for
  free on every restart, no code involved
- Explicit: `clearCache()` exists for a future "refresh from the Archive"
  control (not currently wired to any UI button)

**What's deliberately NOT cached**: the edition manifest + archetype index
(`getMap()`) is re-fetched from the Archive on every call, every time the
viewer loads or a search re-reads the index. The code comment is explicit
about the reasoning — the archetype index is "cheap and stable enough to
cache," but the client doesn't, because staleness there would mean the whole
grid (sort order, weight, which archetypes exist at all) silently drifting
from what the Archive actually currently has.

**One more caching-adjacent design point, stated in the file header and
worth restating here**: this whole client is built around *traversal, never
mirroring*. The Archive's backend accepts a 60-second revocation window —
if a Node's pairing gets revoked, the Archive should stop answering that
Node within 60 seconds. A record cache with no bound at all would quietly
turn that 60-second window into "however long the process happens to stay
up," which is the reasoning behind both the TTL and the Edition-aware
invalidation above. The cache exists purely to avoid redundant round trips
within one working session, never to hold a local copy of the corpus.

## Read path, end to end

```
archive-page.ts
  ├─ load()               GET /archive                → getMap()
  ├─ open(a)               GET /archive?id=            → getRecord(id)
  ├─ openById(id)           (same, for a related/family/member link)
  └─ runSearch()/streamSearch()
        literal:            GET /archive?query=         → search(query)
        semantic:           GET /archive/search?query=  → semanticSearch(query)
                                                             ├─ getMap()               [uncached]
                                                             ├─ infer model run        [1 completion, no tools]
                                                             └─ batchGetArchetypes(ids) [cache-aware]
```

Every hop after the browser is same-origin and gateway-authenticated
(`auth: "gateway"`); the Archive bearer token never crosses into browser-
reachable code at any point.
