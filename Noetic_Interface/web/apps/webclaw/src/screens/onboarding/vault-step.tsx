import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

type VaultStatus = { storageMode: 'local' | 'cloud'; path?: string }

export function VaultStep({ onNext }: { onNext: () => void }) {
  const [status, setStatus] = useState<VaultStatus | null>(null)

  useEffect(() => {
    fetch('/api/vault')
      .then((res) => res.json())
      .then((data: { ok?: boolean; status?: VaultStatus }) => {
        if (data.ok && data.status) setStatus(data.status)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
      <div className="space-y-3">
        <h1 className="font-serif text-4xl text-primary-950">Your Neural Vault</h1>
        <p className="text-lg text-primary-600">
          This is where everything you record and discuss lives — local by
          default, encrypted, and never uploaded anywhere without your
          explicit consent. You can change this anytime from Settings.
        </p>
      </div>

      <div className="w-full rounded-2xl border border-primary-200 bg-primary-50 px-5 py-4 text-left">
        <div className="text-sm font-medium text-primary-900">
          Storage: {status?.storageMode === 'cloud' ? 'Cloud' : 'Local'}
        </div>
        <div className="mt-1 truncate font-mono text-sm text-primary-600">
          {status?.path ?? 'Resolving…'}
        </div>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Button variant="gold" size="lg" className="h-12 text-base" onClick={onNext}>
          Continue →
        </Button>
        <Button variant="outline" size="default" className="h-10 text-sm" disabled title="Coming soon">
          Switch to Google Drive (coming soon)
        </Button>
      </div>
    </div>
  )
}
