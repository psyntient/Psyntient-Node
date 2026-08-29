# Restoring the Psyntient OpenClaw fork

`Cortex/Open-Claw/` is **gitignored** by this repo (see `.gitignore`), because
it is an upstream checkout that is meant to be replaceable — 28,733 tracked
files and 72 MB of code that is almost entirely not ours. Vendoring it here
would bury our ~90 files of real work in someone else's monorepo.

**As of 2026-08-29 the fork has a real home:
`github.com/psyntient/Open-Claw-Forked`, branch `psyntient`** (remote name
`psyntient-fork`; `origin` still points at upstream and must stay that way). It
is a GitHub fork of `openclaw/openclaw`, so it shares storage with the parent —
pushing our branch moved only our own commits and took eight seconds rather
than the 2.1 GB a standalone repo would have needed. It is public, so a Node
pulls updates with no credentials; the token is needed only to push.

That is now the primary path. `daemon/updater.mjs` fetches from it, which is
what makes engine updates proportional to the change: the bundle below is one
binary blob, so ANY fork change re-sent all ~880 KB of it because bundles do
not delta.

`psyntient-fork.bundle` remains as an offline fallback. It holds every commit
on the `psyntient` branch that is not in upstream, in a single file, for the
case where GitHub is unreachable.

## Restore (preferred: from the fork remote)

```bash
git clone --branch psyntient https://github.com/psyntient/Open-Claw-Forked.git Cortex/Open-Claw
cd Cortex/Open-Claw
git remote rename origin psyntient-fork
git remote add origin https://github.com/openclaw/openclaw.git   # upstream, for later OpenClaw updates
pnpm install && node scripts/build-all.mjs gatewayWatch && node scripts/ui.js build
```

## Restore from the bundle (offline fallback)

Use this only when GitHub is unreachable. The bundle is a snapshot and may lag
the remote.

```bash
git clone https://github.com/openclaw/openclaw.git Cortex/Open-Claw
cd Cortex/Open-Claw
git checkout eb4eaea39b757228b575a671255fe9b4e2c2c891        # the upstream base these commits apply to
git bundle verify ../openclaw-fork/psyntient-fork.bundle
# no destination refspec: git refuses to fetch into a checked-out branch
git fetch ../openclaw-fork/psyntient-fork.bundle psyntient
git checkout -b psyntient FETCH_HEAD
pnpm install && node scripts/build-all.mjs gatewayWatch && node scripts/ui.js build
```

Then follow `CLAUDE.md`'s setup: state in `~/.psyntient/openclaw-state`,
workspace pointing at `Cortex/Cortex_Agent`.

## Keeping it current

Push fork work to the remote — that is what Nodes actually update from:

```bash
git -C Cortex/Open-Claw push psyntient-fork psyntient
```

The bundle is now an **offline recovery artifact only**, no longer refreshed on
every commit. Refreshing it per commit was costing ~880 KB of repo history each
time (5.9 MB of a 16 MB repo across 7 revisions) to distribute changes that were
often a couple of lines. Refresh it at meaningful milestones:

```bash
git -C Cortex/Open-Claw bundle create Cortex/openclaw-fork/psyntient-fork.bundle main..psyntient
```

- Upstream base: `eb4eaea39b757228b575a671255fe9b4e2c2c891`
- Merge base:    `eb4eaea39b757228b575a671255fe9b4e2c2c891`
- Snapshot taken: 2026-08-28
