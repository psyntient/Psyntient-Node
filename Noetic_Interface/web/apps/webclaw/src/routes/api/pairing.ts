import path from 'node:path'
import { spawn } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const PAIRING_SCRIPT = path.join(NODE_ROOT, 'daemon', 'pairing.mjs')

function runPairingCli(args: Array<string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PAIRING_SCRIPT, ...args], { cwd: NODE_ROOT })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error(stderr.trim() || `daemon exited with code ${code}`))
      }
    })
  })
}

// GET: current pairing status only (no side effects).
// POST: starts a real pairing flow (opens the user's browser to
// psyntient.io/link-node) and does not respond until the user
// approves/denies there, or it times out (daemon/pairing.mjs's
// pairStart() default, 5 minutes) -- the request is expected to just
// stay open that whole time, no separate polling job. The onboarding
// wizard shows a "waiting for you to approve in your browser" state
// for the duration of this call.
export const Route = createFileRoute('/api/pairing')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const status = await runPairingCli(['status'])
          return json({ ok: true, status })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
      POST: async () => {
        try {
          const result = (await runPairingCli(['pair-start'])) as {
            ok: boolean
            denied?: boolean
            node_id?: string
            context_id?: string
          }
          return json(result)
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
