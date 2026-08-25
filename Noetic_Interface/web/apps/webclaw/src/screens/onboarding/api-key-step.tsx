import { useEffect, useState } from 'react'
import { ProcessingSpinner } from './processing-spinner'
import { Button } from '@/components/ui/button'

type ProviderOption = { id: string; label: string }
type Phase = 'idle' | 'saving' | 'testing' | 'ok' | 'error'

export function ApiKeyStep({ onNext }: { onNext: () => void }) {
  const [providers, setProviders] = useState<Array<ProviderOption>>([])
  const [providerId, setProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    fetch('/api/provider-key')
      .then((res) => res.json())
      .then((data: { providers?: Array<ProviderOption> }) => {
        const list = data.providers ?? []
        setProviders(list)
        if (list.length > 0) setProviderId((current) => current || list[0].id)
      })
      .catch(() => {})
  }, [])

  async function handleSaveAndTest() {
    if (!providerId || !apiKey.trim()) return
    setErrorMessage('')
    setPhase('saving')
    try {
      const saveRes = await fetch('/api/provider-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey }),
      })
      const saveData = (await saveRes.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!saveRes.ok || !saveData.ok) {
        throw new Error(saveData.error || `Save failed (${saveRes.status})`)
      }

      setPhase('testing')
      const testRes = await fetch('/api/provider-key/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      })
      const testData = (await testRes.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!testRes.ok || !testData.ok) {
        throw new Error(testData.error || 'The key was saved but the connection test failed.')
      }

      setApiKey('')
      setPhase('ok')
    } catch (err) {
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = phase === 'saving' || phase === 'testing'

  return (
    <div className="flex w-full max-w-lg flex-col gap-6 text-center">
      <div className="space-y-3">
        <h1 className="font-serif text-4xl text-primary-950">Connect a model</h1>
        <p className="text-lg text-primary-600">
          Bring your own API key — it's stored locally and never leaves this
          machine. We'll verify it actually works before moving on.
        </p>
      </div>
      <div className="flex flex-col gap-3 text-left">
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          disabled={providers.length === 0 || busy}
          className="w-full rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-base text-primary-900 outline-none focus:border-primary-400 disabled:opacity-50"
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
          disabled={busy}
          className="w-full rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-base text-primary-900 outline-none focus:border-primary-400 disabled:opacity-50"
        />
      </div>

      {phase !== 'ok' && (
        <Button
          variant="gold"
          size="lg"
          className="h-12 text-base"
          onClick={handleSaveAndTest}
          disabled={busy || !providerId || !apiKey.trim()}
        >
          {phase === 'saving' && 'Saving…'}
          {phase === 'testing' && 'Testing connection…'}
          {(phase === 'idle' || phase === 'error') && 'Save and test'}
        </Button>
      )}
      {busy && (
        <div className="flex items-center justify-center gap-2 text-sm text-primary-500">
          <ProcessingSpinner size="size-5" />
          {phase === 'saving' && 'Saving and restarting the Gateway…'}
          {phase === 'testing' && 'Running a real test request…'}
        </div>
      )}
      {phase === 'error' && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
      {phase === 'ok' && (
        <>
          <p className="text-sm text-gold">Connected — the key works.</p>
          <Button variant="gold" size="lg" className="h-12 text-base" onClick={onNext}>
            Continue →
          </Button>
        </>
      )}
    </div>
  )
}
