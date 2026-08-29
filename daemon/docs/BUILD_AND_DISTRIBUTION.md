# Should we build on the user's machine?

**Status:** research. Three layers measured locally and checked against outside
practice, then synthesised. No changes made.
**Prompted by:** a real install taking ~30 minutes and thrashing an 8 GB Mac,
and a typecheck that reached 8.95 GB resident on the same machine.

Every number below is measured on this machine against the actual test install
at `~/Public/Psyntient_Node`, not estimated.

---

## Layer 1 — What do we need, versus what do we install?

### Measured

`node_modules` after a real install: **2113 MB**, 855 top-level packages, 1174
packages in total.

Split against what the engine's `package.json` actually declares:

| | size | share |
|---|---:|---:|
| declared `devDependencies` (38) | 50 MB | 2% |
| declared `dependencies` (63) | 129 MB | 6% |
| **transitive — nobody declared it** | **1933 MB** | **91%** |

The top of that transitive list:

| package | size | what it is |
|---|---:|---|
| `@github` | 336 MB | Copilot provider SDK |
| `@openai` | 332 MB | OpenAI provider SDK |
| `@anthropic-ai` | 253 MB | Anthropic provider SDK |
| `@tloncorp` | 64 MB | chat integration |
| `@microsoft` | 50 MB | Teams integration |
| `node-llama-cpp` + `@node-llama-cpp` | 77 MB | local inference bindings |

Those six are **1.08 GB — over half of everything.**

### Against outside practice

The usual advice assumes the weight is developer tooling. Guidance around
reducing `node_modules` consistently reports devDependencies at
[60–70% of total size](https://www.pkgpulse.com/guides/how-to-reduce-node-modules-size),
and most projects able to cut 30–60% by separating prod installs and
deduplicating.

**We are the opposite case.** Our devDependencies are 2%. Our bloat is provider
SDKs and integrations pulled in as *production* transitive dependencies of the
engine, because OpenClaw supports every provider and ships a client for each.
A user who only ever talks to OpenRouter still gets Copilot, Anthropic, Teams,
Matrix and local-inference bindings.

That is upstream's architecture, not something we introduced, and not something
we can prune away without diverging from the fork.

---

## Layer 2 — Can we prune dev dependencies?

### Measured

Ran it, on the real install:

```
pnpm prune --prod
before: 2113 MB
after:  1975 MB
saved:   137 MB (6%) in 6s
```

Two secondary findings from doing it rather than reading about it:

- **pnpm's prune is a purge-and-reinstall, not a surgical delete.** It refuses
  without a TTY (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) because it wants
  to remove the modules directory. It took 6s here only because the store was
  warm; on a fresh machine that step needs the network again.
- It leaves the install unable to rebuild. Our updater rebuilds in place, so a
  pruned Node would have to reinstall dev dependencies before any update that
  touches buildable code — trading a one-off 137 MB for a recurring cost.

### Against outside practice

The expected saving is 30–60%. We measured 6%. The gap is entirely explained by
Layer 1: the standard advice targets the tooling, and our tooling is 2% of the
problem.

### Verdict

**No.** 137 MB against 2113 MB is not worth a recurring update cost, and it does
nothing at all for the build's *memory* use — the build needs exactly the
dependencies pruning would remove.

---

## Layer 3 — Should we build on the user's machine at all?

### Measured — what building actually costs here

| | |
|---|---|
| full install, wall clock | ~30 min, of which `tsdown-unified` alone was 7m 50s |
| peak memory, `tsgo` typecheck | **8.95 GB resident on an 8 GB machine** |
| load average during build | 31–63 on 4 cores |
| swap in use | 3.18 GB of 5 GB |
| build failures observed | 2 of 3 attempts (JS budget, then a resume bug) |

The machine spent much of that paging rather than compiling. This is not a slow
machine by users' standards — it is a MacBook Pro, and a researcher on an 8 GB
Air is a completely reasonable target.

### Measured — is a prebuilt ship even possible?

This is the question that decides it, and the answer contradicts our own notes.
`CLAUDE.md` states *"dist/ is not self-contained"*. Tested directly:

- `dist/index.js` contains **0 bare external imports** — tsdown/rolldown bundles
  everything it can reach.
- With `node_modules` **moved away entirely**, `openclaw.mjs --version` runs.
- With `node_modules` **moved away entirely**, `gateway run` starts and serves
  **HTTP 200**.
- But it is not perfectly clean: one path threw
  `ERR_MODULE_NOT_FOUND: Cannot find package 'json5'`.

So `dist/` is **nearly** self-contained, with a small tail of runtime imports
that escaped the bundle. That tail needs enumerating, but it is a tail — not the
2 GB tree we currently install to get it.

Sizes for a hypothetical prebuilt ship:

| | |
|---|---:|
| `dist/` | 217 MB |
| Node runtime | 245 MB |
| `.git` (shallow) | 95 MB |
| `node_modules` we could stop shipping | 1.9 GB |

There is also a hard floor: **40 native `.node` binaries** exist in
`node_modules` (lightningcss, fsevents, rolldown, matrix-crypto, node-pty and
others). Native code cannot be bundled, so any prebuilt ship is
platform-specific and must carry the ones actually reached at runtime.

### Against outside practice

The consensus is not ambiguous. Guidance on distributing Node desktop
applications is that
[prepackaged distributions are the preferred installation method](https://nodejsdesignpatterns.com/blog/5-ways-to-install-node-js/),
that shipping prebuilt binaries means
[no extra download step, more reliable and faster to install](https://github.com/piranna/prebuild/blob/master/README.md),
and that building from source is for people optimising compiler settings,
cross-compiling, or working on the runtime itself — not for end users.

More telling is what comparable products do. Every local-first AI application in
this space ships prebuilt:

| | how it installs |
|---|---|
| [LM Studio](https://www.sitepoint.com/lm-studio-vs-ollama/) | downloadable desktop app |
| [Jan](https://localaimaster.com/blog/jan-vs-lm-studio-vs-ollama) | downloadable desktop app, macOS/Windows/Linux |
| GPT4All | desktop app, explicitly "without touching a terminal" |
| Ollama | single binary |
| [Open WebUI](https://www.iunera.com/kraken/enterprise-ai/top-20-tools-to-run-llms-locally-in-2026-ollama-anythingllm-open-webui-lm-studio-vllm-and-every-real-alternative-compared/) | one `docker run` of a published image |

**None of them compile on the user's machine.** We are the outlier, and we
inherited it accidentally: we build because the installer clones a repo and the
updater rebuilds in place, not because anyone decided users should compile.

---

## Synthesis

### What the three layers say together

Layer 1 and Layer 2 together close off the obvious optimisation. The weight is
not tooling, so pruning tooling recovers 6%. Anything that meaningfully shrinks
`node_modules` means removing provider SDKs from a fork we deliberately keep
close to upstream — expensive, permanent, and a merge conflict every update.

Layer 3 makes that moot. If `dist/` runs without `node_modules`, then the 2 GB
tree is **build input, not product**. We are not shipping it because the user
needs it; we are shipping it because we build in the same place we install.

That reframes everything. The question is not "how do we make the build cheaper"
but "why is the build happening on a research laptop at all". Every cost we have
hit today — 30 minutes, 9 GB, two failed builds, a thrashing machine — is a cost
of that one decision, and none of it is a cost of *running* the product.

### The honest counter-arguments

**The updater rebuilds in place.** `CLAUDE.md` §11 is careful about this: the
updater classifies a diff and does the least work that applies it, and rollback
is a `dist.prev` file swap precisely because rebuilding to undo a bad update
would cost 20 minutes when the app is already broken. Prebuilt distribution
changes that model — updates become artifact downloads, which is *simpler*, but
it is a real redesign of something already working.

**Native modules make it platform-specific.** 40 `.node` binaries means a
prebuilt ship is per-platform per-arch. That is normal for desktop software and
is exactly what every comparable product does, but it is build infrastructure we
do not have today.

**We have no release pipeline.** The DigitalOcean bootstrap already ran into
this: it clones and builds rather than fetching an artifact, precisely because no
published artifact exists.

**`dist/` is not perfectly self-contained.** The `json5` failure proves the tail
is real. It needs enumerating before anyone promises a `node_modules`-free ship.

### What I would do

**Not** prune dev dependencies. Measured, 6%, with a recurring cost.

**Not** attack the provider SDKs. That is upstream's design and fighting it
means permanent divergence.

**Do** treat "ship a prebuilt `dist/`" as the real answer, and take it in
verifiable steps rather than as a rewrite:

1. **Enumerate the tail.** Exercise the gateway with `node_modules` absent and
   collect every `ERR_MODULE_NOT_FOUND`. That number decides whether this is a
   handful of packages or a hidden dependency on the whole tree. Cheap, and
   nothing else can be planned honestly without it.
2. **Establish what a shipped artifact contains** — `dist/`, the tail, the
   native binaries actually reached, per platform. Measure it.
3. **Only then** decide between publishing artifacts to GitHub Releases and
   keeping the build for developers, versus keeping both paths.

Step 1 is an afternoon and it is the one that turns this from an argument into
an engineering decision. I would not commit to a distribution model before it.

### One thing to fix regardless

`CLAUDE.md` says `dist/` is not self-contained. Measured, it very nearly is —
enough to start a gateway that answers HTTP 200 with `node_modules` deleted.
That sentence is load-bearing: it is the stated reason the installer ships the
whole tree, and it is close enough to wrong to have foreclosed this option
without anyone re-testing it.
