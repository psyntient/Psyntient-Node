import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { gatewayRpc } from '../../server/gateway'

type ChatHistoryResponse = {
  sessionKey: string
  sessionId?: string
  messages: Array<any>
  thinkingLevel?: string
}

type SessionsResolveResponse = {
  ok?: boolean
  key?: string
}

export const Route = createFileRoute('/api/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const limit = Number(url.searchParams.get('limit') || '200')
          const rawSessionKey = url.searchParams.get('sessionKey')?.trim()
          const friendlyId = url.searchParams.get('friendlyId')?.trim()

          let sessionKey =
            rawSessionKey && rawSessionKey.length > 0 ? rawSessionKey : ''

          if (!sessionKey && friendlyId) {
            const resolved = await gatewayRpc<SessionsResolveResponse>(
              'sessions.resolve',
              {
                key: friendlyId,
                includeUnknown: true,
                includeGlobal: true,
              },
            )
            const resolvedKey =
              typeof resolved.key === 'string' ? resolved.key.trim() : ''
            if (resolvedKey.length === 0) {
              return json({ error: 'session not found' }, { status: 404 })
            }
            sessionKey = resolvedKey
          }

          if (sessionKey.length === 0) {
            sessionKey = 'main'
          }

          // The Gateway rebuilds its session-transcript projection
          // periodically and, while it does, answers chat.history with
          // UNAVAILABLE / "session history is rebuilding; retry shortly".
          // That is an explicitly retryable condition, but this route used
          // to convert it straight into a 500 with no `messages` field --
          // measured at ~4% of requests (1 in 25) against a perfectly
          // healthy backend. The client then had nothing to render, which
          // is what produced completed replies showing as blank and the
          // "message flashes then disappears" behaviour: a finished run
          // sat in the store while the UI was handed an error instead.
          // Retry with a short backoff rather than failing the request.
          let payload: ChatHistoryResponse | null = null
          let lastErr: unknown = null
          for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
              payload = await gatewayRpc<ChatHistoryResponse>('chat.history', {
                sessionKey,
                limit,
              })
              break
            } catch (err) {
              lastErr = err
              const message = err instanceof Error ? err.message : String(err)
              const retryable =
                /rebuild|UNAVAILABLE|retry shortly|projection/i.test(message)
              if (!retryable || attempt === 3) throw err
              await new Promise((resolve) =>
                setTimeout(resolve, 150 * (attempt + 1)),
              )
            }
          }
          if (!payload) throw lastErr ?? new Error('chat.history failed')

          return json(payload)
        } catch (err) {
          return json(
            {
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
