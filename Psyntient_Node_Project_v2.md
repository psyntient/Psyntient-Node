# Psyntient Node — Definitive Project Specification (v2)

> **Version:** 2.0 — supersedes v1.
> **Audience:** The agent building the Psyntient Node daemon, Noetic Interface, Noetic API, and Vault storage layer.
> **Last aligned with:** psyntient.io architecture v3.0 (Neural Vault, Node, Noetic Archive, Applications).

---

## 1. What Psyntient Node Is

Psyntient Node is a **local, user-controlled runtime** of the Psyntient OS ecosystem. It runs on the user's machine (or a server they control) and exposes a **web-based Noetic Interface** that feels like a native desktop app.

The Node is not a cloud service. It owns the user's local data, runs the Cortex agent, exposes the Noetic API, and decides what (if anything) is shared with the Noetic Archive on psyntient.io.

Core responsibilities:

- **Own the Neural Vault** — local, encrypted, sovereign storage.
- **Run the Cortex** — the local agent (OpenClaw + Cortex Agent workspace) that powers chat.
- **Serve the Noetic Interface** — a rebranded WebClaw web app client, styled to Psyntient branding.
- **Expose the Noetic API** — programmatic search / read / write against the user's Vault and the Noetic Archive.
- **Authenticate with psyntient.io** — one long-lived Node Access Token per Context.

---

## 2. Directory Architecture

The Node installs into a single root directory (default: `~/Psyntient_Node/`; on desktop installs, launched via a shortcut in the OS Applications folder). Runtime secrets stay in `~/.psyntient/`.

```
Psyntient_Node/                      # Node root (relocatable)
├── Neural_Vault/                    # DEFAULT Neural Vault location (relocatable — see §5)
│   ├── .vault.json                  # Vault manifest: UUID, provider, sync_state
│   └── Devices/<device_name>/<project>/...
│
├── Cortex/                          # Local inference layer
│   ├── Cortex_Agent/                # Our agent workspace, prompts, tools, memory scaffolding
│   │   ├── prompts/
│   │   ├── tools/
│   │   └── config.json
│   └── Open-Claw/                   # Current OpenClaw install (upstream binary + assets)
│
├── Noetic_Interface/                # Web UI (rebranded WebClaw web-app client)
│   ├── web/                         # Built React assets served by the daemon
│   ├── branding/                    # Psyntient theme overrides (colors, fonts, avatar)
│   └── config.json
│
├── Noetic_API/                      # Programmatic vault-traversal + Archive I/O
│   ├── vault/                       # Search / read / write against Neural_Vault
│   ├── archive/                     # Search / download / upload against Noetic Archive
│   ├── server/                      # HTTP surface exposed to the Interface and 3rd parties
│   └── sdk/                         # Typed client libraries (TS, Python)
│
├── Working_Memory/                  # Persists across upgrades of Cortex / OpenClaw / Interface
│   ├── cortex_projects/             # Cortex Agent active-project working memory
│   │   └── <project_id>/            # notes.md, memory.sqlite, scratch/, logs/
│   └── chat_context/                # Interface chat threads & context memory
│       └── <thread_id>/             # messages.jsonl, context.md, attachments/
│
└── logs/

~/.psyntient/                        # User-scoped config & secrets (never inside the install root)
├── node.key                         # Long-lived Node Access Token (Bearer auth to psyntient.io)
├── node.json                        # node_id, context_id, install_root, vault_path, device_name
├── providers.json                   # User's LLM API keys (OpenRouter/OpenAI/Anthropic)
└── config.json                      # Runtime settings, theme, feature flags
```

### Why Working_Memory is separate from Cortex and Noetic_Interface

Upgrading OpenClaw or the WebClaw-based Interface **must not** wipe the user's active projects or chat history. All mutable, user-generated runtime state lives in `Working_Memory/` and is written to by Cortex and the Interface via stable paths. The `Cortex/` and `Noetic_Interface/` directories can be blown away and re-installed at any time.

### Why Neural_Vault is at the root

The Vault is the user's data. It sits at the top level so it is:

- Obvious where their data lives.
- Easy to relocate (see §5) without disturbing runtime code.
- Never nested inside a directory a package manager might overwrite.

---

## 3. Installer & Distribution

Most users install via the **Psyntient Node Installer**, a small native installer downloaded from psyntient.io. Developers can bypass the installer and use the **SDK path** (see §3.3).

### 3.1 Installer flow (default path — non-developers)

1. User downloads the installer from `psyntient.io/nodes/download` (macOS `.pkg`, Windows `.msi`, Linux `.deb`/`.rpm`).
2. Wizard runs on the user's machine. It asks:
   - **Install target:**
     - **Local** — this machine.
     - **Remote server** — user provides SSH details; installer runs remote install over SSH.
     - **DigitalOcean droplet** — user pastes a DO API token; installer creates a fresh droplet and installs into it.
   - **Install root** (default `~/Psyntient_Node/`).
3. Installer downloads the required components from the **public Psyntient Node Git repository**:
   - Node daemon binary
   - `Cortex/Open-Claw/` (pinned OpenClaw release)
   - `Cortex/Cortex_Agent/` scaffolding
   - `Noetic_Interface/` (rebranded WebClaw client, built assets)
   - `Noetic_API/` server + SDK
4. Installer creates the directory tree in §2, initializes an empty `Neural_Vault/` with a fresh `.vault.json`, and creates empty `Working_Memory/cortex_projects/` and `Working_Memory/chat_context/`.
5. Installer drops a **launcher / GUI shortcut** in the OS Applications folder:
   - macOS: `/Applications/Psyntient Node.app` — opens the local Interface URL.
   - Windows: Start Menu + Desktop shortcut.
   - Linux desktop: `.desktop` entry.
   - Server installs: a small local GUI shortcut on the *user's* machine that points at the remote Node's Interface URL (over HTTPS + Node token).
6. Installer launches the daemon. Daemon opens the browser at `https://psyntient.io/link-node?...` for pairing (see §4).

### 3.2 Rebranded WebClaw

The Noetic Interface is not built from scratch. We fork/rebrand the **WebClaw web-app client** and swap in Psyntient branding (see §6). Upgrading WebClaw upstream should be a matter of replacing `Noetic_Interface/web/` and re-applying `branding/` — never touching `Working_Memory/`.

### 3.3 Developer SDK path

Developers can skip the installer and install components à la carte from the Git repo. A `psyntient` CLI wizard walks them through it:

```
$ psyntient init
> Log in to your Psyntient account (opens browser)…
> Pair this node with a Context: [pick one]
> Which components do you want to install?
    [x] Noetic_API          (Vault traversal + Archive I/O SDK)
    [x] Neural_Vault        (initialize an empty Vault at ./Neural_Vault/)
    [ ] Cortex              (Cortex_Agent + OpenClaw)
    [ ] Noetic_Interface    (WebClaw-based UI)
> Install root: ./Psyntient_Node
```

The wizard performs the **same pairing flow as the installer** — the developer authenticates via `psyntient.io/link-node` in their browser and the CLI captures the returned Node Access Token into `~/.psyntient/node.key`. From that point on, any component they installed can hit psyntient.io and their Vault.

Selecting **Cortex** always installs both `Cortex_Agent/` and `Open-Claw/` — you cannot have one without the other.

---

## 4. Authentication with psyntient.io

The Node authenticates using a **long-lived Node Access Token** stored in `~/.psyntient/node.key`, scoped to a single psyntient.io account Context and a single Node identity.

### Pairing / onboarding flow

1. Daemon starts without a `node.key`.
2. Daemon opens the user's default browser at:
   ```
   https://psyntient.io/link-node?callback=<local-callback>&device_name=...&session_nonce=...&os_info=...&node_version=...
   ```
   - `callback` must be `https://...` or loopback `http://` (`localhost`, `127.0.0.1`, `::1`, `*.localhost`).
   - `session_nonce` is an opaque string generated by the Node to prevent replay.
3. The user signs in to psyntient.io.
4. psyntient.io shows the user their Contexts. They pick one (or create one) and click **"Link this Node"**.
5. Browser is redirected to:
   ```
   <callback>?node_token=<token>&node_id=<id>&context_id=<id>&session_nonce=<nonce>
   ```
   If denied: `<callback>?denied=1`.
6. Node's local loopback server validates `session_nonce`, writes `node.key`, and closes the pairing browser tab.

### Runtime auth

```http
POST https://psyntient.io/api/public/nodes/heartbeat
Authorization: Bearer <node_token>
Content-Type: application/json

{ "node_id": "...", "version": "...", "os_info": "..." }
```

Success:
```json
{ "ok": true, "context_id": "...", "vault": { "id": "...", "provider": "local", "provider_folder_id": "...", "provider_display_name": "..." } }
```

Revoked:
```json
{ "ok": false, "error": "token_revoked" }
```
On revocation, the Node deletes `node.key` and re-triggers pairing.

### Identity rules

- psyntient.io stores only Node identity, Context ID, Vault UUID/metadata — **never** files, credentials, or LLM API keys.
- `node.key` never leaves the machine, is never bundled with the installer, is never committed to source control.
- Deleting `node.key` forces re-pairing; the old token can be revoked from `/nodes` on psyntient.io.

---

## 5. Neural Vault

The Neural Vault is the user's **sovereign, encrypted repository** for every recording, observation packet, analysis, and project artifact.

### Principles

- **User-owned.** psyntient.io never hosts Vault files.
- **Encrypted** at rest and in transit; cloud providers see encrypted blobs only.
- **Consent-based sharing** into the Noetic Archive — explicit, granular, revocable.
- **Deterministic structure** so apps/devices know where to read and write.

### Default location

```
<install-root>/Neural_Vault/
```

On a default desktop install: `~/Psyntient_Node/Neural_Vault/`.

`node.json` stores `vault_path` and `.vault.json` stores the Vault UUID + provider metadata.

### Structure

```
Neural_Vault/
├── .vault.json                    # UUID, provider, provider_folder_id, sync_state, encryption_key_id
├── Devices/
│   └── <device_name>/
│       ├── .device.json
│       └── <project>/
│           ├── .project.json
│           ├── sessions/
│           ├── notes/
│           ├── analyses/
│           └── exports/
└── shared/
```

### Relocating the Vault

From the Noetic Interface settings menu the user can change the Vault location to:

1. Another local path.
2. A cloud drive (Google Drive first; iCloud / Dropbox / OneDrive / S3 later).

The Node runs the cloud-provider OAuth flow **locally** — psyntient.io never touches those tokens. On relocation the Node:

1. Validates the target is accessible.
2. Migrates files (or adopts an existing `.vault.json` if present).
3. Updates `vault_path` in `node.json` and provider fields in `.vault.json`.
4. Sends a heartbeat with the new Vault UUID + provider metadata.

### Vault vs. Working_Memory

- **Neural_Vault/** — long-term source of truth, encrypted, user-owned.
- **Working_Memory/cortex_projects/** — active project scratch used by the Cortex Agent (markdown, SQLite, logs).
- **Working_Memory/chat_context/** — Interface chat threads and context memory.

Lifecycle for a project:
1. Create in `Neural_Vault/…/<project>/`.
2. Scaffold into `Working_Memory/cortex_projects/<project_id>/`.
3. Reignite / chat / edit — Cortex reads/writes Working_Memory.
4. Sync back to Vault on user command or project completion.
5. Erase from Working_Memory (Vault copy remains).

---

## 6. Noetic Interface — Branding

The Interface is a rebranded WebClaw web-app client. Branding overrides live in `Noetic_Interface/branding/`.

- **Palette:** ink background (`#0a0a0f`, `#0F172A`), cream foreground (`#f8f7f2`), gold accents (`#f5d9a8`, `#f5c76a`, `#f5b89e`) at value moments and money numerals.
- **Type:** clean sans (Inter / Outfit / SF Pro Display) for UI; JetBrains Mono for paths/data.
- **Avatar:** magical-elf-like character facing forward — wise, calm, otherworldly. Not cartoonish.
- **Motion:** subtle entrances, ambient background motion, gold glints at insight moments.
- **Do not** ship WebClaw's default purple/indigo-on-white look.

### Layout

- Left rail (collapsible): chat threads bound to `Working_Memory/chat_context/<thread_id>/` and, when relevant, to a project in `Working_Memory/cortex_projects/`.
- Main: chat-first, avatar top, messages, large input.
- Top bar: Vault sync indicator, Vault provider badge, settings, Psyntient OS mark.
- Settings menu: LLM API keys, Vault location switcher, theme, telemetry toggles.

---

## 7. Ecosystem Relationship

```
Applications (Psyntient Ground, BCIs, wearables, research agents)
                    ↓
    Psyntient Node ─── Noetic Interface (WebClaw, rebranded)
                    │
                    ├── Cortex (Cortex_Agent + Open-Claw)
                    │        ↕ reads/writes
                    │   Working_Memory/
                    │
                    ├── Noetic_API (Vault + Archive traversal)
                    │
                    └── Neural_Vault (local or cloud, encrypted, user-owned)
                                    ↓
              [with explicit consent] → Noetic Archive on psyntient.io
```

---

## 8. Non-Goals & Constraints

- psyntient.io does **not** store user files, credentials, or LLM API keys.
- The Node does **not** require a cloud Vault to function.
- The Node does **not** upload to the Archive without explicit consent.
- The Node does **not** bundle LLM API keys; users bring their own (or use a disclosed concierge trial).
- Upgrading Cortex / Open-Claw / Noetic_Interface **must not** touch `Working_Memory/` or `Neural_Vault/`.

---

## 9. Terminology

| Term | Meaning | Never call it |
|---|---|---|
| Psyntient Node | Local runtime (daemon + Interface + Cortex + API + Vault) | "client", "agent" |
| Noetic Interface | Rebranded WebClaw web-app UI served by the Node | "chatbot", "Node UI" |
| Cortex | Local inference layer = Cortex_Agent + Open-Claw | "AI model", "backend" |
| Neural Vault | User-owned encrypted data repository | "cloud storage", "database" |
| Noetic API | Programmatic vault + Archive traversal SDK | "REST layer" |
| Noetic Archive | Collective, consent-based archive on psyntient.io | "the cloud" |
| Context | psyntient.io account context; one Vault per Context | "account", "workspace" |
| Psyntient OS | Domain-specific operating system for inner-space research | "hardware", "device OS" |

---

*End of document. Supersedes Psyntient_Node_Project.md v1. Any earlier conflicting guidance is resolved in favor of this file.*
