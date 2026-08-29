# Psyntient Node — Development Plan

> **Product spec:** `Psyntient_Node_Project_v2.md` (v2.4+)
> **Install root:** `/Users/woodleybrown/Desktop/Psyntient_Node`

---

## 0. Already complete

- OpenClaw at `Cortex/Open-Claw/` (bundled). Do not reinstall unless broken.

---

## 1. Locked decisions

| Topic | Decision |
|-------|----------|
| UI | WebClaw → `Noetic_Interface/web/` via git clone |
| PWA | Shell only |
| Supervisor | Cross-platform adapters; launchd first on macOS |
| GUI | Click activates Node → opens Interface |
| Agent files at root | None |
| LLM keys | **BYO**; collect on **first Interface launch**; store `~/.psyntient/providers.json`; daemon applies to OpenClaw |
| Privacy | No Psyntient LLM proxy; prompts go to user's provider |
| Bootstrap Psyntient key | Not required for architecture |

---

## 2. Phases

### A — Skeleton
Canonical tree; no root agent files; Working_Memory + Vault placeholders; daemon folder.

### B — Daemon + GUI activation
Health-check/start bundled Gateway; macOS launchd adapter; launcher opens Interface URL.

### C — BYO key pipeline
- Interface first-run gate if no LLM key
- Save to `~/.psyntient/providers.json`
- Programmatic apply into OpenClaw env/config for supervised Gateway
- Restart Gateway; verify chat path
- Settings screen to update/rotate key

### D — Cortex_Agent
Under `Cortex/Cortex_Agent/` only; Working_Memory for scratch; read providers via daemon/runtime.

### E — Noetic Interface (WebClaw)
Clone webclaw; wire Gateway; streaming chat; no app-user login.

### F — PWA shell

### G — psyntient.io pairing (`node.key`)

### H — Vault activation

### I — Working_Memory thread/project mapping

### J — Noetic API stubs

### K — Branding / trim

### L — Full installer (multi-OS service + GUI)

---

## 3. Near-term order

A → B → C → E → D → F → G–I → J–L

(Key pipeline early so chat works without manual OpenClaw terminal config.)

---

## 4. MVP

1. GUI/launcher brings up bundled Gateway
2. First launch prompts for BYO API key if missing
3. Daemon applies key to OpenClaw; chat streams
4. Working_Memory survives UI reinstall
5. No global OpenClaw dependency
6. No prompts sent through psyntient.io

---

## 5. Non-tasks early

- Don't reinstall OpenClaw if valid
- Don't require API key in installer
- Don't ship a production Psyntient OpenRouter key as the main design
- Don't put agent files at Node root
- Don't store keys in markdown or git

---

*Spec v2.4 wins on product conflicts.*

<!-- update-test marker: safe to remove -->
