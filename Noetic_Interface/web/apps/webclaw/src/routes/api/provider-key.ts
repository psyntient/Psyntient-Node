import path from 'node:path'
import { spawn } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

// Mirrors daemon/providers.mjs's SUPPORTED_PROVIDERS. Duplicated rather
// than imported across the WebClaw/daemon module boundary - a relative
// import reaching outside this app's own src/ risks Vite's SSR bundler
// trying to analyze/bundle unrelated daemon code. The actual key write
// still goes through the real daemon module (see below), so this list is
// the only thing kept in sync by hand; it's small and stable.
const SUPPORTED_PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter (recommended — one key, many models)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
  { id: 'groq', label: 'Groq' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'xai', label: 'xAI' },
  { id: 'cohere', label: 'Cohere' },
  { id: 'perplexity', label: 'Perplexity' },
]

// This file lives at Noetic_Interface/web/apps/webclaw/src/routes/api/ -
// seven levels up is the Psyntient_Node root.
const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const PROVIDERS_SCRIPT = path.join(NODE_ROOT, 'daemon', 'providers.mjs')

function setProviderKeyViaDaemon(providerId: string, apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PROVIDERS_SCRIPT, 'add', providerId], {
      cwd: NODE_ROOT,
    })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `daemon exited with code ${code}`))
    })
    child.stdin.write(apiKey.endsWith('\n') ? apiKey : apiKey + '\n')
    child.stdin.end()
  })
}

export const Route = createFileRoute('/api/provider-key')({
  server: {
    handlers: {
      GET: () => {
        return json({ providers: SUPPORTED_PROVIDERS })
      },
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
          const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
          const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

          if (!provider || !SUPPORTED_PROVIDERS.some((p) => p.id === provider)) {
            return json({ ok: false, error: 'Unknown provider' }, { status: 400 })
          }
          if (!apiKey) {
            return json({ ok: false, error: 'API key must not be empty' }, { status: 400 })
          }

          // setProviderKey() in daemon/providers.mjs restarts the Gateway
          // after saving - this call can take a while (observed ~10-40s
          // for the restart alone). The route intentionally waits for it
          // rather than backgrounding, so the UI can show a real
          // success/failure result instead of guessing.
          await setProviderKeyViaDaemon(provider, apiKey)
          return json({ ok: true })
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
