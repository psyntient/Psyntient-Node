# Restoring the Psyntient OpenClaw fork

`Cortex/Open-Claw/` is **gitignored** by this repo (see `.gitignore`), because
it is an upstream checkout that is meant to be replaceable — 28,733 tracked
files and 72 MB of code that is almost entirely not ours. Vendoring it here
would bury our ~90 files of real work in someone else's monorepo.

But the fork's only git remote is `github.com/openclaw/openclaw` — **upstream,
which we cannot push to.** So without this file, the entire Path C interface
(theme, Projects, onboarding, Archive tools, the gateway shim) existed on
exactly one disk and nowhere else.

`psyntient-fork.bundle` closes that gap. It holds every commit on the
`psyntient` branch that is not in upstream — 32 commits, 89 files,
+4466/-702 — in 836 KB.

## Restore

```bash
git clone https://github.com/openclaw/openclaw.git Cortex/Open-Claw
cd Cortex/Open-Claw
git checkout eb4eaea39b757228b575a671255fe9b4e2c2c891        # the upstream base these commits apply to
git bundle verify ../openclaw-fork/psyntient-fork.bundle
git fetch ../openclaw-fork/psyntient-fork.bundle psyntient:psyntient
git checkout psyntient
pnpm install && node scripts/build-all.mjs gatewayWatch && node scripts/ui.js build
```

Then follow `CLAUDE.md`'s setup: state in `~/.psyntient/openclaw-state`,
workspace pointing at `Cortex/Cortex_Agent`.

## Keeping it current

The bundle is a snapshot, not a live mirror. **Refresh it after any meaningful
fork work:**

```bash
git -C Cortex/Open-Claw bundle create Cortex/openclaw-fork/psyntient-fork.bundle main..psyntient
```

The real fix is a Psyntient-owned fork repo on GitHub with `psyntient` pushed
to it; this is the stopgap until that exists. `gh` is not authenticated on this
machine, so that could not be created here.

- Upstream base: `eb4eaea39b757228b575a671255fe9b4e2c2c891`
- Merge base:    `eb4eaea39b757228b575a671255fe9b4e2c2c891`
- Snapshot taken: 2026-08-28
