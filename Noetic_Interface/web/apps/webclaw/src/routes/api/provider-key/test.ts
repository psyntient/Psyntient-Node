import path from 'node:path'
import { spawn } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

// Nested under routes/api/provider-key/ -- path is /api/provider-key/test.
// Lives alongside ../provider-key.ts's save endpoint; call save first,
// then this, per the onboarding wizard's step 2 (a live connection
// test before proceeding -- see CLAUDE.md "TARGET onboarding flow").
//
// NODE_ROOT depth here matches the flat routes/api/*.ts siblings (7
// levels, not 8) even though this file is one directory deeper in
// src/ -- confirmed via a real MODULE_NOT_FOUND failure in production
// that the dev server didn't reproduce: the production SSR bundle
// flattens this nested route to the same output depth as its flat
// siblings, so import.meta.dirname ends up shallower than source
// nesting would suggest. Source-relative dot-counting is the wrong
// mental model for the bundled runtime path.
const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const PROVIDER_TEST_SCRIPT = path.join(NODE_ROOT, 'daemon', 'provider-test.mjs')

function runProviderTestCli(providerId: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PROVIDER_TEST_SCRIPT, providerId], { cwd: NODE_ROOT })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', () => {
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error(stderr.trim() || 'Connection test returned unexpected output'))
      }
    })
  })
}

export const Route = createFileRoute('/api/provider-key/test')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
          const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
          if (!provider) {
            return json({ ok: false, error: 'provider required' }, { status: 400 })
          }
          const result = await runProviderTestCli(provider)
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
