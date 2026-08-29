# Build plan — claim pairing and server installs (Node side)

**Scope:** our half. psyntient.io's half is frozen in
`SERVER_INSTALL_PAIRING_RESPONSE_2.md` §4 plus rebind.
**Ordering principle:** every phase must be verifiable on its own, on a path we
can already run, before the next one adds an unknown.

---

## Phase 0 — Validate what exists (in progress)

A full local install, end to end, in sandbox mode. It has never been run once.

This is not throat-clearing: the server path reuses `preflight`, `runtime`,
`clone-node`, `clone-engine`, `dependencies`, `build`, `configure`, `service`
and `provider-key` unchanged. That is eight of the ten phases. If any are
broken they are broken for both targets, and finding out now costs thirty
minutes instead of being tangled up with SSH failures later.

**Done when:** the wizard reaches "Installed." and hands off to a working app.
**Also validates:** the time-remaining estimate against a real machine, which is
the only way to learn how wrong the weight table is.

---

## Phase 1 — Claim pairing, Node side

**Blocked on:** psyntient.io shipping `claim-init` / `claim`. Testable against
their preview base URL before production.

### 1.1 The `node.prior` tombstone

`node.key` holds `node_token` **and** `node_id`, and invariant 5 wipes the file
whole on 401/403/404 — destroying the identifier rebind needs. Split them.

- `daemon/pairing.mjs`: at every wipe site, before unlinking `node.key`, write
  `node.prior` with `node_id`, `context_id`, `unpaired_at`. Mode 600 for
  consistency; it holds no secret.
- `isPaired()` keeps keying off `node.key` alone. A Node holding only a
  tombstone is unambiguously UNPAIRED — this must not become a third state.
- No expiry. A machine unpaired for a year is still the same machine.

**Verify:** force a 401 against a fake token (we have done this before against
the real API), confirm `node.key` is gone, `node.prior` exists with the right
`node_id`, and `isPaired()` is false.

### 1.2 Claim client — `daemon/claim.mjs` (new)

One module, used by both the app and (ported) the installer.

```
generateClaim()  → { secret, claim_id }      32B CSPRNG, base64url;
                                              claim_id = base64url(SHA256(secret))
claimInit(meta)  → { user_code, expires_at }  POST /api/public/nodes/claim-init
claimPoll(secret)→ { status, ... }            POST /api/public/nodes/claim
```

Rules that are easy to get wrong and must be in code, not comments:

- **The secret never enters a URL.** Only `claim_id` goes to `/link-node`.
- **Poll 3s ± 20% jitter, ceiling 5 minutes.** Their limit is 150 per claim per
  5 min; 3s polling with jitter peaks at ~125. Do not tighten the interval
  without re-checking that arithmetic — it was wrong once already.
- **Honour `retry_after` on 429 exactly.**
- **`prior_node_id` is sent only when re-pairing after a wipe**, never on a
  fresh install. Otherwise a deliberate second Node gets offered a rebind that
  would kill the first.
- **If `ok` returns a `node_id` different from the one we sent**, that is the
  site's silent fallthrough: we have a new identity. Clear `node_id`-scoped
  local state and drop the tombstone. Do not assume the rebind succeeded.
- **Keep the immediate post-claim heartbeat.** It is the end-to-end check that
  the token actually landed.

States to handle explicitly, each with distinct user-facing copy:
`ok` · `pending` · `denied` · `expired` · `consumed` · `not_entitled` ·
`rate_limited`. `not_entitled` is the one that must not read like an error —
it means "your subscription doesn't cover this", with a link.

### 1.3 Go port — `internal/phases/claim.go`

Same logic for the installer. Shares nothing with the JS by necessity (different
runtime, and the installer runs before a Node exists), so the two must be kept
in step deliberately — same failure mode as the duplicated provider list.

`AwaitPairing` and the `127.0.0.1:47123` listener stay, as the loopback
fallback. They are not deleted.

### 1.4 Surfacing `user_code`

In the wizard it is secondary — the browser opens automatically, so the code is
a fallback for "it opened on the wrong machine". In the CLI installer it is
primary: print the URL, the `XXXX-XXXX` code, and a countdown from `expires_at`.

**Verify Phase 1:** pair a throwaway Node against the preview URL through the
claim flow. Then force a 401, confirm the tombstone, re-pair, and confirm the
same `node_id` comes back. That second half is the whole point of the design and
is the thing most likely to be quietly broken.

---

## Phase 2 — Move the local install onto claim pairing

**Depends on:** Phase 1. **Blocks:** nothing after it, but de-risks everything.

Switch both wizards to claim as the primary flow, loopback as fallback when the
claim endpoints are unavailable (an older site, or a self-hosted base URL).

This exists as its own phase for one reason: it proves the new pairing on the
path we can already run end to end, before SSH is anywhere near the picture. If
claim pairing has a bug, we find it here, on a local install, not tangled up
with a droplet that costs money and takes thirty minutes to reach.

**Verify:** re-run Phase 0's full local install, now pairing via claim.

---

## Phase 3 — SSH executor

**Depends on:** nothing. Can be built in parallel with Phase 1.

`internal/executor/ssh.go` implementing the existing `Executor` interface —
`Run`, `WriteFile`, `ReadFile`, `Stat`, `MkdirAll`, `Download`, `Target`,
`Describe`. The seam already exists and the phases already branch on
`Target{OS,Arch,Home}` rather than `runtime.GOOS`, so no phase should need
changing. If one does, that is a bug in the split and worth fixing there rather
than special-casing.

Specifics that matter:

- **`Target()` runs `uname -sm` and `echo $HOME`** on the remote, mapped onto
  Go's vocabulary (`linux`/`amd64`). This is what stops us proposing
  `/Users/...` on a droplet and downloading a darwin tarball.
- **`Download` runs `curl` on the remote**, not a stream through the laptop.
  Pulling 50 MB down a home connection and pushing it back up is absurd when the
  droplet has a better link than we do.
- **Host key verification is not optional.** Show the fingerprint on first
  connect and require an explicit click — same dialog shape as the cloud-sync
  warning. An SSH client that auto-accepts turns "install on my droplet" into
  "install on whatever answered".
- **Key-based auth only. No password field.** DigitalOcean droplets ship with
  `PasswordAuthentication no`, so a password field would be dead on arrival for
  the platform we are targeting; and a key path means we hold a path, not a
  reusable root credential. For an encrypted key, delegate to `ssh-agent` and
  say `ssh-add` rather than prompting.

**Verify:** run the full existing phase list against a Linux box over SSH,
with no DigitalOcean involvement at all. A droplet the user already has, or a
local VM. This isolates "does the executor work" from "does provisioning work",
which are the two failures that otherwise look identical.

---

## Phase 4 — DigitalOcean provisioning

**Depends on:** Phase 3. The client and cloud-init already exist and are tested
against the OpenAPI spec, but nothing calls them and nothing has ever hit the
real API.

- PAT entry (same shape as the API key step: stdin/POST, held in memory, never
  written), then `Account()` to verify and show *which* account will be billed.
- Region and size pickers from the live API, filtered by `Suitable()` (≥4 GB,
  available in region), cheapest first, **with the monthly price shown**.
- SSH key: select an existing one from the account, or generate a keypair
  locally and register the public half. Nothing generates one today.
- **Explicit cost confirmation before `Create`.** This spends the user's money;
  it is not a step to infer consent for.
- Create, poll to `active` + public IP, wait for SSH, then hand off to the
  normal phase list via the SSH executor.
- **Cleanup on failure.** A failed install currently leaves a billing droplet.
  Offer to destroy it, and say plainly what it costs if they keep it.

Note the cloud-init script in `bootstrap.go` becomes largely redundant once the
SSH executor exists — the phases can do the work directly, which removes the
duplicated install logic the script's own comment flags as its main cost. Decide
at that point whether to keep it for an unattended path or delete it. Do not
maintain both by default.

---

## Phase 5 — Two paths in the wizard

Chosen up front, before anything else:

**This machine** — as today. Loopback or claim pairing, local install, cloud-sync
warning, desktop shortcut.

**A server I own** — provision or connect, install over SSH, claim pairing,
finish with how to reach it. The cloud-sync warning is meaningless here; the
shortcut step is replaced by connection instructions.

They share every phase that is genuinely the same, which is most of them.

### 5.1 Reaching a remote Node

The gateway binds loopback deliberately — exposing it would put its token in
cleartext on the open internet. So the final step for a server install is an SSH
tunnel:

```
ssh -N -L 18789:localhost:18789 root@<ip>
```

For v1 that is a copyable command with an explanation. Automating it (a managed
tunnel, or Tailscale) is a real follow-up and should not gate the first version.

---

## Cross-cutting, not phase-shaped

**Vault size vs droplet disk.** A 4 GB droplet has 80 GB. A researcher with
three years of EEG data will exceed it. The Node can measure its own Vault
locally, so the warning belongs in our wizard — psyntient.io correctly knows
nothing about this. Needed before anyone migrates a real Vault.

**Migration.** Moving an existing Node to a server is a separate feature and
should not be folded into install. Rebind is the right primitive: carry
`node_id`, re-pair on the new machine, the old token is revoked in the same
operation. Copy → verify → *the user* retires the old one, later, explicitly.
Never one operation, and no self-deleting cleanup script.

**Keeping the two pairing implementations in step.** Go and JS will drift. When
the claim protocol changes, both change. Worth a shared fixture — the same set
of recorded responses replayed against both clients — rather than trusting
discipline.

---

## Sequencing

```
Phase 0  ████                          (running now, ~30 min)
Phase 1      ████████                  (blocked on psyntient.io)
Phase 3      ████████████              (parallel, no dependency)
Phase 2              ████              (needs 1; de-risks 4 and 5)
Phase 4                  ████████      (needs 3)
Phase 5                      ██████    (needs 4)
```

Phases 1 and 3 are independent and can run together. Phase 2 is small and is the
cheapest insurance in the plan — it puts the new pairing on the one path we can
already exercise fully, before it has to work over SSH on a machine that bills
by the hour.
