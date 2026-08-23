# Psyntient Node ⇄ psyntient.io — AUTH FLOW (definitive)

**Version:** 1.0 · **Status:** source of truth
**Scope:** how the local Node daemon, the Noetic Interface (browser app the daemon serves), and psyntient.io authenticate each other.

If any older doc (`Psyntient_Node_Auth_URLs.md`, `Psyntient_Node_Pairing_And_Interface_Auth.md`, phase briefings) conflicts with this file, **this file wins**.

---

## 0. TL;DR

```
                 ┌──────────────────────── psyntient.io (TanStack Start + Cloud) ─────────────┐
                 │  /auth            Supabase email+password / Google  → user JWT (browser)   │
                 │  /link-node       signed-in page: pick Account Context → mints node_token  │
                 │  /nodes           Node Manager: list / revoke / reassign vault             │
                 │  /api/public/nodes/heartbeat   Bearer node_token → validity + vault + cmds │
                 └───────────────────────────────────────────────────────────────────────────┘
                                 ▲  (1) browser, user JWT           ▲ (3) Bearer node_token
                                 │                                  │
   user's default browser ───────┘                                  │
        │ (2) 302 back to http://127.0.0.1:<port>/pair/return?node_token=…
        ▼
   ┌──────────── Psyntient Node (local machine) ────────────┐
   │ daemon  ~/.psyntient/node.key  (node_token, 0600)      │
   │   └── serves Noetic Interface at http://127.0.0.1:PORT │
   └────────────────────────────────────────────────────────┘
```

Three separate credential planes. Never mix them:

| Plane | Credential | Holder | Lifetime |
|---|---|---|---|
| **User ↔ website** | Supabase JWT (access + refresh) | the browser, on psyntient.io origin | ~1h access, auto-refresh |
| **Node ↔ website** | `node_token` (`nk_…`) | the daemon, on disk | durable until unpaired/revoked |
| **Interface ↔ daemon** | local `noetic_session` cookie | the browser, on `127.0.0.1` origin | ~30 days, local only |

The Node **never** sees the user's password or Supabase JWT. The website **never** sees vault contents or LLM API keys.

---

## 1. Plane A — User authenticates to psyntient.io

Standard Supabase auth, already live:

- `/auth` handles email+password and Google OAuth.
- Session is stored by `@/integrations/supabase/client` and read via `useAuth()` (`src/hooks/use-auth.ts`), which also loads `profiles` and `user_roles`.
- Protected server functions use `.middleware([requireSupabaseAuth])`; the browser attaches the bearer via `attachSupabaseAuth` in `src/start.ts`.
- Roles (`san_member`, `principal_advisor`, `admin`) live in `user_roles` and are **only** granted server-side.

Any Node-related page (`/link-node`, `/nodes`, `/pair`, `/pair-interface`) redirects signed-out users to
`/auth?redirect=<original path+query>&mode=signin`, so the pairing URL survives the round trip.

---

## 2. Plane B — Node pairs with the account (the only supported flow)

Pairing = "this machine belongs to this Account Context." It happens **once per Node**.

### 2.1 Trigger

The daemon starts and finds no `~/.psyntient/node.key`. Its `/status` returns `{ paired: false }`; the Interface renders a **Pair this Node** screen whose button calls the daemon's `POST /pair/start`.

### 2.2 Daemon opens the browser

```
GET https://psyntient.io/link-node
    ?callback=http%3A%2F%2F127.0.0.1%3A47123%2Fpair%2Freturn
    &session_nonce=<random 32+ chars>
    &device_name=Alex%27s%20MacBook%20Pro
    &os_info=macOS%2015.1%20arm64
    &node_version=0.3.1
```

| Param | Required | Rules |
|---|---|---|
| `callback` | yes | `https://…` **or** loopback `http://` on `localhost` / `127.0.0.1` / `::1` / `*.localhost`. Anything else is rejected server-side (`isSafeReturnUrl`). |
| `session_nonce` | strongly recommended | Node's replay defense. Echoed back verbatim. ≤128 chars. |
| `device_name` | recommended | ≤80 chars, human readable. |
| `os_info` / `node_version` | optional | ≤120 / ≤40 chars. |

Launch with `open` (macOS), `xdg-open` (Linux), `start` (Windows).

### 2.3 User approves on psyntient.io

`/link-node` (signed in) lists the user's **Account Contexts**, lets them create one, shows the device metadata, and on submit calls the `linkNodeToContext` server function. That handler, as the authenticated user:

1. Confirms via RLS that the caller owns the chosen `context_id`.
2. Inserts a row in `nodes` (`status: 'active'`) for that context.
3. Mints `node_token = "nk_" + 43 url-safe chars`, stores only `sha256(token)` in `node_tokens` plus a `token_prefix` for display.
4. Returns a redirect URL to the daemon's callback.

The raw token exists in exactly two places forever after: the redirect URL, and `~/.psyntient/node.key`.

### 2.4 Callback back to the daemon

Approval:
```
<callback>?node_token=nk_…&node_id=<uuid>&context_id=<uuid>&session_nonce=<echo>
```
Cancel:
```
<callback>?denied=1
```

The daemon's loopback server MUST:

1. Reject the callback if `session_nonce` doesn't match the one it generated.
2. Write `~/.psyntient/node.key`, `chmod 600`:
   ```json
   {
     "node_token": "nk_…",
     "node_id": "…",
     "context_id": "…",
     "base_url": "https://psyntient.io",
     "paired_at": "2026-08-23T22:00:00Z"
   }
   ```
3. Respond with a small "Paired — you can close this tab" page, then redirect the tab to the local Interface.
4. Immediately heartbeat once to confirm.

Treat `node_token` as opaque. Never log it, never print it in the Interface DOM, never send it to an LLM provider.

---

## 3. Plane B (runtime) — every subsequent Node → website call

```
Authorization: Bearer <node_token>
```

### 3.1 Heartbeat — `POST /api/public/nodes/heartbeat`

Call at daemon start and every ~5 minutes. Body optional: `{ "node_version": "0.3.1" }`.

`200`:
```json
{
  "ok": true,
  "node_id": "…",
  "context_id": "…",
  "vault": {
    "id": "…",
    "provider": "local | drive | null",
    "status": "…",
    "local_root_hint": "/Users/alex/PsyntientVault",
    "created_at": "…"
  },
  "commands": []
}
```

Server behavior: hashes the bearer, looks it up in `node_tokens` (rejects if missing or `revoked_at`), then updates `nodes.last_heartbeat_at` **only where `status = 'active'`**, and stamps `node_tokens.last_used_at`.

| Response | Meaning | Daemon action |
|---|---|---|
| `200` | valid | apply `vault` + drain `commands` |
| `401` | token unknown / revoked / malformed | delete `node.key`, re-enter pairing |
| `403` `"Node revoked"` | Node row not active (user revoked in `/nodes`) | delete `node.key`, re-enter pairing |
| `5xx` / network | transient | exponential backoff, keep working offline |

**Revocation is heartbeat-driven.** There is no push channel; worst-case revocation latency is one heartbeat interval. Keep it ≤5 min.

### 3.2 Vault reassignment

Vaults are bound to an **Account Context**, not to a Node. `/nodes` can point a context's vault elsewhere; the change reaches the Node on the next heartbeat via the `vault` block. The daemon must treat `vault` as authoritative on each beat, not cache it forever.

---

## 4. Plane C — Interface ⇄ daemon (local session)

The Noetic Interface is a React app served by the daemon on loopback. It **never** talks to psyntient.io for auth and never holds `node_token`.

- Interface → daemon local routes only. The daemon attaches the bearer when it needs the website.
- The daemon mints a local `noetic_session` cookie (HttpOnly, SameSite=Lax, ~30 days) so the Interface knows which Psyntient user it's acting as.

To establish that local identity there is one optional website hop, already implemented:

1. Interface (unauthenticated locally) opens `https://psyntient.io/pair-interface?node_id=<uuid>&return=<local url>`.
2. Signed-in user confirms; `approveInterfacePairing` mints a **one-time** token `nit_…` (row in `node_interface_tokens`, hash only) and 302s back to `<return>?one_time_token=…`.
3. The daemon calls `POST /api/public/nodes/interface-session-exchange` with `{ node_id, one_time_token }` and receives `{ user_id, user_email, context_id, expires_at }`. The token is marked consumed atomically — single use, node-bound, expiring.
4. The daemon mints the local `noetic_session` cookie from that attestation.

An already-paired Node does **not** re-pair when the Interface session expires — only step 1–4 repeat.

---

## 5. Canonical endpoint list

Everything the Node ever touches on psyntient.io:

| Purpose | Method | Path | Auth |
|---|---|---|---|
| Pair (open in browser) | `GET` | `/link-node?callback=…&session_nonce=…` | user JWT (page) |
| Heartbeat / token validity / vault / commands | `POST` | `/api/public/nodes/heartbeat` | `Bearer node_token` |
| Interface identity confirm (browser) | `GET` | `/pair-interface?node_id=…&return=…` | user JWT (page) |
| Interface one-time token exchange | `POST` | `/api/public/nodes/interface-session-exchange` | one-time `nit_…` in body |
| Unpair by emailed link (browser) | `GET` | `/nodes/unpair/<token>` | token in URL |

### Deprecated — still mounted, do **not** wire into new Node code

`/api/public/nodes/enroll` (install codes / provisioning tokens), `/api/public/nodes/pair-init`, `/pair-poll`, `/api/public/nodes/device-init`, `/device-poll`, `/api/public/nodes/confirm-poll`, `/api/public/nodes/preprovision-claim`, and the `/pair?code=…` page. These belong to the older install-code, device-code, and email-confirmation models. They remain live only for machines paired before the `/link-node` flow.

---

## 6. Base URLs

The daemon reads `PSYNTIENT_BASE_URL`, defaulting to production. Never hardcode an ephemeral preview URL.

| Environment | Base URL |
|---|---|
| Production | `https://psyntient.io` |
| Stable preview (testing) | `https://project--be0cb3c4-761b-47b5-aaf8-7c0e1ff6a7ac-dev.lovable.app` |

---

## 7. Local files on the Node

| Path | Contents | Mode |
|---|---|---|
| `~/.psyntient/node.key` | `node_token`, `node_id`, `context_id`, `base_url`, `paired_at` | 600 |
| `~/.psyntient/providers.json` | user-supplied LLM API keys — never leaves the machine | 600 |
| `~/.psyntient/config.json` | daemon port, vault root, heartbeat interval | 644 |
| `~/.psyntient/session` | local `noetic_session` state | 600 |

---

## 8. Security invariants (non-negotiable)

1. **Callback/return URLs** must be `https://` or loopback `http://`. Enforced server-side; do not weaken.
2. **Always send `session_nonce`** on pairing and verify the echo before persisting a token.
3. **Only hashes are stored server-side** — `node_tokens.token_hash`, `node_interface_tokens.token_hash`. The site cannot recover a raw token; a lost token means re-pair.
4. **Interface tokens are single-use, node-bound, and expiring.** Consumption is an atomic conditional update.
5. **Any 401/403 from heartbeat wipes `node.key`** and drops the Node into the unpaired state. Never retry a rejected token.
6. **The Node never receives the user's Supabase JWT**, password, or a service-role key.
7. **Roles and entitlements are server-side only** — the Node may display a tier it learned from heartbeat but must never self-grant.
8. **`node_token` is never exposed to the Interface's JavaScript.** The daemon is the only holder.
9. Every write path on `/api/public/*` verifies its caller inside the handler — the `public` prefix only bypasses site auth, not authorization.

---

## 9. State machine (daemon)

```
UNPAIRED ──/pair/start──▶ AWAITING_APPROVAL ──callback(node_token)──▶ PAIRED
   ▲                            │                                       │
   │                            └──?denied=1──▶ UNPAIRED                │
   │                                                                    │
   └────────── 401 / 403 "Node revoked" from heartbeat ◀────────────────┘

PAIRED ──heartbeat 5xx/offline──▶ DEGRADED (local work continues) ──200──▶ PAIRED
```

Local vault work continues in `DEGRADED`. Only an explicit `401`/`403` un-pairs.
