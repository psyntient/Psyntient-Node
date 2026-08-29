#!/usr/bin/env node
// Assembles the prebuilt engine artifact a Node installs instead of building.
//
// WHY THE PACKAGE LIST IS DERIVED AND NOT WRITTEN DOWN
// It cannot be determined statically. A module-resolution hook registered via
// module.register() observes `import` and nothing else, so every CommonJS
// `require()` is invisible to it -- a hand-built artifact passed tracing and
// then died on `fast-deep-equal`, required by `ajv` from inside a CJS file.
// Scanning the bundle for `import()` sites has the identical blind spot.
//
// So the artifact is defined by what actually boots: start with nothing, add
// only what the gateway fails on, repeat until it serves. That is slower than
// reading a list and it is the only method that converges. A checked-in list
// would also rot silently on the next engine update, in exactly the way that
// produces an artifact which installs cleanly and breaks on first use.
//
// Usage: node scripts/build-engine-artifact.mjs <engine-dir> <out-dir>
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const engineDir = path.resolve(process.argv[2] ?? ".");
const outDir = path.resolve(process.argv[3] ?? "artifact");
const PORT = 18999;
const MAX_ROUNDS = 200;

const log = (m) => console.log(`[artifact] ${m}`);
const fullModules = path.join(engineDir, "node_modules.full");
const modules = path.join(engineDir, "node_modules");

function copyPackage(name) {
  const from = path.join(fullModules, name);
  const to = path.join(modules, name);
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // Symlinks are workspace packages; copying the link keeps its relative
  // target, which resolves back into the repo where the package really lives.
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(from), to);
  } else {
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  }
  return true;
}

/** Package name from a specifier or an absolute path inside node_modules. */
function packageOf(spec) {
  let s = spec;
  if (s.includes("/node_modules/")) s = s.split("/node_modules/").pop();
  const parts = s.split("/");
  return s.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

async function bootOnce(stateDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["openclaw.mjs", "gateway", "run"], {
      cwd: engineDir,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_CONFIG_PATH: path.join(stateDir, "openclaw.json"),
        PSYNTIENT_HOME: path.join(stateDir, "home"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    const done = (result) => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve(result);
    };

    // Poll rather than wait for a ready line: the gateway prints several
    // things that look like readiness and only one that is.
    let waited = 0;
    const tick = setInterval(async () => {
      waited += 1000;
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          clearInterval(tick);
          done({ healthy: true, out });
          return;
        }
      } catch {
        // not up yet
      }
      const miss = out.match(/Cannot find (?:module|package) '([^']+)'/);
      if (miss || waited > 90_000) {
        clearInterval(tick);
        done({ healthy: false, missing: miss?.[1], out });
      }
    }, 1000);
  });
}

async function main() {
  if (!fs.existsSync(path.join(engineDir, "openclaw.mjs"))) {
    throw new Error(`not an engine checkout: ${engineDir}`);
  }
  if (!fs.existsSync(path.join(engineDir, "dist"))) {
    throw new Error("dist/ missing — build the engine before assembling an artifact");
  }

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-state-"));
  fs.mkdirSync(path.join(stateDir, "home"), { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "openclaw.json"),
    JSON.stringify(
      {
        gateway: {
          auth: { mode: "token", token: "artifact-derivation-only" },
          port: PORT,
          mode: "local",
          bind: "loopback",
        },
      },
      null,
      2,
    ),
  );

  log("parking the full dependency tree");
  fs.renameSync(modules, fullModules);
  fs.mkdirSync(modules, { recursive: true });

  // The @openclaw scope is first-party: workspace links plus packages the
  // engine publishes itself. Derivation finds these eventually, but seeding
  // them saves a boot cycle each and they are always needed.
  for (const name of fs.readdirSync(path.join(fullModules, "@openclaw"))) {
    copyPackage(`@openclaw/${name}`);
  }

  let added = 0;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const result = await bootOnce(stateDir);
    if (result.healthy) {
      log(`healthy after ${round} boot(s), ${added} packages`);
      break;
    }
    if (!result.missing) {
      console.error(result.out.slice(-3000));
      throw new Error(`round ${round}: unhealthy with no missing-module error`);
    }
    const pkg = packageOf(result.missing);
    if (!copyPackage(pkg)) {
      throw new Error(`round ${round}: cannot satisfy ${result.missing} (package ${pkg})`);
    }
    added += 1;
    log(`+ ${pkg}`);
    if (round === MAX_ROUNDS) throw new Error("did not converge");
  }

  log("assembling");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(path.join(engineDir, "dist"), path.join(outDir, "dist"), { recursive: true });
  fs.cpSync(modules, path.join(outDir, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });

  // Workspace packages carry their OWN build output, separate from the
  // top-level dist/. Omitting it produced an artifact that installed cleanly
  // and then failed on @openclaw/ai/dist/internal/runtime.mjs.
  //
  // package.json ships with it, and that is not optional: imports of these
  // packages use subpaths (`@openclaw/ai/internal/runtime`) that only resolve
  // through the exports map, which lives in package.json. Shipping dist alone
  // fails with "Cannot find module .../@openclaw/ai/internal/runtime" -- and
  // it fails ONLY in a clean extraction, because any tree that still has the
  // engine source resolves it from there and hides the omission.
  const packagesDir = path.join(engineDir, "packages");
  if (fs.existsSync(packagesDir)) {
    for (const name of fs.readdirSync(packagesDir)) {
      const from = path.join(packagesDir, name, "dist");
      if (!fs.existsSync(from)) continue;
      const to = path.join(outDir, "packages", name);
      fs.mkdirSync(to, { recursive: true });
      fs.cpSync(from, path.join(to, "dist"), { recursive: true });
      const manifest = path.join(packagesDir, name, "package.json");
      if (fs.existsSync(manifest)) fs.cpSync(manifest, path.join(to, "package.json"));
    }
  }

  fs.rmSync(modules, { recursive: true, force: true });
  fs.renameSync(fullModules, modules);

  const count = fs
    .readdirSync(path.join(outDir, "node_modules"))
    .flatMap((e) =>
      e.startsWith("@") ? fs.readdirSync(path.join(outDir, "node_modules", e)) : [e],
    ).length;
  log(`done: ${count} packages in ${outDir}`);
}

main().catch((err) => {
  // Always put the tree back; a half-moved node_modules is worse than a
  // failed build.
  if (fs.existsSync(fullModules)) {
    fs.rmSync(modules, { recursive: true, force: true });
    fs.renameSync(fullModules, modules);
  }
  console.error(`[artifact] ${err.message}`);
  process.exit(1);
});
