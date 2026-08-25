import path from 'node:path'
import { spawn } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

// This file lives at Noetic_Interface/web/apps/webclaw/src/routes/api/ -
// seven levels up is the Psyntient_Node root. Shells out to
// daemon/working-memory.mjs's CLI entry rather than importing it directly,
// same reasoning as routes/api/vault.ts (Vite SSR bundling risk for a
// relative import reaching outside this app's own src/).
const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const SCRIPT = path.join(NODE_ROOT, 'daemon', 'working-memory.mjs')

function runWorkingMemoryCli(args: Array<string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: NODE_ROOT })
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
        reject(new Error('working-memory command returned unexpected output'))
      }
    })
  })
}

export const Route = createFileRoute('/api/projects')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const id = url.searchParams.get('id')?.trim() || ''

          if (id) {
            const project = await runWorkingMemoryCli(['project-detail', id])
            return json({ ok: true, project })
          }

          const projects = await runWorkingMemoryCli(['list-projects'])
          return json({ ok: true, projects })
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
