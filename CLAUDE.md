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

### Safe WebClaw update procedure

Updating WebClaw means replacing `Noetic_Interface/web/` and re-applying
`Noetic_Interface/branding/` on top. Never wipe `Working_Memory/`,
`Neural_Vault/`, or `~/.psyntient/` as part of a WebClaw update — those are
unrelated to the Interface's own code and must survive it exactly like
OpenClaw state must survive an OpenClaw update (rule 3 above).

---

See `Psyntient_Node_Development_Plan.md` and `Psyntient_Node_Project_v2.md`
(spec v2.4, wins on conflicts) for full product context.
