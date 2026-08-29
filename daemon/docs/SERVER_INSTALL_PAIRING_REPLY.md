# Reply — claim-based pairing

**Re:** `RESPONSE_SERVER_INSTALL_AND_PAIRING.md`
**Short version:** accepted, build it. Two corrections first — one is an
arithmetic contradiction that would rate-limit legitimate polling, the other is a
security rationale I want to fix before it hardens into an assumption.

---

## 1. Correction: `claim-init` does not fix the attack it is justified by

You justify moving device metadata out of the URL like this (§3.1):

> If a claim link is ever socially engineered, the approval screen becomes an
> attacker-controlled label ("MacBook Pro — your laptop") over an attacker's Node.

The attack is real. But `claim-init` does not prevent it. In that scenario the
attacker controls the Node, so the attacker calls `claim-init` and supplies
`device_name: "MacBook Pro"` themselves. The string is equally attacker-chosen;
it has only moved from a query parameter to a request body. Asserting it "over
TLS" authenticates the *channel*, not the claimant — there is no identity behind
a public unauthenticated endpoint to attest anything.

This matters beyond pedantry: if the rationale stands, someone later reasonably
concludes the metadata is trustworthy because the Node attested it, and builds a
trust decision on top. It is self-reported either way, and the approval screen
should treat it as such.

**We still want `claim-init`**, for three reasons that do hold:

1. It is load-bearing for `user_code` and `expires_at` — the server has to mint
   those, so something must call it before the browser opens.
2. It creates the row that a recorded `denied` state needs (§3.4). Without a row
   there is nothing to write denial into.
3. It shortens the URL enough to be QR-able and pasteable.

And your fallback wording is the right treatment regardless of where the strings
travel: label them **"as reported by the device"** on the approval screen. Please
do that even with `claim-init`. The real defence against the social-engineering
case is that the user initiated pairing seconds earlier and knows what they are
approving — not the label.

### 1.1 One sovereignty delta to close

`claim-init` does change what the site learns in one narrow way. Today, a user
who opens `/link-node` and abandons it leaves nothing behind. With `claim-init`,
an abandoned pairing leaves a row containing `device_name` and `os_info` — so the
site retains a record of a machine that tried to pair and never did.

Small, and the user initiated it, so we accept it. One ask: **delete expired
claim rows, don't just mark them expired.** A `node_claims` table that
accumulates the names and OS versions of every machine that ever started pairing
is a device log nobody asked for. A scheduled purge is fine; the point is that
the row is gone, not flagged.

---

## 2. Bug: the rate limit contradicts the poll interval

§3.5 specifies:

> Poll every 3 seconds … for up to 5 minutes
> Rate limit: 40 requests per `claim_id` per 5-minute window (3s polling uses
> 100; 40 gives headroom for retries…)

100 is greater than 40. A conforming client polling exactly as instructed is
rate-limited about two minutes in, every time — and with ±20% jitter the range is
83–125, so it is never close. As written, the happy path fails.

Our preference is to keep 3s polling and raise the limit, because the
post-approval TTL is 5 minutes and a user who has just clicked Approve should not
watch a spinner:

- **150 requests per `claim_id` per 5-minute window** (covers 125 worst-case
  jitter plus retries).
- **120 per IP per minute** unchanged — generous, and a lab NAT still fits.

If you would rather hold the limit at 40, then the poll interval must be **≥10
seconds**, which costs up to 10s of dead time after approval. We would take the
higher limit, but either is workable — just not the current pair.

---

## 3. Your four questions

**Q1 — accept `claim-init`?** Yes. Not as an install phone-home: it fires when
the user clicks the pairing button, which is the deliberate, user-initiated
moment invariant 3 already carves out. It carries no location. Please pair it
with the row deletion in §1.1 above.

**Q2 — want `user_code`?** Yes, and it is closer to essential than optional. See
§4 — the case that justifies this whole design is a Node with no local browser,
and there the user is reading a code off a terminal into a phone. 64 hex
characters makes that miserable. Your security framing is right: `user_code` is a
lookup key, never an authenticator, and `claim_secret` remains the only thing
that mints anything.

**Q3 — on denial, exit or fresh claim?** Fresh claim, agreed. Denial is often a
misclick, the old secret is dead either way, and our wizard makes pairing
mandatory — there is no "continue without pairing" path, so retry is the only
forward motion we can offer.

**Q4 — changes to the state table?** One addition: include **`expires_at` in the
`pending` response**, not only in `claim-init`. It lets a wizard that reconnected
or was reopened show a real countdown without having persisted anything. Nothing
else — the table is right, and returning `expired` for an unknown secret rather
than a distinct status is the correct call.

---

## 4. A stronger justification than the one I gave you

My original document framed this around installing onto a cloud server. That
undersold it, and the sharper case affects your priorities.

For the **wizard-driven** server install, we do not strictly need claim pairing.
The wizard runs on the user's laptop, where the browser and the loopback listener
are both local, so the existing flow works and we could provision the resulting
credential onto the server over SSH.

The cases that are **impossible today** and become possible with this:

1. **Re-pairing a running headless Node.** Per invariant 5, any 401/403 from
   heartbeat wipes `node.key` and drops the Node into `UNPAIRED`. On a server
   there is no browser and no way to open one, so a revoked or expired token
   today means the Node is permanently dead and the user must rebuild it. This
   is the strongest argument for the design, and it applies to every server Node
   for its entire life, not just at install.
2. **A developer running the installer directly on a headless box** over SSH.
3. **Approving from a phone** while the Node runs on a desktop.

We also intend to use the claim flow for **both** install paths rather than
maintaining two pairing implementations — so local installs would move to it too,
with the loopback flow kept as the fallback you are not changing.

---

## 5. Entitlement — we do not need the pre-check you offered

You offered (§5) a cheap authenticated pre-check so the wizard can verify
entitlement before creating a droplet. We appreciate it but do not need it,
because of how our wizard is ordered:

> **Model key → Account (pairing) → Install → Keep it handy**

Pairing already completes before anything expensive happens — that ordering
exists precisely so a user without a working key or account does not spend
twenty-five minutes finding out. So `not_entitled` arriving from `/claim` lands
before any droplet is created and before any build starts. That is exactly the
gate we need, and it is one fewer endpoint for you to build and for us to call.

Your point about entitlement failing at first heartbeat instead of at claim time
is well taken and worth fixing for its own sake.

---

## 6. On the Vault-size problem

Agreed, and agreed it is ours. "The site knows nothing about Vault size" is the
right invariant and the Node can measure its own Vault locally, so any warning
belongs in our wizard. We will handle it there.

---

## 7. What we are asking you to build

Exactly your §4 list, with these deltas:

1. `node_claims` rows are **deleted** after expiry, not retained (§1.1).
2. Rate limit raised to **150 per `claim_id` per 5-minute window**, or the poll
   interval raised to ≥10s — your choice, but they must be consistent (§2).
3. `pending` responses include **`expires_at`** (§3, Q4).
4. Approval screen labels device metadata **"as reported by the device"** (§1).

Everything else — the two TTLs, `user_code`, the state table, constant-time
compare, one-time atomic consume, entitlement at claim time, minting `node_token`
and the `nodes` row at claim time, and leaving the loopback flow untouched — we
accept as specified.

Say go and we will build our half against this.
