# Psyntient Node Installer — design

Status: **planned, not built** (2026-08-29). Phase L in the development plan.

## Shape

A single **Go binary** per platform. It serves the branded install wizard on
localhost and opens the user's browser at it. The browser is the entire UI;
there is no native toolkit per OS.

Go rather than Rust: cross-compiling to six targets is one command with no
per-platform toolchain, and the standard library already has an HTTP server and
archive handling. Binaries land around 5-10 MB.

**The installer cannot be written in Node**, because it installs the thing that
provides Node. A clean Windows or macOS machine has no runtime to run it with.

**The wizard is served from localhost, not psyntient.io.** Same-origin, so no
CORS and no tripping Chrome's Private Network Access prompts — which is what a
page on psyntient.io calling `localhost` would hit. See CLAUDE.md's
"The installer must not phone home": psyntient.io serves the binary and detects
the OS, and does nothing else.

## The executor seam

Every step runs through one interface:

```go
type Executor interface {
    Run(ctx context.Context, name string, args ...string) (output string, err error)
    WriteFile(path string, data []byte, perm os.FileMode) error
    Stat(path string) (os.FileInfo, error)
}
```

`LocalExecutor` shells out on this machine. A later `SSHExecutor` runs the
identical phases on a droplet — which is the whole point: **a remote install is
the same steps in a different place**, exactly like SSHing in and installing by
hand. Building this seam now costs almost nothing and turns DigitalOcean support
into one implementation rather than a second installer.

DigitalOcean API integration is explicitly out of scope for the first version.

## Wizard flow

1. **Detect** — OS, architecture, and the browser this page is running in.
   Enumerating *other* installed browsers must happen in the Go binary (scan
   `/Applications`, the Windows registry, `.desktop` files); a web page cannot
   see them. If the current browser cannot install PWAs, offer a button that
   relaunches the wizard in one that can.
   Do not assume Safari is incompatible — macOS Sonoma's "Add to Dock" is a real
   PWA install. Verify before redirecting Safari users away.
2. **Begin Node Install** — one button, no configuration.
3. **Install location** — defaults to `~/Psyntient_Node`. Enforces CLAUDE.md
   section 8's rule: refuse-with-warning if the chosen path sits inside a known
   cloud-sync folder (iCloud Drive, Dropbox, OneDrive, Google Drive, and
   Desktop/Documents on macOS and Windows, which now sync by default). SQLite
   state under a syncing folder corrupts, and cloud "optimize storage" features
   evict files to placeholders that break `require()` outright.
4. **Progress** — phases with elapsed time, never a fake countdown. Duration is
   dominated by network speed, so "Fetching dependencies — 4m12s" stays honest
   where "8 minutes remaining" becomes a lie on a slow link.
5. **Handoff** — redirect the same tab to the app with the token in the URL
   fragment, exactly as `daemon/launch.mjs` already does. The user never sees a
   token, and the branding never changes, so it reads as one continuous flow.

## Phases

Each phase records completion, so a failed install resumes rather than
restarting. A 25-minute install that fails at minute 20 and starts over is worse
than a slow one.

| # | Phase | Notes |
|---|-------|-------|
| 1 | Preflight | Disk space (needs ~6 GB), network, no existing install at target |
| 2 | Node runtime | Official build from nodejs.org, checksum-verified, placed **inside** the install dir |
| 3 | Clone Node repo | `psyntient/Psyntient-Node`, shallow |
| 4 | Clone engine | `psyntient/Open-Claw-Forked` branch `psyntient` into `Cortex/Open-Claw`, shallow; add upstream as `origin`, fork as `psyntient-fork` |
| 5 | Dependencies | corepack/pnpm, then `pnpm install` |
| 6 | Build | `build-all.mjs full`, then `ui.js build` — the long pole, ~20 min |
| 7 | Configure | State dir `~/.psyntient/openclaw-state`, workspace pointer at `Cortex/Cortex_Agent`, port 18789 |
| 8 | Service | LaunchAgent / systemd user unit / Task Scheduler |
| 9 | Launch | Start gateway, wait for health, hand off to the browser |

Node is placed inside the install directory rather than installed system-wide:
no version conflicts with whatever the user already has, and uninstall is
deleting one folder.

### Why not a prebuilt `dist`

`dist/` contains **zero native binaries** — all 43 prebuilt `.node` files live in
`node_modules` and pnpm fetches the right ones per machine. So `dist/` is one
platform-agnostic 171 MB artifact, and shipping it would remove phase 6 entirely:
a few minutes instead of ~25.

Deferred anyway, for beta. It adds a release artifact to build and host per
version, and it changes the updater — end users would need to *download* a new
`dist` rather than build one, which is a second update path to get right before
the first real test. Phase 6 is written as one swappable step so this can land
later without restructuring anything.

Build-on-machine is safe here specifically because **no compiler is required**:
the only two packages with `binding.gyp` (`@lydell/node-pty`, `tree-sitter-bash`)
ship prebuilds for all six targets. Windows users do not need Visual Studio Build
Tools. If that ever stops being true, revisit this decision first.

### Shallow clone

The engine fork's pack is **2.09 GiB**. A full clone would download that before
pnpm fetches anything, and it is almost entirely upstream history nobody needs.

Use `--depth 1 --single-branch`. **This does not give a partial app**: a shallow
clone contains every file at HEAD, complete and working. Only older *commits* are
omitted. `git fetch --unshallow` retrieves them on demand if ever needed.

The updater is unaffected: it fetches, fast-forwards, diffs `HEAD..FETCH_HEAD`,
and rolls back to a sha it recorded from the current HEAD — all of which work on
a shallow checkout.

## A fresh install must be a fresh app

Verified 2026-08-29: `Neural_Vault/`, `Working_Memory/` and `logs/` track only
`.gitkeep` plus a relative-path `vault.config.json`; `Cortex/Cortex_Agent/` tracks
only its template identity files; `USER.md` is an empty form. Development data
lives in `~/.psyntient/` and gitignored vault directories, none of which a clone
carries.

Keep it that way. Anything that would ship a developer's sessions, keys, vault
contents or agent memory to a new user is a bug, not an inconvenience.

## Signing

Deferred for beta, accepted consciously.

- **macOS** — Apple Developer Program, $99/yr, for Developer ID + notarization.
  Without it Gatekeeper blocks; on Sequoia the old Control-click override is gone
  and users must visit System Settings > Privacy & Security > Open Anyway.
  Worst friction of the four platforms; verify actual behavior on the tester's
  macOS version.
- **Windows** — code-signing certificate, ~$200-400/yr OV. Unsigned shows
  SmartScreen's "Windows protected your PC" with a *More info -> Run anyway*
  path. Passable for beta.
- **Linux / ChromeOS** — nothing required.

The download page carries a short per-OS first-run note until this is bought.
Budget the $99 before any public release.

## Platforms

Mac, Windows, Linux, and ChromeOS via Crostini — ChromeOS is the Linux build, not
a fifth target. The genuinely per-platform work is phase 8 (service installation);
everything else differs only in paths.

The existing `daemon/macos/Psyntient Node.app` hardcodes one developer's home
directory and searches Homebrew paths for Node. It is a development convenience,
not a shippable artifact; the installer generates these per platform.
