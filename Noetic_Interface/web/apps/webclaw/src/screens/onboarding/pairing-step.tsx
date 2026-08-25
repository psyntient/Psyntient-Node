import { useCallback, useEffect, useRef, useState } from 'react'
import { ProcessingSpinner } from './processing-spinner'
import { Button } from '@/components/ui/button'

type Phase = 'starting' | 'waiting' | 'ok' | 'denied' | 'error'

// Mandatory, not skippable (CLAUDE.md policy reversal: pairing will
// eventually gate subscription status, so a Node that's never paired
// can never be gated on entitlement). Auto-triggers on mount; the only
// way forward on denial/error is to try again, not to skip past it.
export function PairingStep({ onNext }: { onNext: () => void }) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [errorMessage, setErrorMessage] = useState('')
  const startedRef = useRef(false)

  const startPairing = useCallback(async () => {
    setPhase('waiting')
    setErrorMessage('')
    try {
      const res = await fetch('/api/pairing', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        denied?: boolean
        error?: string
      }
      if (data.ok) {
        setPhase('ok')
        onNext()
        return
      }
      if (data.denied) {
        setPhase('denied')
        return
      }
      throw new Error(data.error || `Pairing failed (${res.status})`)
    } catch (err) {
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }, [onNext])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void startPairing()
  }, [startPairing])

  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
      <div className="space-y-3">
        <h1 className="font-serif text-4xl text-primary-950">
          Pair with psyntient.io
        </h1>
        <p className="text-lg text-primary-600">
          Your Node needs a one-time pairing with your Psyntient account.
          This identifies the Node, not your data — nothing in your Vault or
          chats is ever shared.
        </p>
      </div>

      {phase === 'starting' && (
        <div className="flex flex-col items-center gap-3 text-sm text-primary-500">
          <ProcessingSpinner size="size-8" />
          Opening your browser…
        </div>
      )}
      {phase === 'waiting' && (
        <div className="flex flex-col items-center gap-3 text-sm text-primary-500">
          <ProcessingSpinner size="size-8" />
          Waiting for you to approve in your browser…
        </div>
      )}
      {phase === 'denied' && (
        <>
          <p className="text-sm text-destructive">
            Pairing was cancelled. Psyntient Node can't chat without an
            active pairing.
          </p>
          <Button variant="gold" size="lg" className="h-12 text-base" onClick={() => void startPairing()}>
            Try again →
          </Button>
        </>
      )}
      {phase === 'error' && (
        <>
          <p className="text-sm text-destructive">{errorMessage}</p>
          <Button variant="gold" size="lg" className="h-12 text-base" onClick={() => void startPairing()}>
            Try again →
          </Button>
        </>
      )}
    </div>
  )
}
