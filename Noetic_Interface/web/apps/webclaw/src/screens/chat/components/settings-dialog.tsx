import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import {
  formatCostUsd,
  formatModelName,
  formatTokenCount,
} from '../format-usage'
import type { PathsPayload } from '../types'
import type { ThinkingLevel } from '@/hooks/use-chat-settings'
import type { UsageResponse } from '../usage-types'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { useChatSettings } from '@/hooks/use-chat-settings'
import { Button } from '@/components/ui/button'

type SettingsSectionProps = {
  title: string
  children: React.ReactNode
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <div className="border-b border-primary-200 py-4 last:border-0">
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-gold-light/80">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

type SettingsRowProps = {
  label: string
  description?: string
  children: React.ReactNode
}

function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 select-none">
        <div className="text-sm text-primary-800">{label}</div>
        {description && (
          <div className="text-xs text-primary-500">{description}</div>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

type ProviderOption = { id: string; label: string }

// Add/replace/rotate a BYO LLM provider key from the Interface, without
// waiting for a re-run of the first-launch blocking gate. Calls the same
// daemon/providers.mjs setProviderKey() path that gate uses, via
// /api/provider-key (see CLAUDE.md's Settings key rotation section) - one
// code path for both, not a second implementation.
function ProviderKeySection() {
  const [providers, setProviders] = useState<Array<ProviderOption>>([])
  const [providerId, setProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    fetch('/api/provider-key')
      .then((res) => res.json())
      .then((data: { providers?: Array<ProviderOption> }) => {
        const list = data.providers ?? []
        setProviders(list)
        if (list.length > 0) setProviderId((current) => current || list[0].id)
      })
      .catch(() => {
        // Section still renders; the dropdown just stays empty and Save
        // is disabled below.
      })
  }, [])

  async function handleSave() {
    if (!providerId || !apiKey.trim()) return
    setStatus('saving')
    setErrorMessage('')
    try {
      const res = await fetch('/api/provider-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      setStatus('ok')
      setApiKey('')
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <SettingsSection title="Provider key">
      <p className="text-xs text-primary-500">
        Add, replace, or rotate your LLM provider API key. Saving restarts the
        Gateway, which can take up to a minute.
      </p>
      <div className="flex flex-col gap-2">
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          disabled={providers.length === 0 || status === 'saving'}
          className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none focus:border-primary-400 disabled:opacity-50"
        >
          {providers.length === 0 && <option>Loading providers…</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste API key"
          disabled={status === 'saving'}
          className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none focus:border-primary-400 disabled:opacity-50"
        />
        <div className="flex items-center gap-3">
          <Button
            variant="gold"
            size="sm"
            onClick={handleSave}
            disabled={status === 'saving' || !providerId || !apiKey.trim()}
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </Button>
          {status === 'ok' && (
            <span className="text-xs text-gold">Saved and restarted the Gateway.</span>
          )}
          {status === 'error' && (
            <span className="text-xs text-destructive">{errorMessage}</span>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}

const USAGE_RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
] as const

type UsageRange = (typeof USAGE_RANGES)[number]['value']

// Real, provider-reported token/cost usage (OpenClaw's sessions.usage RPC,
// via /api/usage) -- not a self-estimated budget. Session-level, refreshed
// on fetch/range-change, not live per-turn (OpenClaw doesn't push per-turn
// usage on the wire today -- see plan notes).
function UsageSection() {
  const [range, setRange] = useState<UsageRange>('30d')
  const [usage, setUsage] = useState<UsageResponse | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>(
    'idle',
  )
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    // A range switch fires a new fetch before the previous one may have
    // resolved -- guard against an older in-flight request's result (error
    // or stale data) landing after a newer one and clobbering it.
    let current = true
    setStatus('loading')
    fetch(`/api/usage?range=${range}`)
      .then((res) => res.json())
      .then((data: UsageResponse) => {
        if (data.error) throw new Error(data.error)
        if (!current) return
        setUsage(data)
        setStatus('ok')
      })
      .catch((err) => {
        if (!current) return
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : String(err))
      })
    return () => {
      current = false
    }
  }, [range])

  const byModel = usage?.aggregates?.byModel ?? []

  return (
    <SettingsSection title="Usage">
      <div className="flex items-center gap-2">
        {USAGE_RANGES.map((r) => (
          <Button
            key={r.value}
            size="sm"
            variant={range === r.value ? 'gold' : 'ghost'}
            onClick={() => setRange(r.value)}
          >
            {r.label}
          </Button>
        ))}
      </div>
      {status === 'loading' && !usage ? (
        <p className="text-xs text-primary-500">Loading…</p>
      ) : null}
      {status === 'error' ? (
        <span className="text-xs text-destructive">{errorMessage}</span>
      ) : null}
      {usage?.totals ? (
        <div className="text-sm text-primary-800">
          {formatTokenCount(usage.totals.totalTokens)} tokens ·{' '}
          {formatCostUsd(usage.totals.totalCost)}
        </div>
      ) : null}
      {byModel.length > 0 ? (
        <div className="space-y-1">
          {byModel.map((row, i) => (
            <SettingsRow
              key={`${row.provider}/${row.model}/${i}`}
              label={formatModelName(row.model) || 'Unknown model'}
              description={row.provider}
            >
              <span className="text-xs tabular-nums text-primary-700">
                {formatTokenCount(row.totals.totalTokens)} ·{' '}
                {formatCostUsd(row.totals.totalCost)}
              </span>
            </SettingsRow>
          ))}
        </div>
      ) : null}
    </SettingsSection>
  )
}

type VaultStatus = { storageMode: string; path?: string; writable?: boolean }

// Local vault path + cloud switch. Entirely local-Node-scoped — see
// CLAUDE.md section 8: no psyntient.io involvement in vault specifics,
// ever. Calls /api/vault, which shells out to daemon/vault.mjs.
function VaultSection() {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null)
  const [newPath, setNewPath] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  function refresh() {
    fetch('/api/vault')
      .then((res) => res.json())
      .then((data: { ok?: boolean; status?: VaultStatus }) => {
        if (data.ok && data.status) setVaultStatus(data.status)
      })
      .catch(() => {
        // Section still renders; current status just stays unknown.
      })
  }

  useEffect(refresh, [])

  async function handleRelocate() {
    if (!newPath.trim()) return
    setStatus('saving')
    setErrorMessage('')
    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set-local', path: newPath.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      setStatus('ok')
      setNewPath('')
      refresh()
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSwitchCloud() {
    setStatus('saving')
    setErrorMessage('')
    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'switch-cloud' }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      setStatus('ok')
      refresh()
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <SettingsSection title="Vault">
      <p className="text-xs text-primary-500">
        Your Neural Vault stays on this machine — psyntient.io never knows where
        it lives or what's in it.
      </p>
      <SettingsRow
        label="Storage"
        description={vaultStatus?.path ?? (vaultStatus ? undefined : 'Loading…')}
      >
        <span className="text-sm text-primary-800 capitalize">
          {vaultStatus?.storageMode ?? '—'}
        </span>
      </SettingsRow>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          placeholder="New local path (moves existing contents)"
          disabled={status === 'saving'}
          className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none focus:border-primary-400 disabled:opacity-50"
        />
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRelocate}
            disabled={status === 'saving' || !newPath.trim()}
          >
            {status === 'saving' ? 'Working…' : 'Relocate'}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSwitchCloud} disabled={status === 'saving'}>
            Switch to Google Drive
          </Button>
        </div>
        {status === 'ok' && <span className="text-xs text-gold">Done.</span>}
        {status === 'error' && <span className="text-xs text-destructive">{errorMessage}</span>}
      </div>
    </SettingsSection>
  )
}

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pathsLoading: boolean
  pathsError: string | null
  paths: PathsPayload | null
  onClose: () => void
  onCopySessionsDir: () => void
  onCopyStorePath: () => void
}

export function SettingsDialog({
  open,
  onOpenChange,
  onClose,
}: SettingsDialogProps) {
  const { settings, updateSettings } = useChatSettings()
  const thinkingOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ] as const

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,92vw)] max-h-[80vh] overflow-auto">
        <div className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="mb-1">Settings</DialogTitle>
              <DialogDescription className="hidden">
                Configure the Noetic Interface
              </DialogDescription>
            </div>
            <DialogClose
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-primary-500 hover:bg-primary-100 hover:text-primary-700"
                  aria-label="Close"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={20}
                    strokeWidth={1.5}
                  />
                </Button>
              }
            />
          </div>

          <SettingsSection title="Connection">
            <SettingsRow label="Status">
              <span className="flex items-center gap-1.5 text-sm text-gold">
                <span className="size-1.5 animate-pulse rounded-full bg-gold [animation-duration:2.5s]" />
                Connected
              </span>
            </SettingsRow>
          </SettingsSection>

          <ProviderKeySection />

          <UsageSection />

          <VaultSection />

          <SettingsSection title="Chat">
            <SettingsRow label="Show tool messages">
              <Switch
                checked={settings.showToolMessages}
                onCheckedChange={(checked) =>
                  updateSettings({ showToolMessages: checked })
                }
              />
            </SettingsRow>
            <SettingsRow label="Show reasoning blocks">
              <Switch
                checked={settings.showReasoningBlocks}
                onCheckedChange={(checked) =>
                  updateSettings({ showReasoningBlocks: checked })
                }
              />
            </SettingsRow>
            <SettingsRow label="Thinking level">
              <Tabs
                value={settings.thinkingLevel}
                onValueChange={(value) => {
                  updateSettings({ thinkingLevel: value as ThinkingLevel })
                }}
              >
                <TabsList
                  variant="default"
                  className="gap-2 *:data-[slot=tab-indicator]:duration-0"
                >
                  {thinkingOptions.map((option) => (
                    <TabsTab key={option.value} value={option.value}>
                      <span>{option.label}</span>
                    </TabsTab>
                  ))}
                </TabsList>
              </Tabs>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="About">
            <div className="text-sm text-primary-800">Noetic Interface</div>
            <div className="flex gap-4 pt-2">
              <a
                href="https://psyntient.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-600 hover:text-primary-900 hover:underline"
              >
                Psyntient
              </a>
              <a
                href="https://docs.openclaw.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-600 hover:text-primary-900 hover:underline"
              >
                OpenClaw docs
              </a>
            </div>
          </SettingsSection>

          <div className="mt-6 flex justify-end">
            <DialogClose onClick={onClose}>Close</DialogClose>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
