import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { DatabaseSyncIcon } from '@hugeicons/core-free-icons'
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from '@/components/ui/preview-card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type VaultStatus = {
  storageMode: 'local' | 'cloud'
  path?: string
  writable?: boolean
}

async function fetchVaultStatus(): Promise<VaultStatus | null> {
  const res = await fetch('/api/vault')
  if (!res.ok) return null
  const body = (await res.json()) as { ok: boolean; status?: VaultStatus }
  return body.ok && body.status ? body.status : null
}

function providerLabel(status: VaultStatus): string {
  return status.storageMode === 'cloud' ? 'Google Drive' : 'Local'
}

// Spec (BRANDING.md section 6 top-bar layout, section 7 motion): a
// persistent Vault sync indicator + provider badge, using the psy-aura
// "live dot" animation defined for exactly this purpose.
function VaultBadgeComponent() {
  const { data: status } = useQuery({
    queryKey: ['vault', 'status'],
    queryFn: fetchVaultStatus,
    refetchInterval: 30000,
    staleTime: 15000,
  })

  if (!status) return null

  const label = providerLabel(status)
  const synced = status.writable !== false

  return (
    <PreviewCard>
      <PreviewCardTrigger
        className={cn(
          buttonVariants({ size: 'sm', variant: 'ghost' }),
          'gap-1.5 px-2 text-primary-800 hover:bg-primary-100',
        )}
      >
        <span className="relative inline-flex size-3.5 items-center justify-center">
          <span
            className={cn(
              'absolute inline-flex size-2 rounded-full bg-gold',
              synced && 'animate-[psy-aura_7s_ease-in-out_infinite]',
            )}
            aria-hidden="true"
          />
          <span
            className="relative inline-flex size-1.5 rounded-full bg-gold"
            aria-hidden="true"
          />
        </span>
        <HugeiconsIcon icon={DatabaseSyncIcon} size={14} strokeWidth={1.6} />
        <span className="text-xs font-medium">{label}</span>
      </PreviewCardTrigger>
      <PreviewCardPopup align="end" sideOffset={0} className="w-64 px-2 py-1">
        <div className="space-y-0.5 text-xs text-primary-900">
          <div className="text-primary-950 font-[450]">
            Neural Vault — {label}
          </div>
          {status.path ? (
            <div className="truncate font-mono text-[11px] text-primary-700">
              {status.path}
            </div>
          ) : null}
          <div className="text-primary-700">
            {synced ? 'Synced and writable' : 'Not currently writable'}
          </div>
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  )
}

export const VaultBadge = memo(VaultBadgeComponent)
