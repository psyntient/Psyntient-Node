# Psyntient Node — hard rules for working in this repo

Psyntient Node is a self-contained app. OpenClaw is bundled **inside**
`Cortex/Open-Claw/` for this product — never rely on, install, or invoke a
globally-installed OpenClaw. Getting this separation right was non-trivial;
do not casually deviate from it.

## 1. Never use global OpenClaw

Never run bare `openclaw` from PATH / `~/.npm-global`. Always:

```bash
cd /Users/woodleybrown/Psyntient_Node/Cortex/Open-Claw
export OPENCLAW_STATE_DIR="$HOME/.psyntient/openclaw-state"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
node openclaw.mjs <command>
```

(or `pnpm openclaw` from that same directory with the same exports).

## 2. Code, state, and workspace are three different things

| What | Where | Nature |
|------|-------|--------|
| Code | `Cortex/Open-Claw/` | upstream package; git-updatable / replaceable |
| State | `~/.psyntient/openclaw-state/` | sessions, gateway token, config, DBs — must survive OpenClaw updates |
| Workspace | `Cortex/Cortex_Agent/` | agent identity, memory, skills config — Psyntient-owned, not inside the Open-Claw git tree |

## 3. Never put OpenClaw state inside `Open-Claw/`

State inside the git checkout gets wiped or diverged on pull/replace. Always
point at `OPENCLAW_STATE_DIR=~/.psyntient/openclaw-state`.

## 4. Never put agent files at the Node root

The agent lives under `Cortex/Cortex_Agent/` only.

## 5. Gateway service must target the bundle

The LaunchAgent (and later Linux/Windows service adapters) must:

- run `.../Cortex/Open-Claw/dist/index.js` (or the current package entry)
- pass `OPENCLAW_STATE_DIR` + `OPENCLAW_CONFIG_PATH`
- use the fixed product port (default `18789`) unless intentionally changed
  and updated everywhere it's referenced

## 6. Workspace pointer must stay on Cortex_Agent

After any OpenClaw update or config rewrite, verify:

```
agents.defaults.workspace = /Users/woodleybrown/Psyntient_Node/Cortex/Cortex_Agent
```

If OpenClaw resets defaults to `~/.openclaw/workspace`, fix it back.

## Safe OpenClaw update procedure

1. Stop the Gateway service.
2. Update code only: `git -C Cortex/Open-Claw pull` (or replace the tree
   carefully). Bump `Cortex/versions.json` to record the new installed ref.
3. Rebuild if required (`pnpm install` / `pnpm build` in `Open-Claw/` only —
   avoid mass optional cross-OS downloads if possible).
4. Do **not** delete `~/.psyntient/openclaw-state`.
5. Reinstall the service if the entrypoint path changed:
   `node openclaw.mjs gateway install --force` (with env vars set).
6. Start the Gateway; confirm:
   - status uses the bundled path under `Psyntient_Node`
   - config/state still under `~/.psyntient/openclaw-state`
   - workspace still `Cortex/Cortex_Agent`
   - dashboard/chat still works on `18789`

## Connection that must never break

```
Noetic Interface / daemon
    → Gateway WebSocket (localhost:18789)
        → OpenClaw runtime (code in Cortex/Open-Claw)
            → agent workspace (Cortex/Cortex_Agent)
            → state (~/.psyntient/openclaw-state)
```

Updating OpenClaw = replace code. Preserve state + workspace + env wiring +
service entrypoint.

## 7. Noetic Interface must be WebClaw, not a greenfield UI

Clone `https://github.com/ibelick/webclaw` into `Noetic_Interface/web/`.
Do not build a custom chat UI from scratch — rebrand WebClaw instead.

- **Rebrand**, don't replace: full spec is
  `Noetic_Interface/branding/BRANDING.md` ("Psyntient Ink & Gold v1.0" —
  read that first, it's authoritative over anything summarized here);
  `theme.json` in the same directory is a machine-readable token subset of
  it. Logo/avatar source images are in `Noetic_Interface/branding/assets/`.
  Never ship WebClaw's default look. Applied to the `Noetic_Interface/web/`
  checkout on the `psyntient` branch (commit `6e27ec7`, 2026-08-23) — see
  that commit message for exactly what was and wasn't touched yet
  (Settings dialog, Sessions→Projects rename, empty-state logo, and a
  radius/motion audit are still open).
- **Keep** WebClaw's strong UX pieces: voice-to-text, streaming text
  appearance/highlight, settings page, chat threads. Trim excess chrome.
  Map WebClaw "threads" to "Projects" + open chat (not yet done).
- **No separate agent stack.** The Interface is a pure client of the
  already-running bundled Gateway — wire it with Gateway URL + token only.
  No product email/password login, ever.
- Default Gateway target: `http://127.0.0.1:18789/` (same Gateway this
  daemon already manages — see `daemon/openclaw-control.mjs`).

### First-launch key gate and Settings key rotation

The user supplies their own LLM provider API key; it is never uploaded to
psyntient.io and never leaves the Node.

- **First launch, no usable key:** show a blocking setup dialog. Chat must
  not become available until a key is entered. This gate is already
  implemented at the daemon layer — see `ensureProviderKeyBlocking()` in
  `daemon/launch.mjs` and `daemon/prompt-macos.mjs` (an explicit interim
  stand-in using native macOS dialogs; replace with an in-Interface modal
  in Phase E, but keep the same blocking contract). Once a valid key
  exists, never show this gate again — checked live against OpenClaw's own
  auth store (`hasAnyProvider()` in `daemon/providers.mjs`), not a cached
  flag.
- **Settings allows adding, replacing, or rotating keys** — **built**
  (2026-08-23, `Noetic_Interface/web` commit `b034277`): a "Provider key"
  section in `settings-dialog.tsx` (provider dropdown + key input + gold
  Save button) posts to `apps/webclaw/src/routes/api/provider-key.ts`,
  which spawns `daemon/providers.mjs`'s `add` CLI path — **the same
  `setProviderKey()` the first-launch gate uses**, no second
  implementation. Verified live: rotated a real (throwaway) key through
  the actual UI, config updated, Gateway restarted, UI showed a real
  success state.
- **Resolved differently than expected:** the dependency once flagged
  here — "Settings can't shell out to the daemon, needs `Noetic_API`
  (Phase J)" — turned out unnecessary. WebClaw's own dashboard server
  already *is* a Node backend with filesystem access; it can spawn
  `daemon/providers.mjs` directly as a subprocess. No `Noetic_API` slice
  needed for this. `provider-key.ts` duplicates the small
  `SUPPORTED_PROVIDERS` list by hand (rather than importing
  `daemon/providers.mjs` directly) to avoid Vite's SSR bundler trying to
  analyze code outside the app's own `src/` — keep that list in sync if
  `daemon/providers.mjs`'s list changes.
- **Missing/invalid key after a Settings change** returns the user to a
  clear "connect a model" / re-enter-key state — **not** a re-run of full
  Node pairing (Phase G). Key rotation and device pairing are unrelated
  and must stay decoupled.

### First-run order: BYO key gate, then pairing gate

1. Gateway up (`ensureRunning()`).
2. If no usable LLM key exists, show the blocking BYO key dialog first
   (see above) — save and apply it to OpenClaw.
3. Immediately after that (or if a key already existed), check pairing: if
   the Node isn't paired with psyntient.io, start the pairing flow (open
   `https://psyntient.io/link-node?...`; user signs in and links a
   Context; daemon stores the Node Access Token).
4. Neither gate re-shows on later launches unless invalidated: the key
   goes missing/invalid, or the node token gets revoked.

Settings can change the LLM key anytime (see above). Pairing is only for
Node↔psyntient.io license/identity — never for chat login, and the two
must stay decoupled (a bad LLM key must never trigger re-pairing, and
vice versa).

**Filename discrepancy found (2026-08-23), unresolved:** the product note
describes a single `~/.psyntient/node.key` file, but this machine already
has real, working pairing state under different names: `node_key`
(Ed25519 identity key), `node_token` (the Node Access Token, `nt_`
prefixed), and `config.json` (`node_id`/`context_id`/`server_url`).
`daemon/pairing.mjs`'s `isPaired()` checks the files that actually exist,
not `node.key`, so it doesn't wrongly report "unpaired" — but Phase G still
needs to reconcile which scheme is authoritative before building the real
`/link-node` flow. Don't rename/restructure these files without confirming
with the user first; they're live credentials, not debris.

Phase G's actual pairing flow (the `/link-node` protocol, how the daemon
receives the token back) is not yet implemented — `ensurePairedNotice()`
is a non-blocking placeholder that only logs. Do not treat it as the real
gate; building the real one needs the actual protocol spec.

### Running WebClaw locally (dev mode)

- `Noetic_Interface/web/` is its own git clone (like `Cortex/Open-Claw` and
  `Cortex/Cortex_Agent` — see rule 2's pattern). Our changes live on a
  `psyntient` branch, not `main` — `main` tracks upstream so it stays
  pullable without conflicting with our patches. Installed ref/branch
  recorded in `Noetic_Interface/config.json`.
- `.env` (gitignored, machine-local) needs `CLAWDBOT_GATEWAY_URL` and
  `CLAWDBOT_GATEWAY_TOKEN` (the real value is in
  `~/.psyntient/openclaw-state/openclaw.json`'s `gateway.auth.token`,
  redacted from CLI output — read the config file directly). The app reads
  these via bare `process.env`, not Vite's `import.meta.env`, so a plain
  `.env` file is **not** auto-loaded by `vite dev` — the dev command must
  explicitly `source .env` first (see `.claude/launch.json`'s
  `noetic-interface` config for the working incantation).
- **Required patch, not optional/cosmetic:** upstream webclaw `main`
  hardcodes Gateway protocol version 3
  (`apps/webclaw/src/server/gateway.ts`, `minProtocol`/`maxProtocol`), but
  our bundled OpenClaw requires protocol 4 minimum. No upstream tag/release
  fixes this as of 2026-08-23 (checked — no tags exist at all). Without
  this bump the app cannot connect to the Gateway at all (every API route
  fails). This is committed on the `psyntient` branch and must be
  re-applied (or re-verified as no longer needed) on every WebClaw update,
  same as the branding pass below — check the live `PROTOCOL_VERSION` in
  `Cortex/Open-Claw/packages/gateway-protocol/src/version.ts` against
  webclaw's hardcoded value whenever either side updates.

### Known issue: live stream display could stick on "Generating..." — mitigated, root cause still deferred

Upstream bug (not our protocol patch, not the Gateway/agent/daemon) in
`apps/webclaw/src/screens/chat/hooks/use-chat-stream.ts`. Its `EventSource`
reconnects on every session load (opens a generic-friendlyId stream, then
immediately replaces it with a session-key-specific one), and if an agent
run's `final` event arrives during that reconnect window, the UI never
gets the event that would trigger `refreshHistory()`. **Data is never lost
or wrong** — `GET /api/history` always has the real, complete conversation.

**Mitigated (2026-08-23):** `chat-screen.tsx`'s `startRun()` already had a
safety-net timeout that force-refetches history if the live event never
arrives — it was just set to 120s, so the app looked permanently broken
long before it self-healed. Reduced to 15s. Resets on every `delta` event,
so a genuinely slow tool call or thinking pause doesn't trigger it early.
This does not fix the underlying reconnect race (still deferred — the
merge/dedup logic in `use-chat-stream.ts` is substantial, ~700 lines,
worth a dedicated pass) but bounds the worst case from "requires a manual
reload" to "self-heals within ~15s."

**Separately, a real (non-flaky) bug was found and fixed in the same
area:** `textFromMessage()` in `screens/chat/utils.ts` only ever read
`msg.content` as an array-of-parts, but the Gateway sends **user**
message content as a plain string — every user message rendered as an
empty bubble, unconditionally, not intermittently. Fixed to handle both
shapes; `GatewayMessage.content`'s type widened to match. This was the
actual cause of "chat doesn't show the text I submitted," separate from
the stream-timing issue above.

### Production serving: daemon/interface-control.mjs

The launcher (`daemon/launch.mjs`) does **not** run `vite dev` — that's
dev-only tooling. It runs a real production build
(`pnpm build` in `Noetic_Interface/web/`, output at
`apps/webclaw/dist/server/server.js`) served via `vite preview` as a
detached background child process, tracked by PID file
(`~/.psyntient/interface.pid`), fixed port `3210` (distinct from the port
used for ad-hoc dev testing — see `.claude/launch.json`'s
`noetic-interface` config, currently `3111` — so both can run at once
without conflict). Logs at `logs/interface.log`.

**This is deliberately NOT a launchd/systemd service yet** — no
install/start/stop/status parity with `daemon/openclaw-control.mjs`'s
Gateway management. That's real follow-up scope, not done. The
`ensureRunning()`/`stop()`/`url()` API in `interface-control.mjs` is
written so upgrading to a real service later doesn't change callers.

**Gotcha found by testing, not documented anywhere obvious:** both `vite
preview` (production) and `vite dev` (dev testing) bind IPv6 `::1` only
by default — `curl`/`fetch` against `127.0.0.1` gets a bare connection
refused even though the server is genuinely up and `localhost` works
fine. Must pass `--host 127.0.0.1` explicitly to both. If a future change
to how the Interface is served drops this flag, health checks will
silently fail to connect even though the process is running — don't
assume "not listening on 127.0.0.1" means "not running." For `vite dev`
specifically, passing the flag through `pnpm dev -- --host 127.0.0.1`
does NOT work — pnpm's multi-hop script forwarding (root → app package →
vite) mangles the `--` separator; `.claude/launch.json`'s dev config
bypasses this by calling `npx vite dev` directly inside
`apps/webclaw/` instead of going through the `pnpm dev` script chain.

**Gateway token wiring:** `getGatewayEnv()` in `interface-control.mjs`
reads `gateway.auth.token` directly from `openclaw.json` — the CLI's own
`gateway status --json` redacts it (`__OPENCLAW_REDACTED__`), so this is
the one place in the daemon layer that reads the raw config file instead
of going through `openclaw-cli.mjs`'s `runCli()`.

**Also observed:** the same transient Gateway-WS-reconnect flakiness
documented above for dev mode also shows up in this production-preview
serving path (a `ping` briefly returned "Timed out waiting for
connect.challenge event" once, then was consistently healthy again within
seconds). Same category, same non-issue for data integrity.

### Safe WebClaw update procedure

Updating WebClaw means replacing `Noetic_Interface/web/` and re-applying
`Noetic_Interface/branding/` **and** the protocol-version patch above on
top. Never wipe `Working_Memory/`, `Neural_Vault/`, or `~/.psyntient/` as
part of a WebClaw update — those are unrelated to the Interface's own code
and must survive it exactly like OpenClaw state must survive an OpenClaw
update (rule 3 above).

## 8. Vault storage and installer — phase rules

Follow the locked phase order; don't build the full native installer
early, don't require cloud storage at install or first launch.

- **Default Vault is local**: `Neural_Vault/` under the Node root
  (`/Users/woodleybrown/Psyntient_Node/Neural_Vault`, already scaffolded
  in Phase A with `vault.config.json`'s `storageMode: "local"`). The Node
  must work fully with local-only Vault — cloud is never a hard
  requirement.
- **Cloud Vault is optional and later** (Phase H): add an Interface
  Settings UI so the user can switch Vault provider from Local to cloud
  (Google Drive first). OAuth is run by the Node/daemon — psyntient.io
  never holds those tokens, same sovereignty principle as everything else
  in this file.
- **Phase H** = local Vault activation + the Settings UI to relocate/
  switch provider (local path or Google Drive). Not started.
- **Phase L (Installer)** = the full native installer (pkg/msi/etc.,
  install targets, GUI shortcut). Leave this until the end — until then,
  use the existing directory layout and the launcher/daemon work from
  earlier phases (see `daemon/interface-control.mjs`'s PID-file approach,
  section 7's "Production serving" note above — that's intentionally not
  a real launchd/systemd service yet, and doesn't need to become one
  before Phase L).
- **MVP does not include** the full installer or cloud Vault — only
  Gateway up, BYO API key on first launch, pairing when needed, and chat
  via WebClaw against the bundled OpenClaw.

Full installer-flow and Vault-provider product details:
`Psyntient_Node_Project_v2.md`. Phase timing (H then L): the Development
Plan.

---

See `Psyntient_Node_Development_Plan.md` and `Psyntient_Node_Project_v2.md`
(spec v2.4, wins on conflicts) for full product context.
