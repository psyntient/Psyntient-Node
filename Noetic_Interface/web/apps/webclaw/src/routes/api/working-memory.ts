import path from 'node:path'
import { spawn } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { gatewayRpc } from '../../server/gateway'

// This file lives at Noetic_Interface/web/apps/webclaw/src/routes/api/ -
// seven levels up is the Psyntient_Node root. Shells out to
// daemon/working-memory.mjs's CLI entry rather than importing it
// directly, same reasoning as routes/api/vault.ts (Vite SSR bundling
// risk for a relative import reaching outside this app's own src/).
const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const WORKING_MEMORY_SCRIPT = path.join(NODE_ROOT, 'daemon', 'working-memory.mjs')

function runWorkingMemoryCli(args: Array<string>, stdinInput?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKING_MEMORY_SCRIPT, ...args], { cwd: NODE_ROOT })
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
    if (stdinInput !== undefined) {
      child.stdin.write(stdinInput)
    }
    child.stdin.end()
  })
}

type SessionsResolveResponse = {
  ok?: boolean
  key?: string
}

type ChatHistoryResponse = {
  messages?: Array<unknown>
}

// POST { friendlyId, sessionKey? } — resolves the real sessionKey the
// same way routes/api/history.ts does, pulls the current transcript
// straight from the Gateway (ground truth), and mirrors it into
// Working_Memory/chat_context/<friendlyId>/messages.jsonl. Fetching the
// transcript server-side (rather than trusting a client-supplied
// messages array) keeps this route from writing arbitrary local files
// based on whatever a request body claims happened in the chat.
export const Route = createFileRoute('/api/working-memory')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
          const friendlyId = typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const rawSessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''

          if (!friendlyId) {
            return json({ ok: false, error: 'friendlyId required' }, { status: 400 })
          }

          let sessionKey = rawSessionKey
          if (!sessionKey) {
            const resolved = await gatewayRpc<SessionsResolveResponse>('sessions.resolve', {
              key: friendlyId,
              includeUnknown: true,
              includeGlobal: true,
            })
            sessionKey = typeof resolved.key === 'string' ? resolved.key.trim() : ''
          }
          if (!sessionKey) {
            return json({ ok: false, error: 'could not resolve sessionKey' }, { status: 404 })
          }

          const history = await gatewayRpc<ChatHistoryResponse>('chat.history', {
            sessionKey,
            limit: 1000,
          })
          const messages = Array.isArray(history.messages) ? history.messages : []

          const result = await runWorkingMemoryCli(['sync-thread', friendlyId], JSON.stringify(messages))
          return json({ ok: true, result })
        } catch (err) {
          return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
        }
      },
    },
  },
})
