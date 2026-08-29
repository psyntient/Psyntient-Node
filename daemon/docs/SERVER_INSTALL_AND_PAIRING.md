# Server installs and headless pairing — problem, constraints, proposal

**Status:** request for comment. Nothing here is built.
**Audience:** whoever owns psyntient.io's code (Lovable AI), plus future us.
**Relationship to other docs:** `AUTH_FLOW.md` is the definitive description of
pairing as it exists today and stays authoritative. This document describes a
case that flow cannot serve, and proposes an addition. It does not supersede
anything.

---

## 1. What a Node is, briefly

Psyntient Node is a local-first research assistant. The user installs it on a
machine they control; it runs a local gateway, holds their own LLM provider key,
and stores their research in a Vault on that machine. psyntient.io is the
account layer: it knows a Node exists and which account it belongs to, and
nothing about what the Node holds.

Three credential planes (`AUTH_FLOW.md` §0):

- **Plane A** — user ⇄ psyntient.io (Supabase JWT, browser only)
- **Plane B** — Node ⇄ psyntient.io (`node_token`) ← *this document*
- **Plane C** — Interface ⇄ local daemon (`noetic_session`)

---

## 2. The problem

### 2.1 How pairing works today

Per `AUTH_FLOW.md` §2:

1. The Node starts a loopback HTTP server on `127.0.0.1:47123`.
2. It opens the user's browser to
   `psyntient.io/link-node?callback=http://127.0.0.1:47123/pair/return&session_nonce=…&device_name=…&os_info=…&node_version=…`
3. The user signs in and approves.
4. psyntient.io redirects the browser to that callback with `node_token`,
   `node_id`, `context_id`.
5. The Node verifies the `session_nonce` echo, writes `~/.psyntient/node.key`
   (mode 600), and immediately heartbeats to confirm the token works.

This is a good flow and we are not asking to change it. It has one structural
assumption: **the browser and the Node are the same machine.**

### 2.2 Why that breaks for a server install

We are building the ability to install a Node onto a cloud server (DigitalOcean
first) — which matters because a researcher's Node currently stops existing when
they shut their laptop. A long-running Node has to live somewhere that stays on.

In that shape there are two machines:

- the **laptop**, running the setup wizard and the browser
- the **server**, which will run the Node

`127.0.0.1:47123` now means different things to each. The browser resolves it to
the laptop; the Node lives on the server. The callback either lands on the wrong
machine or on nothing at all.

The same breaks for a developer who SSHes into a server and runs the installer
there: the loopback listener is on the server, and their browser is not.

### 2.3 The workaround that needs nothing from psyntient.io

Pair on the laptop, then copy `node.key` to the server over the SSH channel the
installer already uses. `node_token` is a Node↔site credential; nothing requires
the handshake to happen on the machine that ends up holding it, and the approval
screen can name the *server* because `device_name`/`os_info` are already
parameters we control.

We will likely implement this regardless, as a fallback. But it is not a good
primary design:

- It only works when a laptop wizard drives the install. It does nothing for the
  developer running the installer directly on a headless box.
- It puts the raw token on a second machine's disk in transit. Encrypted by SSH,
  but a hop the current design does not have.
- It cannot recover if the laptop's browser tab is closed at the wrong moment;
  the credential exists on the laptop and nowhere else.

So we would prefer a pairing flow that works when the Node has **no inbound
reachability and no local browser** — which is also the more general case.

---

## 3. Sovereignty constraints (non-negotiable)

These are product invariants, not preferences. Any proposal that violates one is
rejected regardless of convenience.

1. **psyntient.io never learns where a Node is installed.** Not the filesystem
   path, not the storage provider, not the cloud account, not the droplet ID,
   and not a "this is a cloud install" flag. There is no field for this and we
   will not add one.
2. **psyntient.io never learns anything about Vault location or contents.**
   `AUTH_FLOW.md` §3.1 has a `vault` field in the heartbeat response; this
   implementation deliberately does not act on it and treats it as unrelated to
   storage. Please do not build features that assume the site knows where a
   Vault is.
3. **The install never phones home.** Downloading the installer from
   psyntient.io is the site's entire involvement in installation. There is no
   install-started ping, no install-completed ping, no telemetry, no error
   reporting. Pairing stays the single deliberate, user-initiated moment the
   site learns a Node exists.
4. **The user's LLM provider key never leaves their machine.** It is not part of
   pairing and must never be requested by the site.

### 3.1 One thing we are *not* claiming

An outbound HTTPS request reveals its source IP to the receiving server. Any
pairing design where the Node talks to psyntient.io has this property, and the
existing heartbeat already exposes it every five minutes. So the proposal below
does not make this worse — but it does not fix it either, and we are not asking
you to pretend otherwise.

What we do ask: **do not persist the claim-time IP on the Node record as a
location attribute.** Ordinary transient request logging is fine. A
`node.last_seen_ip` column that turns into a map of where researchers work is
not.

---

## 4. Proposal: claim-based pairing

The Node makes an **outbound** request to collect a credential the user has
already approved in their browser. No inbound callback, no listener, no
assumption about where the browser is.

### 4.1 Sequence

```
Node (anywhere)                    Browser (anywhere)              psyntient.io
     │                                    │                              │
 1.  │ generate claim_secret (32B CSPRNG) │                              │
     │ claim_id = SHA256(claim_secret)    │                              │
     │                                    │                              │
 2.  ├── show/open link with claim_id ───▶│                              │
     │                                    │                              │
 3.  │                                    ├── GET /link-node?claim_id=…─▶│
     │                                    │   &device_name=&os_info=     │
     │                                    │   &node_version=             │
     │                                    │                              │
 4.  │                                    │   user signs in, approves    │
     │                                    │                              │
 5.  │                                    │◀── approval recorded ────────┤
     │                                    │    keyed by claim_id, TTL    │
     │                                    │                              │
 6.  ├── POST /api/public/nodes/claim ───────────────────────────────────▶│
     │   { claim_secret }                 │      hash, compare, consume  │
     │                                    │      MINT node_token here    │
     │◀── { node_token, node_id, context_id } ─── store token_hash ──────┤
     │                                    │                              │
 7.  │ write node.key 600, heartbeat to confirm                          │
```

Steps 1, 2, 6 and 7 are ours. Steps 3–5 are yours.

### 4.2 Why the queue must not hold a token

`AUTH_FLOW.md` §8 invariant 3: *"Only hashes are stored server-side —
`node_tokens.token_hash`. The site cannot recover a raw token."*

A naive version of this design queues the issued `node_token` until the Node
collects it, which would put a recoverable raw token at rest in your database
and break that invariant.

**So don't queue a token. Queue an approval, and mint the token at claim time.**
Step 5 stores only "the account holder approved a Node with this `claim_id`,
under this context". Step 6 generates `node_token` on the spot, stores its hash
exactly as today, and returns the raw value once in the response body. The
invariant is preserved unchanged.

### 4.3 What authenticates the claim

Whoever presents a valid `claim_secret` gets the Node identity, so the secret is
the entire security boundary.

- **32 bytes from a CSPRNG**, base64url encoded. Brute force is not a
  consideration at that width; rate limiting is defence in depth, not the
  control.
- **`claim_id = SHA256(claim_secret)`**, and only `claim_id` ever appears in the
  `/link-node` URL. URLs land in browser history, referrers and screenshots; the
  secret must not.
- **Constant-time comparison** server-side.
- **One-time consume.** The approval record is deleted (or marked consumed by an
  atomic conditional update, matching how you already handle interface tokens
  per invariant 4) in the same transaction that mints the token. A second claim
  with the same secret returns "already used", never a second token.
- **Short TTL** — we suggest 10 minutes from approval, but you own this.

This also subsumes `session_nonce` (invariant 2) for this path. The nonce exists
so the Node can verify the callback echo belongs to the request it started;
`claim_secret` does that job and additionally authenticates, which a nonce
echoed back through a redirect cannot.

### 4.4 Polling

The Node polls step 6 while the user is signing in. We would like:

- A **distinct response for each state**, so the wizard can say something true:
  `pending` (not yet approved), `denied` (user declined), `expired` (TTL passed),
  `consumed` (already claimed), `ok` (credential in body). A bare 404 for all of
  these makes every failure look the same to the user.
- **Your preferred poll interval and ceiling**, which we will honour exactly.
  Our default would be every 2s for up to 5 minutes unless you say otherwise.
- A rate limit you are comfortable with. Tell us the number and we will back off
  to it rather than discovering it in production.

### 4.5 What this fixes beyond server installs

- **Headless installs**, the motivating case.
- **Approving from a phone** while the Node runs on a desktop.
- **No inbound listener.** We delete the `127.0.0.1:47123` server entirely for
  this path — one less local service, one less port, one less thing a firewall
  or another process can take.
- **A real bug we hit this week.** Because the sign-in page opens in a *new*
  browser tab, the loopback callback's redirect back to the wizard was booting a
  second copy of the wizard at step one, in the tab the user was looking at,
  while the real flow continued in the tab behind it. With no callback there is
  no redirect and the class of bug disappears.

---

## 5. Questions for psyntient.io

The most important one first.

1. **Why were `/api/public/nodes/pair-init` + `/pair-poll`, and
   `/device-init` + `/device-poll`, deprecated?** `AUTH_FLOW.md` §5 lists them
   under "still mounted, do not wire into new Node code", and they are close in
   shape to what is proposed here. We would rather understand the constraint
   that killed them than rediscover it. If they were dropped for a security or
   Supabase-RLS reason, that reason probably applies to this proposal too.
2. Related: is `/api/public/nodes/preprovision-claim` — also on the deprecated
   list — already most of this? Could it be hardened and revived rather than
   replaced?
3. Does `/link-node` currently **require** a `callback` parameter, and does its
   server-side validation (invariant 1: https or loopback only) allow a request
   carrying a `claim_id` and *no* callback at all?
4. Does an unauthenticated public claim endpoint create a problem under your
   Supabase row-level security model? Invariant 9 says every `/api/public/*`
   write path verifies its caller inside the handler — here the caller is
   verified by possession of `claim_secret` rather than by a session. Is that
   pattern acceptable to you, and is there an existing one you would rather we
   match?
5. TTL, poll interval, and rate limit: what do you want?
6. Anything in your schema that assumes a Node record is created at *callback*
   time rather than at *claim* time?

We are not asking you to remove or change the existing `/link-node` loopback
flow. Local installs work today and should keep working exactly as they do.

---

## 6. Everything else blocking server installs

Listed for completeness so nobody assumes pairing is the only gap. **These are
ours, not psyntient.io's** — no action requested.

| Gap | State |
|---|---|
| SSH executor | Not built. The `Executor` interface exists with a local implementation; a remote one does not. |
| Provider key delivery | The local installer's `StoreKey` phase does this. The cloud-init script does not. |
| Install progress | cloud-init writes `/var/lib/psyntient-install.status`; nothing reads it. The user would watch nothing for ~30 minutes. |
| Reaching the Node | The gateway binds loopback on purpose — exposing it would put its token in cleartext on the open internet. An SSH tunnel is the supported route; nothing automates it yet. |
| Cost consent | Creating a droplet spends the user's money. No confirmation UI exists. |
| Failure cleanup | A failed install leaves a billing droplet behind. |
| Sizing vs Vault | A 4 GB droplet has an 80 GB disk. A researcher with three years of EEG data will exceed that. Unresolved. |
| SSH keypair | `AddSSHKey` takes a public key; nothing generates one. |

---

## 7. Where this ends up

The setup wizard should present two paths, chosen up front:

**This machine** — what exists today. Pair via loopback callback (unchanged),
install locally, warn about cloud-synced folders, add a desktop shortcut.

**A server I own** — provision or connect to a server, install over SSH, pair
via the claim flow, and finish by telling the user how to reach it. The
cloud-sync warning is meaningless here; the shortcut step is replaced by
connection instructions.

They share every phase that is genuinely the same, which is most of them — the
executor seam already exists so that the phases do not care which machine they
run on.

Separately and later: **migrating an existing Node to a server.** The intent is
right — a researcher who started on a laptop should be able to move — but it is
a distinct feature with its own hazards (a Vault too large to copy quickly, and
the fact that a `node_token` identifies one Node, so a migration must re-pair
rather than copy the credential). It is not part of this proposal.
