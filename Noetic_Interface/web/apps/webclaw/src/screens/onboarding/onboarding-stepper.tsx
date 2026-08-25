import { cn } from '@/lib/utils'

export type OnboardingStep = 'welcome' | 'key' | 'pairing' | 'vault' | 'install'

const STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'key', label: 'Provider' },
  { id: 'pairing', label: 'Pairing' },
  { id: 'vault', label: 'Vault' },
  { id: 'install', label: 'App' },
]

export function OnboardingStepper({ current }: { current: OnboardingStep }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current)
  return (
    <div className="flex items-center gap-3" aria-label="Onboarding progress">
      {STEPS.map((step, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'upcoming'
        return (
          <div key={step.id} className="flex items-center gap-3">
            <div
              className={cn(
                'h-2.5 w-14 rounded-full transition-colors duration-300',
                state === 'upcoming' && 'bg-primary-200',
                // psy-morph: continuous hue-rotate over the gold fill, per
                // the user's explicit request for a "psychedelic" progress
                // bar (BRANDING.md section 7 names this animation for
                // exactly this kind of vivid color-cycling, originally
                // scoped to the logo only -- reused here at their ask).
                (state === 'active' || state === 'done') &&
                  'bg-gold animate-[psy-morph_4s_linear_infinite]',
                state === 'done' && 'opacity-60',
              )}
              aria-hidden="true"
            />
          </div>
        )
      })}
    </div>
  )
}
