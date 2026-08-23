# Psyntient Node — Migration Guide: Old Auth Flow → New `/link-node` Flow

**Audience:** Claude Code / Node daemon implementation team  
**Status:** Source of truth for Node-side migration  
**Companion doc:** `Psyntient_Node_AUTH_FLOW.md` (full protocol reference)

---

## Why the change

The old Node auth model had too many moving parts:

- **Install codes** that the user had to copy/paste
- **Pairing polls** and device-code flows that the daemon had to long-poll
- **Pre-provisioning tokens** that made the website responsible for minting Node identity before the Node existed
- **Multiple token types** (`nt_…`, install codes, device codes, provisioning tokens) that were hard to rotate and revoke

The new flow is simpler and more secure:

1. The Node daemon starts and opens the user's browser at `/link-node`.
2. The user signs in on the website (existing Supabase auth), picks an **Account Context**, and approves the pairing.
3. The website redirects back to a loopback URL with a single long-lived token: `node_token` (`nk_…`).
4. The Node stores that token and uses it for all future communication via the `/api/public/nodes/heartbeat` endpoint.

This removes the install-code/poll complexity, binds the Node to an Account Context (which owns vaults and attribution), and gives the website a clean revocation path.

---

## 1. Remove old endpoints

Delete or disable any code calling these endpoints:

| Old endpoint | Why remove it |
| --- | --- |
| `POST /api/public/nodes/enroll` | Replaced by `/link-node` browser pairing. |
| `POST /api/public/nodes/pair-init` | Replaced by `/link-node`. |
| `POST /api/public/nodes/pair-poll` | No more polling; the callback delivers the token. |
| `POST /api/public/nodes/device-init` | Device-code flow is deprecated. |
| `POST /api/public/nodes/device-poll` | Device-code flow is deprecated. |
| `POST /api/public/nodes/confirm-poll` | Confirmation polling is deprecated. |
| `POST /api/public/nodes/preprovision-claim` | Pre-provisioning tokens are no longer used. |

Also remove UI screens for:

- Install codes / pairing codes
- Device codes / email-confirmation loops
- Pre-provisioning keys
- Any "enter the code shown on the website" prompt

These are no longer part of the flow. If a machine is still paired with the old tokens, it will keep working until the token is revoked, but new pairings should use `/link-node`.

---

## 2. Implement the new `/link-node` pairing flow

This is the only supported way to pair a new Node.

### 2.1 When to trigger

Trigger when the daemon starts and finds no valid `~/.psyntient/node.key`.

### 2.2 Generate a session nonce

Generate a cryptographically random, URL-safe string of at least 32 characters.

```ts
import { randomBytes } from "crypto";

function makeSessionNonce(): string {
  return randomBytes(32).toString("base64url");
}
```

Persist it in memory only for the duration of the pairing attempt. The nonce prevents cross-site/cross-request injection of a fake token.

### 2.3 Pick a loopback port

Use a fixed default port or scan for an unused one. Example:

```ts
const PAIR_PORT = 47123;
```

The website only allows callbacks that resolve to `localhost`, `127.0.0.1`, `::1`, or `*.localhost`.

### 2.4 Open the browser

Construct this URL:

```
https://psyntient.io/link-node
  ?callback=http%3A%2F%2F127.0.0.1%3A47123%2Fpair%2Freturn
  &session_nonce=<nonce>
  &device_name=My%20Laptop
  &os_info=darwin-arm64
  &node_version=0.3.1
```

Use the platform's default-browser opener:

```ts
import { exec } from "child_process";
// macOS
exec(`open "${url}"`);
// Linux
exec(`xdg-open "${url}"`);
// Windows
exec(`start "" "${url}"`);
```

### 2.5 Serve a temporary loopback handler

Start a one-shot HTTP server on `127.0.0.1:47123` that listens for:

```
GET /pair/return
  ?node_token=nk_xxxxxxxx...
  &node_id=<uuid>
  &context_id=<uuid>
  &session_nonce=<nonce>
```

It can also return with `?denied=1` if the user declines.

### 2.6 Validate and persist

```ts
if (query.denied === "1") {
  // User declined. Stop pairing, show a message, retry later.
}

if (query.session_nonce !== rememberedNonce) {
  // Reject: possible CSRF or replay.
}

const nodeKey = {
  node_token: query.node_token,          // keep secret
  node_id: query.node_id,
  context_id: query.context_id,
  base_url: "https://psyntient.io",
  paired_at: new Date().toISOString(),
};
```

Write to `~/.psyntient/node.key` with restrictive permissions:

```ts
import { writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const dir = join(homedir(), ".psyntient");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const keyPath = join(dir, "node.key");
writeFileSync(keyPath, JSON.stringify(nodeKey, null, 2), { mode: 0o600 });
chmodSync(keyPath, 0o600);
```

Show a "Paired — close this tab" page, then redirect to the local Noetic Interface.

### 2.7 Confirm immediately

Fire one heartbeat right after persistence to confirm the token is accepted and to fetch the current vault assignment.

---

## 3. Update token shape and storage

### Old token(s)

- Multiple prefixes: `nt_…`, install codes, device codes, provisioning tokens
- Possibly stored in multiple files or in-memory maps

### New token

- A single `node_token` with prefix `nk_…`
- Stored in `~/.psyntient/node.key`
- The raw token is **never** logged, never sent to the Interface, and never sent anywhere except as a Bearer token in the heartbeat

### New `node.key` shape

```json
{
  "node_token": "nk_...",
  "node_id": "...",
  "context_id": "...",
  "base_url": "https://psyntient.io",
  "paired_at": "2026-08-23T22:00:00Z"
}
```

If you are migrating from an old token, overwrite the file with this new shape. Do not keep old token files around.

---

## 4. Replace status polling with heartbeat

The old flow may have used multiple status or poll endpoints. Replace them all with one endpoint.

### Request

```ts
const res = await fetch(`${baseUrl}/api/public/nodes/heartbeat`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${nodeKey.node_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    node_version: "0.3.1",
  }),
});
```

### Response shape

```json
{
  "node_id": "...",
  "context_id": "...",
  "status": "active",
  "tier": "san",
  "vault": {
    "id": "...",
    "name": "...",
    "local_root_hint": "...",
    "reassigned_at": "..."
  },
  "commands": []
}
```

### How to handle status codes

| Status | Meaning | Action |
| --- | --- | --- |
| `200` | Healthy and authorized | Apply `vault` as authoritative. Process `commands`. |
| `401` or `403` | Token revoked, Node blocked, or context deleted | **Delete `node.key` and return to unpaired state.** Do not retry. |
| `404` | Node record missing | Treat as revoked; delete key and re-pair. |
| `5xx` / network error | Transient issue | Back off and continue local work. |

### Recommended interval

Call heartbeat at least once every 5 minutes while the daemon is running. Call it immediately after pairing, after waking from sleep, and after any network change.

---

## 5. Handle vault reassignment

A vault is owned by the **Account Context**, not by the Node. The website can reassign which vault a Node sees.

### Why this matters

If a user has a personal vault and later creates an institutional vault, the Node might be pointed at the new vault without re-pairing.

### Implementation

Compare the heartbeat's `vault.id` and `vault.local_root_hint` to what you are currently using.

```ts
if (heartbeat.vault.id !== currentVaultId) {
  // The context's vault has changed.
  // 1. Flush any pending writes to the old local root.
  // 2. Create or mount the new local root at `vault.local_root_hint`.
  // 3. Update the local index/metadata to point at the new vault.
  // 4. Start reading/writing from the new location.
}
```

Do not cache the vault forever. The heartbeat response is the authoritative source of truth.

---

## 6. Update Noetic Interface auth

The Noetic Interface is the local React/Vite app served by the daemon. It must not hold the `node_token`. Instead, it uses short-lived Interface tokens minted by the website.

### Old flow (if it existed)

Possibly the Interface tried to call the website directly or used a long-lived token.

### New flow

1. The daemon opens the browser at:
   ```
   https://psyntient.io/pair-interface?node_id=<uuid>&return=http%3A%2F%2F127.0.0.1%3A<port>%2Finterface%2Freturn
   ```
2. The website confirms the user is signed in and the Node is paired.
3. The website 302s back to:
   ```
   http://127.0.0.1:<port>/interface/return?one_time_token=nit_...
   ```
4. The daemon POSTs the one-time token to the website:
   ```ts
   const res = await fetch(`${baseUrl}/api/public/nodes/interface-session-exchange`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       node_id: nodeKey.node_id,
       one_time_token: query.one_time_token,
     }),
   });
   ```
5. On success, the response contains an interface session. Mint a local `noetic_session` cookie:
   - HttpOnly
   - SameSite=Lax
   - Path `/`
   - Expires ~30 days
6. The Interface reads the cookie from the daemon's own HTTP server. The cookie is never sent to psyntient.io.

If the Interface session expires, repeat only steps 1–4. The Node itself stays paired.

---

## 7. Use the right base URL

Read the base URL from an environment variable or a config file, defaulting to `https://psyntient.io`.

```ts
const baseUrl = process.env.PSYNTIENT_BASE_URL || "https://psyntient.io";
```

### Why

Preview URLs (`https://...-dev.lovable.app`) and custom domains may be used during testing. Production builds must always point to `https://psyntient.io`.

---

## 8. Enforce local-only callbacks

The daemon must only register loopback addresses as return URLs:

- `localhost`
- `127.0.0.1`
- `::1`
- `*.localhost`

The website also enforces this, but the daemon should reject anything else before opening the browser. This prevents the token from being delivered to a remote attacker who somehow controls the `callback` query parameter.

---

## 9. Summary checklist

- [ ] Remove old `/nodes/enroll`, `/nodes/pair-*`, `/nodes/device-*`, `/nodes/confirm-poll`, `/nodes/preprovision-claim` calls.
- [ ] Remove install-code, device-code, and pre-provisioning UI.
- [ ] Implement `/link-node` browser pairing with `session_nonce` verification.
- [ ] Store `node_token` (`nk_…`) in `~/.psyntient/node.key` with mode `0600`.
- [ ] Use `POST /api/public/nodes/heartbeat` with `Authorization: Bearer <node_token>`.
- [ ] Treat `vault` from heartbeat as authoritative; handle reassignment.
- [ ] Delete `node.key` on any `401`/`403` and re-enter pairing.
- [ ] Update Interface auth to `/pair-interface` + `/interface-session-exchange`.
- [ ] Read `PSYNTIENT_BASE_URL` from env; default to `https://psyntient.io`.
- [ ] Enforce loopback-only return URLs.

---

## 10. Security rules to keep in mind

- **Never log the raw `node_token`.** It is the root of trust for the Node.
- **Never expose the `node_token` to the Interface.** It is daemon-only.
- **Never send the user's Supabase JWT to the Node.** The website authenticates the user; the Node authenticates with its own token.
- **Always verify `session_nonce` before persisting a token.**
- **Only hashes are stored on the website.** If the token is lost, re-pair. There is no recovery.
- **Wipe on 401/403.** A rejected token means the website has revoked the Node; continuing to use it is a security bug.
