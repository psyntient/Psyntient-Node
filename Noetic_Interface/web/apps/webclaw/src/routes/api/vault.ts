import path from 'node:path'
import { spawn } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

// This file lives at Noetic_Interface/web/apps/webclaw/src/routes/api/ -
// seven levels up is the Psyntient_Node root. Shells out to
// daemon/vault.mjs's CLI entry rather than importing it directly, same
// reasoning as routes/api/provider-key.ts (Vite SSR bundling risk for a
// relative import reaching outside this app's own src/).
const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const VAULT_SCRIPT = path.join(NODE_ROOT, 'daemon', 'vault.mjs')

function runVaultCli(args: Array<string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [VAULT_SCRIPT, ...args], { cwd: NODE_ROOT })
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
        reject(new Error('Vault command returned unexpected output'))
      }
    })
  })
}

export const Route = createFileRoute('/api/vault')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const status = await runVaultCli(['status'])
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
          const action = typeof body.action === 'string' ? body.action : ''

          if (action === 'set-local') {
            const newPath = typeof body.path === 'string' ? body.path.trim() : ''
            if (!newPath) {
              return json({ ok: false, error: 'Path must not be empty' }, { status: 400 })
            }
            const result = await runVaultCli(['set-local', newPath])
            return json({ ok: true, result })
          }

          if (action === 'switch-cloud') {
            // Deliberately not implemented - see daemon/vault.mjs's
            // switchToCloud(). Returns a clear, honest error instead of a
            // generic 404/500.
            return json(
              {
                ok: false,
                error:
                  "Cloud Vault (Google Drive) isn't wired up yet — needs real Google OAuth client credentials.",
              },
              { status: 501 },
            )
          }

          return json({ ok: false, error: 'Unknown action' }, { status: 400 })
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
