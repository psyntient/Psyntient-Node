import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { gatewayRpc, gatewayRpcShared } from '../../server/gateway'

type SessionsResolveResponse = {
  ok?: boolean
  key?: string
}

export const Route = createFileRoute('/api/send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const friendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const message = String(body.message ?? '')
          const thinking =
            typeof body.thinking === 'string' ? body.thinking : undefined

          const rawAttachments = body.attachments
          const attachments = Array.isArray(rawAttachments)
            ? rawAttachments.filter(
                (a: unknown): a is { mimeType: string; content: string } =>
                  typeof a === 'object' &&
                  a !== null &&
                  typeof (a as Record<string, unknown>).mimeType === 'string' &&
                  typeof (a as Record<string, unknown>).content === 'string',
              )
            : undefined

          if (!message.trim() && (!attachments || attachments.length === 0)) {
            return json(
              { ok: false, error: 'message required' },
              { status: 400 },
            )
          }

          let sessionKey = rawSessionKey.length > 0 ? rawSessionKey : ''

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
              return json(
                { ok: false, error: 'session not found' },
                { status: 404 },
              )
            }
            sessionKey = resolvedKey
          }

          if (sessionKey.length === 0) {
            // Resolve the bare default to its canonical key instead of
            // sending literal "main".
            //
            // gatewayRpcShared keys its pooled connection by this string, and
            // /api/stream registers its listener under `sessionKey ||
            // friendlyId` -- which for the default session is the canonical
            // "agent:main:main". Sending "main" here therefore ran the turn on
            // a DIFFERENT pooled connection than the one the SSE stream was
            // listening on, so every event for the default session was emitted
            // where nobody was subscribed.
            //
            // Measured: the default session received zero chat/agent events
            // (not even `final`) while a fresh session on the same Gateway got
            // status/delta/final normally. The reply still landed in history,
            // so the UI only recovered via the 15s safety-net refetch or a
            // page reload -- which is what surfaced as "blank reply" and as a
            // fixed ~15-17s latency that no model or token change could move.
            const resolvedDefault = await gatewayRpc<SessionsResolveResponse>(
              'sessions.resolve',
              { key: 'main', includeUnknown: true, includeGlobal: true },
            ).catch(() => null)
            const canonical =
              typeof resolvedDefault?.key === 'string'
                ? resolvedDefault.key.trim()
                : ''
            sessionKey = canonical.length > 0 ? canonical : 'main'
          }

          const res = await gatewayRpcShared<{ runId: string }>(
            'chat.send',
            {
              sessionKey,
              message,
              thinking,
              attachments,
              deliver: true,
              timeoutMs: 120_000,
              idempotencyKey:
                typeof body.idempotencyKey === 'string'
                  ? body.idempotencyKey
                  : randomUUID(),
            },
            sessionKey,
          )

          return json({ ok: true, ...res, sessionKey })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
