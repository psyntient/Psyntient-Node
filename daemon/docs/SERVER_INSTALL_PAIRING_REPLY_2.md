# Reply 2 — rebind on re-pair: yes, build it

**Re:** `RESPONSE_2_SERVER_INSTALL_AND_PAIRING.md` §2
**Short version:** rebind, not new-Node. Build it as specified. One consequence
lands on our side that you couldn't have seen, and two small rules we'll hold
ourselves to so the mechanism can't be misused by accident.

---

## 1. Rebind — accepted

Your reasoning is right and the alternative is worse. "New Node, user deletes the
stale one in the Portal" is tolerable once and embarrassing by the third
revocation, and it silently resets anything keyed on `node_id` — entitlement seat
accounting most importantly.

The security argument holds as you put it: `prior_node_id` grants nothing. It
shapes an approval screen and, after a human approval, selects which row a
freshly minted token binds to. `claim_secret` remains the sole authenticator.
Silent fallthrough when the approver doesn't own the named Node is the right call
— an explicit "that Node belongs to someone else" would be an ownership oracle,
and the user still sees the difference, because the screen says "Add a new Node"
rather than "Re-pair *Lab Server*".

Agreed that a rebind must not move contexts. That's a Portal action.

---

## 2. The consequence on our side: invariant 5 currently destroys `prior_node_id`

`AUTH_FLOW.md` §8 invariant 5:

> Any 401/403 from heartbeat wipes `node.key` and drops the Node into the
> unpaired state.

`node.key` holds `node_token` **and** `node_id`. So the exact event that makes a
Node need to re-pair is the event that destroys the identifier your rebind path
depends on. As things stand today, a revoked headless Node could never send
`prior_node_id` — it would have deleted it seconds earlier.

This is ours to fix and we will. The intent of invariant 5 is that a **rejected
credential** must not survive; `node_id` is not a credential, it's a UUID you
issued, and nothing is granted by holding it. So we'll split them:

- `~/.psyntient/node.key` — unchanged, still wiped whole on 401/403/404.
- `~/.psyntient/node.prior` — written at the moment of the wipe, containing
  `node_id`, `context_id` and `unpaired_at`. Mode 600 for consistency, though it
  holds no secret. Never consulted by `isPaired()`, which keys off `node.key`
  alone, so a Node with only a tombstone is unambiguously UNPAIRED.

No expiry on the tombstone. A machine that sat unpaired for a year and comes back
is still the same machine, and rebinding to a year-old `node_id` is the correct
outcome.

We'll record this as a clarification to invariant 5 rather than a weakening: the
token dies, the name survives.

---

## 3. Two rules we'll hold ourselves to

**We only send `prior_node_id` when re-pairing after a wipe.** Never on a fresh
install. Otherwise a user deliberately setting up a *second* Node on a machine
that once held one would be offered a rebind they didn't ask for, and might
approve it without noticing they'd just killed the other Node's token. A
tombstone means "this machine was this Node"; only a re-pair should act on it.

**We handle the silent fallthrough explicitly.** If we send `prior_node_id` and
`/claim` returns a *different* `node_id`, that's your fallthrough path and it
means we've been issued a new identity. We'll treat it as such — clear any local
state scoped to the old `node_id` and drop the tombstone — rather than assuming
the rebind succeeded. Returning the bound `node_id` in the `ok` body, as the
frozen spec already does, is all we need to detect this. No extra field required.

---

## 4. An unplanned benefit worth naming

Rebind turns out to be the correct primitive for something else we want: **moving
a Node to a different machine.** A researcher who starts on a laptop and later
wants their Node on a server needs the new machine to *be* that Node, not a
second one.

With rebind, migration is: carry `node_id` to the new machine, re-pair there,
and the old machine's token is revoked as part of the same operation. One
`node_id`, one live Node, and the loser dies immediately rather than two machines
heartbeating the same identity.

That also answers a question your §2 raises implicitly — what if two machines
both hold the same `prior_node_id` and both rebind? They'd take turns revoking
each other. That's the right behaviour, not a bug: it enforces one live Node per
`node_id`, and it's the property that makes migration safe. We just have to make
sure our own migration feature doesn't leave two machines racing, which is our
problem, not yours.

---

## 5. Where we are

Nothing else open from our side. The frozen spec in your §4 plus rebind is what
we'll build against.

One scheduling note so you're not waiting on a phantom: we're validating the
existing local install end to end first — it has genuinely never been run start
to finish — and building our half of the claim flow after. Your work isn't
blocked by ours; loopback staying mounted and unchanged is exactly what lets
those proceed independently, which we appreciate.
