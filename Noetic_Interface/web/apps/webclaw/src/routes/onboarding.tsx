import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { OnboardingStep } from '@/screens/onboarding/onboarding-stepper'
import { OnboardingStepper } from '@/screens/onboarding/onboarding-stepper'
import { WelcomeStep } from '@/screens/onboarding/welcome-step'
import { ApiKeyStep } from '@/screens/onboarding/api-key-step'
import { PairingStep } from '@/screens/onboarding/pairing-step'
import { VaultStep } from '@/screens/onboarding/vault-step'
import { ProcessingSpinner } from '@/screens/onboarding/processing-spinner'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingRoute,
})

type OnboardingStatus = { hasProvider: boolean; isPaired: boolean; completed: boolean }

// Resume point: skip whatever's already satisfied rather than always
// starting at Welcome. The Vault step isn't a real gate (local Vault
// activates automatically) -- `completed` is a one-time "seen it"
// marker, not derived state, so it's checked last.
function resumeStepFor(status: OnboardingStatus): OnboardingStep {
  if (!status.hasProvider) return 'welcome'
  if (!status.isPaired) return 'pairing'
  return 'vault'
}

function OnboardingRoute() {
  const navigate = useNavigate()
  const [step, setStep] = useState<OnboardingStep | null>(null)

  useEffect(() => {
    fetch('/api/onboarding')
      .then((res) => res.json())
      .then((data: { ok?: boolean; status?: OnboardingStatus }) => {
        if (data.ok && data.status) {
          if (data.status.hasProvider && data.status.isPaired && data.status.completed) {
            void navigate({ to: '/chat/$sessionKey', params: { sessionKey: 'main' }, replace: true })
            return
          }
          setStep(resumeStepFor(data.status))
        } else {
          setStep('welcome')
        }
      })
      .catch(() => setStep('welcome'))
  }, [navigate])

  async function finishOnboarding() {
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'complete' }),
    }).catch(() => {})
    // Mirrors __root.tsx's OnboardingGate cache -- without this, a page
    // refresh right after finishing the wizard would pay the ~10-15s
    // hasProvider check again before the Gate's own cache-write path
    // (inside its fetch) ever got a chance to run.
    sessionStorage.setItem('psyntient-onboarding-complete', '1')
    void navigate({ to: '/chat/$sessionKey', params: { sessionKey: 'main' }, replace: true })
  }

  if (!step) {
    // Checking hasProvider/isPaired shells out to the real OpenClaw auth
    // store (models auth list), which has real, unavoidable CLI startup
    // cost (~10-15s observed) -- show that something's happening rather
    // than a blank screen that looks frozen.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface text-center">
        <ProcessingSpinner />
        <p className="text-base text-primary-500">Checking your setup…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-12 bg-surface px-6">
      <OnboardingStepper current={step} />
      {step === 'welcome' && <WelcomeStep onNext={() => setStep('key')} />}
      {step === 'key' && <ApiKeyStep onNext={() => setStep('pairing')} />}
      {step === 'pairing' && <PairingStep onNext={() => setStep('vault')} />}
      {step === 'vault' && <VaultStep onNext={() => void finishOnboarding()} />}
    </div>
  )
}
