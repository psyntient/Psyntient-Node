import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { gatewayRpc } from '../../server/gateway'

type UsageGatewayResponse = Record<string, unknown>

const ALLOWED_RANGES = new Set(['7d', '30d', '90d', '1y', 'all'])

export const Route = createFileRoute('/api/usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const rangeParam = url.searchParams.get('range') ?? '30d'
          const range = ALLOWED_RANGES.has(rangeParam) ? rangeParam : '30d'

          const payload = await gatewayRpc<UsageGatewayResponse>(
            'sessions.usage',
            {
              range,
              groupBy: 'family',
              agentScope: 'all',
            },
          )

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
