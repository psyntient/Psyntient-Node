# How the Interface authenticates to the gateway — and why onboarding 401s

**Status:** research, with a recommendation. Nothing changed yet.
**Prompted by:** the onboarding wizard silently not appearing on a fresh Node.

---

## 1. Yes, we are injecting auth — and that part is fine

The pattern is the standard one for a local service with a browser UI: the
process that has the secret puts it in a URL, opens a browser, and the page
trades it for something narrower. Jupyter is the canonical example
(`http://localhost:8888/?token=…`, exchanged for a session cookie); the same
shape shows up in every "local server, browser front end" tool.

Ours, concretely:

1. `daemon/launch.mjs` reads `gateway.auth.token` from `openclaw.json` and opens
   `http://127.0.0.1:<port>/#gatewayUrl=…&token=…`.
2. The token is in the **fragment**, so it is never sent to a server and never
   lands in a log or a referrer. That is the right call and should stay.
3. The Control UI consumes it at boot, exchanges it for a **per-device operator
   token**, persists that under `openclaw.device.auth.v1:<gatewayUrl>`, and
   strips the hash.
4. Later requests carry the device token, not the gateway secret.

Step 3 is a real security property, not ceremony: the shared secret is full
operator access to the gateway, and it stays out of browser storage where an
extension or an XSS could read it. The device token is narrower and revocable.

None of that is the problem.

---

## 2. The problem: two validators, and our routes are on the wrong one

The gateway authenticates HTTP requests through **two different paths**, and
they accept different credentials.

| Surface | Handler | Accepts |
|---|---|---|
| Control UI (`/`, assets, its own endpoints) | `src/gateway/control-ui.ts` | shared secret **and device tokens** (`authorizeControlUiDeviceReadToken`) |
| Plugin routes (`/__openclaw__/…`, `auth: "gateway"`) | `src/gateway/http-auth-utils.ts` → `authorizeHttpGatewayConnect` | **shared secret only** (bearer compared as `{token, password}`) |

Every Psyntient route is registered with `auth: "gateway"`
(`Noetic_Interface/gateway-plugin/index.js`). `docs/plugins/admin-http-rpc.md`
is explicit about what that means: *"shared-secret auth … `Authorization: Bearer
<token-or-password>`"*.

So the browser holds a credential the Control UI accepts and the plugin routes
do not. `GET /__openclaw__/psyntient/onboarding` with the device token returns
`401 Unauthorized`. Verified directly in the page.

### 2.1 What the gate does with that 401

`ui/src/main.ts`:

```ts
const res = await fetch("/__openclaw__/psyntient/onboarding", { headers });
if (!res.ok) {
  return; // Routes unavailable (plain OpenClaw gateway): never block the app.
}
```

The fail-open is deliberate and correct in intent — a Node running plain
OpenClaw should not be blocked by a missing Psyntient route. But it cannot tell
"this route does not exist" from "I am not authorised to ask", and both land
here. **A Node with genuinely unfinished setup shows no wizard, silently.**

### 2.2 Why it ever appeared to work

`launch.mjs` puts the token in the hash on **every** launch, and the gate reads
the hash first. So opening the app through the launcher works. Opening it any
other way — a bookmark, the PWA, a typed URL — does not. Which is precisely
what the final onboarding step encourages the user to set up.

---

## 3. The mechanism OpenClaw provides, and why it does not fit

There is a designed path for "a plugin's UI needs to call that plugin's routes
from a browser": `controlUiPluginGrant`. The gateway issues a **cookie**
carrying grants, and `authorizePluginGatewayHttpRequestOrReply` checks it before
falling back to bearer auth.

Three constraints make it a poor fit as things stand:

- Grants come from `listControlUiPluginTabAuthGrants(scopes)` — they are issued
  to plugins that register a **Control UI tab**. Ours registers none.
- The cookie handoff is **GET/HEAD only**, by design: *"this handoff is
  read-only; mutations stay on explicit Gateway auth surfaces."* Our status read
  is a GET, but saving a key, pairing and completing onboarding are POSTs.
- A mismatched grant is an explicit `401`, so it fails closed.

---

## 4. Options

### A. Register a Control UI tab to earn the cookie grant

Uses the mechanism as designed. Fixes the status GET. Does **not** fix the
POSTs, and adds a tab to the UI we may not want.

### B. Stamp onboarding state into the served HTML — *recommended*

The gateway already rewrites `index.html` on the way out
(`rewriteControlUiIndexHtmlPublicAssetHrefs`, then a `<html …>` attribute
rewrite for the base path and terminal flag). The Control UI HTML is served by
the handler that **does** accept device tokens.

So the gateway can stamp the answer onto the document it is already serving to
an already-authenticated browser:

```html
<html data-psyntient-onboarding="pending|complete" …>
```

Consequences:

- **No credential problem.** The gate stops making an authenticated request at
  all, so there is nothing to authorise.
- **No latency.** The gate's status call costs 10–15s today because
  `hasAnyProvider()` shells out to the OpenClaw CLI; that is why there is a
  `sessionStorage` cache papering over it. Computed server-side, once, the cost
  disappears and the cache can go.
- **No fail-open ambiguity.** Attribute absent means plain OpenClaw; attribute
  present means a real answer.
- An attribute needs no CSP hash, unlike an injected inline script.

The POST routes still need gateway auth — but they are only reached **from
inside the wizard**, which is a context we control and can hand a credential to
deliberately, rather than every page load needing one.

### C. Persist the gateway secret in the browser

Would work immediately and I recommend against it. The device-token exchange
exists so the shared secret is not sitting in `localStorage`. Undoing that to
save a plumbing change trades a real security property for convenience.

### D. Move the routes out of the plugin into the fork

`src/gateway/psyntient-routes.ts` already exists as our one intrusion into the
OpenClaw tree, and its own comment says to keep it thin and put new endpoints in
the external plugin. Moving logic in would fight CLAUDE.md rule 2 (code that
survives an OpenClaw update lives outside the tree).

---

## 5. Recommendation

**B**, with the wizard's POSTs handled separately.

It is the smallest change that removes the class of failure rather than patching
an instance, it deletes the 10–15s status call and the cache built to hide it,
and it puts the answer on the surface that already authenticates the browser
correctly.

Worth doing at the same time: make the gate distinguish **"route absent"** from
**"unauthorised"**. Fail-open is right for the first and hides a bug in the
second. Even with B in place, that distinction is what would have surfaced this
in an afternoon rather than after a full install.

---

## 6. What this does not explain

The freshly installed Node also shows OpenClaw's own "Connect your AI" screen,
and `models auth list` reports `provider: null, profiles: []`, while the
Psyntient route reported `hasProvider: true`. So the `provider-key` phase
recorded a key in `~/.psyntient-sandbox/home/providers.json` without OpenClaw's
auth store accepting one. That is a separate bug from this document's subject
and needs its own pass.
