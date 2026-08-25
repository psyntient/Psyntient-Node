import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

// Serves research artifacts (charts, exported tables) the agent generated
// into a project's scratch/ (or, once synced, the Vault's exports/) --
// see daemon/working-memory.mjs's resolveProjectArtifact(). Referenced by
// the agent in chat replies via a plain markdown image tag
// (![chart](/api/artifact/<project>/<file>)) so it renders inline with no
// new frontend wiring -- the chat Markdown component has no image-source
// restriction configured.
const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const WORKING_MEMORY_SCRIPT = path.join(NODE_ROOT, 'daemon', 'working-memory.mjs')

type ResolvedArtifact = { path: string; contentType: string } | null

function resolveArtifact(projectId: string, filename: string): Promise<ResolvedArtifact> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [WORKING_MEMORY_SCRIPT, 'resolve-artifact', projectId, filename],
      { cwd: NODE_ROOT },
    )
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
        resolve(JSON.parse(stdout.trim()) as ResolvedArtifact)
      } catch {
        reject(new Error('Artifact command returned unexpected output'))
      }
    })
  })
}

export const Route = createFileRoute('/api/artifact')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const projectId = url.searchParams.get('project') ?? ''
          const filename = url.searchParams.get('file') ?? ''
          if (!projectId || !filename) {
            return json({ error: 'Missing project or file' }, { status: 400 })
          }

          const resolved = await resolveArtifact(projectId, filename)
          if (!resolved) {
            return json({ error: 'Not found' }, { status: 404 })
          }

          const data = await fs.readFile(resolved.path)
          return new Response(new Uint8Array(data), {
            headers: {
              'content-type': resolved.contentType,
              'cache-control': 'no-store',
            },
          })
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
