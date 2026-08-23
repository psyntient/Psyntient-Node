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

- **Rebrand**, don't replace: theme tokens live in `Noetic_Interface/branding/`
  (see `theme.json` — dark ink backgrounds, cream text, gold accents; see
  full palette/type/avatar/motion spec there). Never ship WebClaw's default
  purple/indigo-on-white look.
- **Keep** WebClaw's strong UX pieces: voice-to-text, streaming text
  appearance/highlight, settings page, chat threads. Trim excess chrome.
  Map WebClaw "threads" to "Projects" + open chat.
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
- **Settings must allow adding, replacing, or rotating keys** (switch
  providers or paste a new key) at any time after first launch. Saving in
  Settings must: update `providers.json` metadata, re-apply the key to
  OpenClaw via the same `setProviderKey()` path the first-launch gate
  uses, and restart/reload the Gateway so chat picks up the new
  credential. **Do not build a second code path for this** — Settings and
  the first-launch gate must call the same daemon function.
- **Dependency this creates:** Settings runs in the browser and cannot
  shell out to the daemon directly, so it needs an API surface — most
  naturally a `Noetic_API` (Phase J) endpoint that calls
  `daemon/providers.mjs`'s `setProviderKey()`. Phase J is late in the
  locked phase order; Phase E may need to ship a minimal slice of that API
  early (or some other IPC bridge) specifically for key management, rather
  than waiting for the full Noetic API phase. Flag this to the user before
  assuming either way when Phase E starts.
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

### Safe WebClaw update procedure

Updating WebClaw means replacing `Noetic_Interface/web/` and re-applying
`Noetic_Interface/branding/` **and** the protocol-version patch above on
top. Never wipe `Working_Memory/`, `Neural_Vault/`, or `~/.psyntient/` as
part of a WebClaw update — those are unrelated to the Interface's own code
and must survive it exactly like OpenClaw state must survive an OpenClaw
update (rule 3 above).

---

See `Psyntient_Node_Development_Plan.md` and `Psyntient_Node_Project_v2.md`
(spec v2.4, wins on conflicts) for full product context.
