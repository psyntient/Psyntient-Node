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

**Originally written against Edition 002 at a point where that was not a
hypothetical fallback — it was the live state**: the Archive shipped zero
live genera, its one genus record having been a smoke test the Architect
deliberately dissolved, so every species showed the "no family yet" message.
That changed mid-session: `NA-0028-absorptive-attention` is now a real,
live genus with three real species members, seeded by droplet-side Library
interface testing (it still carries `SIMULATED_TEST_DATA: true` — see the
family tree section below for how that's surfaced). The taxonomy layer was
built and wired up end to end (search, links, detail rendering, the Cortex
hand-off prompt) before any live genus existed to test it against; that
data now exists and the code was verified against it without needing a
change, which is exactly what "nothing hardcodes the absence" was supposed
to buy.

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

### The family tree

The Family chip and the genus member list above are enough to *link* to one
level of the taxonomy, but not enough to *see* it. The family tree is a
dedicated three-tier view — genus, its species one rank beneath it, and
under each species the archetypes it relates to — reached from a pill inside
the detail panel:

| the open archetype is | pill reads             | opens the tree for |
| ---------------------- | ----------------------- | ------------------- |
| a species with a genus  | `▲ in {genus}`          | the species' own id |
| a genus                 | `▼ {n} species`         | the genus' own id   |
| neither                 | nothing (unchanged — see above) | — |

The pill always passes the *currently open* archetype's own id, never the
genus's — `getFamily(id)` (`daemon/archive-client.mjs`) resolves upward on
its own (`parent_archetype` if present, otherwise the id itself when it is
already a genus), the same way `GET /library/api/family/<id>` does in The
Librarian, the droplet-side implementation this view is modeled on. A
species with no genus, or a genus whose id doesn't resolve to a real record
(renamed/merged between Editions), gets a 200 with an explanation — `{genus:
null, species: [], note: "..."}` — never an error page. Reached over the
same `/archive` gateway route as everything else, multiplexed on a new
`?family=<id>` query param alongside the existing `?id=`/`?query=`.

**Rendering**: `.psy-arch__tree-node` cards reuse the same gradient +
`--elevate-1/2` treatment as the grid cards; the genus card is centered and
wider, and the card matching the id the tree was opened about gets a gold
`--psy-gold` outline (`.psy-arch__tree-node--you`) so the reader can always
tell where they are. Connectors between tiers are CSS borders on thin spacer
elements, not SVG, so they inherit `--border` and survive a reflow; the
horizontal bar's inset uses `--n` (the species count) to correct for the
gaps between columns not being part of any column:

```css
.psy-arch__tree-bar {
  margin: 0 calc((100% - (var(--n) - 1) * 0.85rem) / (2 * var(--n)));
}
```

Below 760px the row collapses to a single column and the connectors hide —
a horizontal bar across a vertical stack means nothing. Each species card's
own `related` edges render as chips beneath it; an edge whose target id
isn't in the currently-loaded index renders as plain text instead of a
clickable chip, checked against the already-loaded `archetypes` list rather
than an extra fetch.

Clicking any tree card (or a related chip) opens that record's regular
single-archetype detail panel — `open()`/`openById()` always clear the tree
state first, so the two views never end up stacked. There is no separate
in-tree "re-centering" interaction; getting back to the tree from there
means clicking the pill again, which keeps the tree reusing the exact same
detail-fetch code path as the rest of the page rather than a second one.

**Simulated-data provenance**: every genus in this Edition is seeded test
data (see below) — a surface built for citation that displayed a dissolved
smoke test as real taxonomy would be worse than no taxonomy view at all. The
tree checks the genus record's own `SIMULATED_TEST_DATA` field and, when
true, shows a `Test data` badge on the genus card plus a banner quoting the
record's own `note` field and saying plainly not to cite the grouping.
Nothing is hardcoded: a real genus the Architect derives later carries no
flag, and the badge/banner simply will not appear for it.

**Deliberately not built**: an index-level "browse every family" entry
point (The Librarian's `#/families` list + single-family auto-redirect).
At the time this was written the Edition shipped zero live genera —
confirmed live, not assumed, by batch-fetching the full index and filtering
on `taxonomic_rank === "genus"` — so a list view would have shown nothing.
One live genus exists now (see above), which doesn't change the call: one
genus is still not enough for a list view to earn its keep over the
per-archetype pill. Worth revisiting once there are several.

### Evidence and packets

What used to be a bare *"N exemplars"* count with nothing behind it — a
number a reader could not act on, and could not tell apart from an Edition
that simply had no observation packets at all (Edition 002 sat at
`packet_count: 0` for months; it now sits at real, non-zero counts, seeded
by the same droplet-side work that produced the live genus above).

**The Evidence section** — species records only; a genus has no exemplars
of its own (see `loadEvidence()`'s taxonomic_rank check). Lists the
archetype's exemplar packets as weight bars, strongest first, each showing
the packet id, subject, and a confidence percentage. **The real/simulated
split is stated in words above the list**, not as a badge on every row —
*"All 12 of these recordings are simulated"* — because that is the single
most important fact about an archetype's evidence and a reader should see
it before reading a single packet id. Loads un-awaited right after the
detail panel itself resolves (`open()`/`openById()` fire it without
`await`ing), so a slow or failed evidence fetch never blocks or breaks the
archetype page around it — a failure replaces only the section's own
placeholder.

**The packet detail view** (`openPacket()`/`renderPacketDetail()`) — click
any evidence row and it takes over the overlay the same way the family tree
does. Shows the participant's own first-person `report_text` as the main
body, `context_tags` as chips, a chart per neural-data modality, and what
the recording exemplifies (every archetype it maps to, with confidence) —
the thing that makes an archetype checkable rather than merely stated.

**The chart** (`renderModalityChart`/`renderSparkline`) is inline SVG, no
chart library, modeled on The Library's `spark()`:

- **Dispatches on the shape of the timeline, not the modality's name.**
  EEG's `band_powers` is nested (`{timestamp, band_powers: {delta, theta,
  ...}}`); anything else is read as a flat bag of numeric keys per point.
  Reading the nested shape directly would draw nothing for every other
  modality — and silently, since a titled section renders nothing for an
  empty body. Every packet in this Edition is EEG today, so the flat-shape
  path is unexercised against real data but not untested — verified with a
  synthetic fixture.
- **Scales honestly.** `band_powers` values share a real unit, so all
  series share one axis and stay comparable. A flat bag of numeric keys is
  in unknown units — plotting bpm against a 0-1 ratio on one axis would
  misstate their relative size — so each series there scales to its own
  max, and the caption says which happened.
- **Always leaves a fallback.** No numeric timeline falls back to
  `summary_features` as a plain list; nothing plottable at all says so
  explicitly (*"2 channels recorded, 2 timeline points — no chart available
  yet"*) rather than rendering silence, which is indistinguishable from
  having no data — and absence of data is itself a claim worth stating
  correctly.
- **Provenance is baked into the SVG's own `<text>`**, not just page chrome
  around it, when the packet is simulated — a chart travels by screenshot,
  arriving somewhere with no page around it and nothing to say which
  Edition it came from. A caveat in a banner above the figure does not
  survive that trip; one inside the figure does.

**Endpoints**: `GET /archive?evidence=<archetypeId>` →
`getArchetypePackets()` (already existed daemon-side, unused until this);
`GET /archive?packet=<packetId>` → `getPacketDetail()`, new — goes straight
to `/packets/{id}` + `/packets/{id}/archetypes` in parallel rather than
through `getRecord()`'s archetype-then-packet fallback, since a caller here
already knows the id is a packet.

### Edition-wide figures

The archetype network graph, confidence distribution and overlap heatmap —
matplotlib output generated once per Edition, not built live like the
per-packet chart above. Originally out of reach: those figures live on the
droplet's local filesystem, read directly by The Library's own proxy, and
`archive.psyntient.io`'s public API — the only thing this Node talks to —
had no endpoint for them (`/api/v1/manifest`, `/api/v1/figures` both 404'd,
checked live).

**Fixed at the source, not worked around.** Rather than have this Node
reach into droplet-local files (which its architecture deliberately never
does — see `PSYNTIENT_ARCHIVE_URL` and the traverse-never-mirror design
note atop `archive-client.mjs`), the Archive API itself
(`Noetic_API_Backend/app/main.py` on the droplet) gained two routes,
`GET /api/v1/manifest` and `GET /api/v1/figures/{name}`, mirroring The
Library's own `EDITION_DIR`-relative read pattern and figure allowlist —
same directory, same reasoning, now reachable over the public API like
everything else this client uses. `get_meta`'s inline "find the latest
edition dir" logic was factored into a small shared helper both the new
routes and it now call; behavior unchanged, confirmed live before and
after. This is a change to shared production infrastructure other
consumers depend on (The Architect, The Library, this Node), made with
explicit sign-off, backed up before editing, and verified live (existing
routes unaffected, new ones returning real data, traversal and
non-allowlisted names both 404) before being treated as done.

**Reached from the hero's "About this Edition" button**
(`openEditionInfo()`/`renderEditionInfo()`): the manifest's own account of
itself — `source`/`source_notes` stated plainly (own posture as the
packetCount===0 notice elsewhere on this page: this Edition's data is
simulated, and that belongs on the page, not buried), inclusion and
promotion rules, then the figures themselves, then the figure generator's
own interpretation notes.

**Figures load as blobs, not `<img src>`.** The gateway's figure route is
`auth: "gateway"` like every other archive route, and an `<img>` request
carries no `Authorization` header — so each figure is `fetch()`ed with the
header, turned into a blob, and set via `URL.createObjectURL`. Object URLs
are tracked in a `Map` and revoked on close (and on `disconnectedCallback`)
rather than left to leak for the tab's lifetime.

**Rendered on white, deliberately.** matplotlib output where colour carries
real meaning (node colour is confidence tier) gets a white "plate" behind
it (`.psy-arch__figure-img`), not filtered or inverted to match this dark
page — the same reasoning the policy states for the figures themselves,
just enforced in CSS instead of the generator.

### Recently browsed

A `Recently browsed (N)` chip, shown only when the list is non-empty. Clicking
it expands a strip of pills — archetype name + relative time ("just now" /
"15 min ago" / "1 hr ago" / "yesterday" / "4 days ago"), newest first — plus a
retention/masking note and a "Clear this list" button. Open/closed state
persists in `localStorage` (`psy-arch-history-open`), a per-browser
convenience, separate from the list itself.

Copies the behaviour of the same feature in The Library (the droplet-side
project this Node reads Archive material from), not its layout — a docked
side panel would be a much larger structural change to a page with no
sidebar concept anywhere else in it, for behaviour this chip+strip pattern
already delivers.

**What gets recorded, and when.** An archetype's own page being opened —
never a card in the grid, a search result, a packet, or a family-tree visit.
`open()` and `openById()` are the only two places that open an archetype's
own detail panel (a card click, a related link, a family-tree node, an
"exemplifies" link all funnel through one of these two), and both gate the
record on the `/archive?id=` response's own `kind === "archetype"` — a
packet id never records. Upsert, not append: a revisit moves the entry to
the top and increments its view count rather than adding a second row.

**Local storage — `daemon/archive-history.mjs`, its own file.** Deliberately
*not* folded into `archive-client.mjs`'s `RECORD_CACHE`: that cache is
meant to disappear (Edition change, TTL, a gateway restart), while a
browsing history must survive all three. This was a real trap on the
Library's own side of this feature, called out explicitly in the brief this
was built from — the obvious home was the cache, and flushing a cache must
never delete someone's history. Lives at
`~/.psyntient/archive-history.json` (`psyntientHome()`), same reasoning as
`node.key`/`providers.json`: Node *state*, not installed code, so the
updater — which only ever replaces the engine tree — never touches it.
Capped at 60 entries (matches the Library's own cap), oldest dropped first.
**Deliberately no local expiry.** Retention (30 days) is the server's, once
syncing exists; a local clock disagreeing with the server's would show the
reader two different answers to "is this still on my list." Today this is
just a bounded cache with no time-based drop — entries only leave it by
falling off the cap or an explicit clear.

**Route — a sibling of `/archive`, not a query param on it**:
`GET /__openclaw__/psyntient/archive/history` returns
`{ entries: [{id, lastSeen, views}] }`; `POST {action:"record", id}` records
one view and returns the updated list; `POST {action:"clear"}` empties it.
Every other archive route is a pass-through to `archive.psyntient.io`
(`?id=`, `?family=`, etc.) — this one never touches the network at all,
which is reason enough to keep it off that route rather than multiplexing
on yet another query param.

**Not in the current Edition.** A pill whose id isn't in the currently-
loaded archetype index renders greyed and non-clickable, with a "No longer
in this Edition" title — the same idiom `renderTreeRowItem()` already uses
for a stale cross-reference, and the same `in_edition: false` concept the
sync contract (below) defines server-side. A reader looking for what they
read last month should be told it's gone, not find it silently missing.

**Syncing is blocked, on purpose, and not built.** The Library exposes
`GET`/`POST /library/sync/history` for exactly this — one list per
Psyntient account, shared across every surface that reads the Archive — but
it requires a verified user session, and this Node never holds one
(`AUTH_FLOW.md`: "The Node never receives the user's Supabase JWT,
password, or a service-role key"). The Node knows who it acts for
(`interface-session-exchange` returns `user_id`/`user_email`), but that
exchange consumes a one-time, node-bound token — an attestation this Node
can act on locally, never a credential it can replay to a third party. The
shortcut this must never take: sending `Authorization: Bearer <node_token>`
together with a `user_id` in the body, which would let any paired Node read
any researcher's history by naming someone else's id. What unblocks it:
psyntient.io adding `user_id` to `POST /api/public/nodes/verify-token`'s
response (tracked as `LOVABLE-verify-token-user-id.md`, droplet-side, not in
this repo). Until that ships, recording stays purely local; nothing else
about this feature changes when it does — the local half was built to not
need rework, only an additional sync step.

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
  ├─ openFamily(id)         GET /archive?family=        → getFamily(id)
  │                                                          ├─ getRecord(id)            [cache-aware]
  │                                                          ├─ getRecord(genusId)       [cache-aware, skipped if id IS the genus]
  │                                                          └─ batchGetArchetypes(members or related ids) [cache-aware]
  ├─ loadEvidence(id)       GET /archive?evidence=       → getArchetypePackets(id)
  ├─ openPacket(id)         GET /archive?packet=         → getPacketDetail(id)
  │                                                          ├─ GET /packets/{id}         [uncached]
  │                                                          └─ GET /packets/{id}/archetypes [uncached]
  ├─ openEditionInfo()      GET /archive?manifest=1      → getManifest()
  │   └─ loadFigure(name)   GET /archive/figure?name=    → getFigure(name)  [binary; blob + object URL]
  ├─ loadHistory()          GET /archive/history         → archive-history.mjs listHistory()   [local only, no Archive call]
  ├─ recordArchetypeView()  POST /archive/history        → archive-history.mjs recordView(id)  [fired from open()/openById() on kind==="archetype"]
  ├─ clearHistory()         POST /archive/history        → archive-history.mjs clearHistory()
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
