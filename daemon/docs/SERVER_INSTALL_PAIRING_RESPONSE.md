# Response — Server installs and headless pairing

**From:** psyntient.io side (site/API owner)
**Re:** `SERVER_INSTALL_AND_PAIRING.md` (request for comment)
**Status:** agreement in principle + concrete counter-proposal on three points. Nothing built yet; say go and I'll ship the site half.

---

## 0. Short version

**Agree with the proposal.** Claim-based pairing is the right shape, and the key
insight — *queue an approval, not a token; mint at claim time* — is exactly the
constraint I would have insisted on, so there's nothing to argue about there.

I disagree with / want to modify three things:

1. **Device metadata should not arrive via the `/link-node` URL.** Add a tiny
   `claim-init` call so the Node attests its own identity. (§3.1)
2. **Two TTLs, not one**, and a short human `user_code` alongside `claim_id` so a
   headless box is genuinely usable from a phone. (§3.2, §3.3)
3. **`denied` should be a recorded state, not an absent record**, otherwise
   "denied" and "expired" are indistinguishable — which is the exact failure mode
   §4.4 asks me to avoid. (§3.4)

Plus one thing you flagged as yours that I think is partly mine: **entitlement
checks belong at claim time**, not only at heartbeat (§5).

---

## 1. Sovereignty constraints — accepted as written

All four invariants in §3 are accepted, and none of them are inconvenient for
anything I want to build.

Specifically committing:

- No install-location field, no cloud/local flag, no droplet ID, no provider
  identifier. Not now, not as an "optional" column.
- No `last_seen_ip` / `claim_ip` column on `nodes` or on the claim table. I will
  not persist claim-time IP as an attribute of the Node record. Transient
  edge/request logs only, which I don't control and don't join against Node rows.
- Nothing about Vault location or contents. Understood that the `vault` field in
  the heartbeat response is metadata you registered, not storage the site knows
  how to find. I won't build features that assume otherwise.
- The site will never ask for an LLM provider key. Not in pairing, not in the
  Portal, not in support flows.

Your §3.1 framing is fair and I'll match it: outbound HTTPS reveals a source IP,
claim-based pairing doesn't make that worse, and neither of us will claim it
fixes it.

---

## 2. Answers to your questions (§5)

**Q1 — why were `pair-init`/`pair-poll` and `device-init`/`device-poll`
deprecated?** Not for a security or RLS reason. They were built during an earlier
design where the *site* pre-provisioned a Node and the Node collected it later —
which meant a queued credential, i.e. the exact invariant break you correctly
refuse in §4.2. When the loopback flow landed, the loopback flow could mint at
redirect time, so the queue-based endpoints had no reason to exist and were
retired. They are now **fully removed from the codebase**, not merely unwired.

So: the constraint that killed them is the one you already designed around. Your
proposal is not a repeat of that mistake — it's the fixed version of it.

**Q2 — revive `preprovision-claim`?** No. Same lineage, same queued-credential
assumption, and it's gone. A fresh `/api/public/nodes/claim` with approval-only
state is cleaner than hardening a dead endpoint whose semantics were wrong.

**Q3 — does `/link-node` require `callback`?** Today, yes — it hard-refuses
without a valid loopback/https `callback` and won't render the Link button. That
validation is client- and server-side and I will **not** loosen it for the
existing path. For the claim path I'll add an explicit mode: `claim_id` present
and `callback` absent is valid; `claim_id` *and* `callback` together is rejected
as ambiguous rather than silently preferring one.

**Q4 — unauthenticated public claim endpoint vs RLS?** Fine, and it matches an
existing pattern rather than inventing one. `/api/public/nodes/heartbeat` and
`/api/public/nodes/interface-session-exchange` both authenticate by *possession
of a hashed secret*, run through the service-role client inside the handler, and
never expose a table to `anon`. The claim table will have **no anon grants and no
anon-readable policy at all** — it is only ever touched by the server handler
(service role) and by the authenticated approval path. Possession-based auth is
the accepted pattern here; a session would be wrong, since the Node has no user
session by definition.

**Q5 — TTL / poll / rate limit?** See §3.2 and §3.5 below.

**Q6 — does anything assume the Node row is created at callback time?** One
thing, and it's cosmetic: `nodes.public_key` is `NOT NULL` from an old keypair
design, and the current flow stuffs the token prefix in it as a placeholder. The
claim path will do the same until I can drop the column. Otherwise nothing —
`nodes` has no state that must exist before a token is minted, so creating the
row **at claim time** (my preference, see §3.1) is safe.

---

## 3. Counter-proposal (deltas only — the rest of §4 stands)

### 3.1 Node attests its own metadata: add `claim-init`

**Problem with the proposal as written:** `device_name`, `os_info`, and
`node_version` travel in the `/link-node?claim_id=…` URL. That means the approval
screen is describing a machine using strings supplied by whoever assembled the
URL — which in a headless flow is a string the user pasted. If a claim link is
ever socially engineered, the approval screen becomes an attacker-controlled
label ("MacBook Pro — your laptop") over an attacker's Node. The user is asked to
approve based on the one part of the flow that isn't authenticated.

**Fix:** the Node registers its own description at the same moment it generates
the secret.

```
POST /api/public/nodes/claim-init
  { claim_id, device_name, os_info, node_version }
  → 201 { ok: true, expires_at }
```

Then `/link-node?claim_id=…` carries **only** `claim_id`, and the approval screen
renders metadata the Node itself asserted over TLS. The URL becomes short, which
also helps §3.3.

Note this is still one deliberate, user-initiated pairing moment — the Node only
calls `claim-init` because the user started pairing. It is not an install ping
and carries nothing about location, so I read it as compatible with invariant 3.
If you disagree, say so and I'll accept URL-borne metadata with the caveat that
the approval screen will label it "as reported by the device".

I'd also like `claim-init` to be the row-creating step for the **claim**, but
still create the **`nodes` row at claim time** (step 6), so an abandoned pairing
leaves a claim row that expires and no phantom Node in the user's Portal. The
current loopback flow creates the Node row on approval, which does leak phantoms;
I'll fix that separately.

### 3.2 Two TTLs

One 10-minute window doesn't cover the real shape of this. The user may take a
while to get to their browser, and after approval the Node may need only seconds.

- **Pre-approval TTL: 15 minutes** from `claim-init`. If nobody approves, the
  claim expires. Covers "let me go find my laptop".
- **Post-approval TTL: 5 minutes.** Once approved, the credential should be
  collected promptly; a long window is just an approved credential sitting
  around. If the Node is polling as designed it collects in <5s.

Both are server-enforced. `claim-init` returns `expires_at` so the wizard can
show a real countdown instead of guessing.

### 3.3 A short `user_code`, because 64 hex chars is not human

`claim_id = SHA256(claim_secret)` is 64 hex characters. For the motivating case —
a developer SSHed into a headless box — the Node prints a URL the user has to get
into a browser that is not on that machine. Copying 64 chars out of a terminal
into a phone is bad, and QR-in-terminal isn't always available.

So `claim-init` also returns a **`user_code`**: 8 characters, Crockford base32
(no I/L/O/U), formatted `XXXX-XXXX`, generated server-side, unique among live
claims, and bound one-to-one to the `claim_id`.

Two ways in, same underlying claim:

- `psyntient.io/link-node?claim_id=<64 hex>` — copy/paste or QR, exact.
- `psyntient.io/link-node` → "enter your device code" → `XXXX-XXXX` — typeable
  from a phone.

Security note, deliberately: `user_code` is **only a lookup key for the approval
screen**. It never authenticates a claim. The credential is still gated entirely
by `claim_secret`, which never appears in a URL, a terminal prompt, or my
database. So a guessed `user_code` at worst shows a stranger an approval screen
they'd have to knowingly approve — and to mitigate even that: `user_code`
lookups are rate-limited per session (10/hour), and codes are single-use and die
with the claim.

### 3.4 Response states, including a recorded `denied`

Agreed on distinct states, with one addition: denial must be **written**, not
represented by the absence of a record. Otherwise the Node can't tell "the user
said no" from "the clock ran out", which is the ambiguity §4.4 is trying to kill.

```
POST /api/public/nodes/claim   { claim_secret }
```

| Situation | HTTP | Body |
|---|---|---|
| Approved, first claim | 200 | `{ status: "ok", node_token, node_id, context_id }` |
| Not yet approved | 200 | `{ status: "pending" }` |
| User declined | 200 | `{ status: "denied" }` |
| TTL passed (either window) | 200 | `{ status: "expired" }` |
| Already claimed | 200 | `{ status: "consumed" }` |
| Unknown / malformed secret | 200 | `{ status: "expired" }` |
| Approved but account not entitled | 200 | `{ status: "not_entitled", message }` |
| Rate limited | 429 | `{ status: "rate_limited", retry_after }` |

Two deliberate choices there:

- **Non-terminal states are 200, not 404.** Polling a 404 every 2s makes your
  logs and mine look like an outage. Only real errors get non-2xx.
- **Unknown secret returns `expired`, not a distinct "unknown".** Distinguishing
  them turns the endpoint into an oracle for which claim IDs exist. `expired` is
  the honest-enough answer and the wizard's remedy ("start over") is identical.

Constant-time compare on the hash, one-time consume via atomic conditional update
in the same statement that mints — same shape as `node_interface_tokens` today.

### 3.5 Poll interval and rate limit

- **Poll every 3 seconds** (not 2), with ±20% jitter, for up to **5 minutes**,
  then stop and tell the user to restart. Jitter matters more than the interval.
- **Rate limit: 40 requests per `claim_id` per 5-minute window** (3s polling uses
  100; 40 gives headroom for retries without letting a stuck loop run hot),
  and **120 requests per IP per minute** across all claims, which is generous
  enough that a lab NAT won't trip it.
- On 429, honour `retry_after` exactly. I'd rather you back off on my number than
  discover it, agreed.

### 3.6 One thing I want to keep from the old flow

Drop `session_nonce` for the claim path — agreed, `claim_secret` strictly
dominates it. But keep the **immediate post-claim heartbeat** (step 7). It's how
the site learns the token actually landed, and it's the cheapest possible
end-to-end check.

---

## 4. What I'll build

Site-side, all additive, existing loopback flow untouched:

1. Table `node_claims` — `claim_id` (hashed secret, unique), `user_code`,
   `device_name`, `os_info`, `node_version`, `status`
   (`pending|approved|denied|consumed`), `context_id`, `approved_by`,
   `expires_at`, `approved_at`, `consumed_at`. No IP, no location, no
   install-type. RLS on, no anon grants, service-role + authenticated-approver
   policies only.
2. `POST /api/public/nodes/claim-init` — public, creates a pending claim.
3. `POST /api/public/nodes/claim` — public, possession-authenticated, mints
   `node_token` + `nodes` row on first successful claim.
4. `/link-node` gains claim mode: `claim_id` (or `user_code` entry) with no
   `callback`; context picker unchanged; Approve and Deny both write state.
5. Server fn `approveNodeClaim` / `denyNodeClaim` behind `requireSupabaseAuth`,
   context ownership verified as today.

Not changing: `/link-node` loopback path, heartbeat, `interface-session-exchange`,
`verify-token`, token hashing, or the hash-only-at-rest invariant.

---

## 5. One thing from your §6 that is partly mine

**Entitlement.** Portal access and Node use require an active subscription or
license. Today that's enforced at heartbeat, which means a claim can succeed and
*then* the Node dies at first heartbeat — a confusing failure exactly at install
time, and worse on a server the user just paid DigitalOcean for.

So the claim endpoint will check entitlement and return `not_entitled` with a
human message before minting anything. The approval screen will also refuse
earlier, with a link to subscribe. That's mine to build; flagging it because it
adds a state your wizard should handle (§3.4) — and because on the server path
you probably want to check it **before** creating a droplet, which I can expose
as a cheap authenticated pre-check if you want one. Say the word.

Also from §6, unsolicited but relevant: the 80 GB droplet disk vs. a multi-year
EEG Vault is a real product problem, and it's a place where "the site knows
nothing about Vault size" is the *right* invariant and still leaves the user
holding a surprise. Worth a separate conversation — the Vault size is knowable
locally by the Node, so any warning belongs in your wizard, not my API.

---

## 6. Open questions back to you

1. Do you accept `claim-init` (§3.1), or do you read it as an install-time phone
   home? Your call; I'll build either.
2. Do you want `user_code` (§3.3), or is copy/paste + QR enough on your side? It's
   cheap for me but it's dead weight if the wizard never surfaces it.
3. On denial, should the Node exit immediately or offer "try again" with a fresh
   claim? I lean fresh claim — the old secret is dead either way.
4. Anything in §3.4's state table you'd rather see as a distinct status?
