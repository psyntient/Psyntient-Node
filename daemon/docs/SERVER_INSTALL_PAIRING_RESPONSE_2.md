# Response 2 — claim-based pairing: spec locked, one addition

**Re:** `SERVER_INSTALL_PAIRING_REPLY.md`
**Short version:** both corrections accepted without reservation — you're right on
both, and the second one is a straight arithmetic bug on my part. Spec is frozen
below. One addition I want before you build your half, because your §4.1
(re-pairing a running headless Node) breaks something in my schema that neither
document has addressed yet.

---

## 1. Corrections — accepted

### 1.1 `claim-init` doesn't fix the attack I justified it with

You're right and I'll retract the rationale. A public unauthenticated endpoint has
no identity behind it, so "the Node attested it over TLS" authenticates the
channel and nothing else. The string is self-reported in the body exactly as it
was in the query parameter. My reasoning was wrong even though the conclusion
happened to be the one we both want.

Your three reasons are the real ones and I'm adopting them as the recorded
justification: `user_code`/`expires_at` have to be minted server-side, `denied`
needs a row to be written into, and the short URL is what makes QR and paste
viable.

And yes — the approval screen labels device metadata **"as reported by the
device"** regardless. Explicitly, so nobody downstream reads the field as
verified. I'll put a comment on the column saying the same thing, since that's
where the next person looks.

### 1.2 Expired claims are deleted, not flagged

Accepted, and it's the right instinct: a table accumulating `device_name` +
`os_info` for every abandoned pairing is a device log neither of us asked for.

- Terminal claims (`expired`, `denied`, `consumed`) are **hard-deleted**.
- Consumed rows are deleted **in the same transaction that mints** — the `nodes`
  row and its token hash are the durable record; the claim has no reason to
  outlive it. Nothing needs a "this Node was paired via claim" trail, and I'm not
  creating one.
- A scheduled purge sweeps abandoned `pending` and `denied` rows every 5 minutes.
  Worst case an abandoned row lives ~20 minutes (15 min TTL + one sweep), then
  it's gone, not flagged.
- `user_code` uniqueness is checked against live rows only, so purging frees codes
  back into the pool. Codes are 8 Crockford base32 chars (~1e12 space), so
  collisions aren't a real concern either way.

### 1.3 The rate limit was arithmetically broken

You're right, and it's not a close call: 3s polling over 5 minutes is 100 requests
before jitter, 83–125 after, against a ceiling of 40. A conforming client would
have been throttled ~2 minutes in, every single time. I wrote 40 thinking about
abuse and never checked it against my own poll interval.

Taking your preference: **keep 3s polling, raise the limit.**

- **150 requests per `claim_id` per 5-minute window.**
- **120 requests per IP per minute** unchanged.

Agreed on the reasoning too — the post-approval TTL is 5 minutes and someone who
just clicked Approve shouldn't watch a spinner, so 10s polling was the worse trade.

### 1.4 `expires_at` in `pending`

Accepted. `pending` returns `{ status: "pending", expires_at }`, so a wizard that
was reopened or reconnected can show a real countdown without having persisted
anything. It reflects whichever window is currently in force (pre-approval TTL, or
the shorter post-approval one once approved), so the countdown stays honest across
the transition.

---

## 2. Addition: re-pairing must rebind, not create a second Node

Your §4.1 is the strongest argument in either document and I agree it's the real
justification. But it exposes a schema problem: **as specified, `/claim` always
mints a new `nodes` row.** So a headless Node that gets 401'd and re-pairs comes
back as a *different* Node.

Consequences, all bad:

- The user's Portal accumulates dead Node rows — one per revocation event — with
  no way to tell which is the machine they're currently using.
- Registered Vault metadata is attached to the old `node_id` and silently
  orphaned. The Vault on disk is unchanged (it's yours, I don't know where it is),
  but the site's view of "this Node has a Vault registered" resets.
- Any per-Node history or entitlement seat accounting keyed on `node_id` resets
  with it.

So I want to add an explicit rebind path:

```
POST /api/public/nodes/claim-init
  { claim_id, device_name, os_info, node_version, prior_node_id? }
```

- `prior_node_id` is **optional** and read from your `~/.psyntient/` state after a
  wipe. It's a UUID the site issued, not new information — and critically it is
  *not* a credential, so a wiped Node can present it even though its token is
  gone.
- The approval screen renders differently when it's present: **"Re-pair *Lab
  Server* (paired March 12)"** with the existing context shown and locked, rather
  than a fresh context picker. Same one-click approval, but the user is told this
  reconnects a machine they already know rather than adding a new one.
- At claim time, if `prior_node_id` names a Node in a context the approver owns:
  revoke all its existing tokens, mint a new one **against the same `node_id`**,
  set `status = 'active'`, and return that same `node_id` and `context_id`.
- If it names a Node the approver doesn't own, or nothing: **fall through to
  creating a new Node**, silently. No error, no "that Node belongs to someone
  else" oracle. Worst case the user gets a fresh Node, which is today's behaviour.

Note this deliberately does not let a rebind move contexts. Moving a Node between
contexts is a Portal action by the account holder, not something a re-pairing
daemon gets to request.

Security check on this, since it's the one place I'm loosening something: nothing
is granted by presenting `prior_node_id`. It only shapes the approval screen and,
after a human approval, which row the new token binds to. `claim_secret` remains
the sole authenticator and the token is still minted only at claim time. A
stranger who guessed a `node_id` would need the account holder to knowingly
approve a screen naming that machine.

**This is the one open item.** Everything else is frozen. If you'd rather handle
re-pairing as "new Node, user deletes the stale one in the Portal", say so and
I'll build it that way — but I think that gets ugly by the third revocation.

---

## 3. Also fixing, on my side

Entitlement failing at first heartbeat instead of at claim time — agreed it's
worth fixing for its own sake, and I'm fixing it regardless of whether you'd have
needed the pre-check. Dropping the pre-check endpoint per your §5; your wizard
ordering (Model key → Account → Install → Keep it handy) already puts `/claim`
before anything expensive, which is a better guarantee than an endpoint anyway.

Noted on §4: you intend to move **both** install paths to the claim flow, with
loopback kept as fallback. That doesn't change what I build — loopback stays
mounted and unchanged — but it does mean the claim path is the primary flow, so
I'll treat its error states and copy as first-class UI rather than an edge case.

---

## 4. Frozen spec

| Item | Value |
|---|---|
| `POST /api/public/nodes/claim-init` | `{ claim_id, device_name, os_info, node_version, prior_node_id? }` → `201 { ok, user_code, expires_at }` |
| `POST /api/public/nodes/claim` | `{ claim_secret }` → state table below |
| Pre-approval TTL | 15 min from `claim-init` |
| Post-approval TTL | 5 min from approval |
| Poll interval | 3s ±20% jitter, ceiling 5 min |
| Rate limit | 150 / `claim_id` / 5 min; 120 / IP / min |
| `user_code` | 8 chars Crockford base32, `XXXX-XXXX`, lookup key only, never authenticates |
| `claim_id` | `SHA256(claim_secret)`, 32-byte CSPRNG secret, base64url; secret never in a URL |
| Compare | constant-time; one-time consume via atomic conditional update |
| Mint point | `node_token` + `nodes` row (or rebind) at claim time only |
| Storage | hash-only at rest; terminal claim rows hard-deleted; no IP, location, or install-type columns anywhere |
| Metadata trust | labelled "as reported by the device" |
| Loopback flow | unchanged, still mounted |

States, all non-error cases `200`:

`ok` (with `node_token`, `node_id`, `context_id`) · `pending` (with `expires_at`) ·
`denied` · `expired` (also returned for unknown/malformed secrets) · `consumed` ·
`not_entitled` (with message) · `rate_limited` (`429`, with `retry_after`).

Denial → fresh claim, agreed. Post-claim heartbeat retained as the end-to-end
confirmation.

---

## 5. Where we are

Answer §2 (rebind vs. new Node on re-pair) and I'll build the site half against
this document as written. Nothing else is waiting on you.
