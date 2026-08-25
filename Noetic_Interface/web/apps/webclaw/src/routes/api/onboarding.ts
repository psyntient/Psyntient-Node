import path from 'node:path'
import { spawn } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

// Shells out to daemon/onboarding.mjs -- same reasoning as
// routes/api/vault.ts (Vite SSR bundling risk for a relative import
// reaching outside this app's own src/).
const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const ONBOARDING_SCRIPT = path.join(NODE_ROOT, 'daemon', 'onboarding.mjs')

function runOnboardingCli(args: Array<string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ONBOARDING_SCRIPT, ...args], { cwd: NODE_ROOT })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `daemon exited with code ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error('Onboarding command returned unexpected output'))
      }
    })
  })
}

// GET: {hasProvider, isPaired, completed} -- the wizard uses this on
// mount to decide whether to show at all, and which step to resume at.
// POST {action: "complete"}: marks the one-time "seen the wizard"
// marker (see daemon/onboarding.mjs -- not a gate, just stops the
// welcome/vault pages from showing again once the user's been through
// them).
export const Route = createFileRoute('/api/onboarding')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const status = await runOnboardingCli(['status'])
          return json({ ok: true, status })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
          if (body.action !== 'complete') {
            return json({ ok: false, error: 'Unknown action' }, { status: 400 })
          }
          const result = await runOnboardingCli(['complete'])
          return json({ ok: true, result })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
