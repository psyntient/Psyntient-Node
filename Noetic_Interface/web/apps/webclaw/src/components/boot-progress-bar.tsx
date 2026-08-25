import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// The real check behind this (hasAnyProvider's `openclaw models auth
// list` shell-out, see __root.tsx's OnboardingGate) has no granular
// progress to report -- it's one opaque ~10-15s call. Rather than a bare
// spinner, simulate a boot-sequence fill that eases toward ~92% and never
// quite finishes on its own, then snap to 100% once the real check
// resolves. Standard "asymptotic progress bar" pattern (npm install,
// GitHub PR merge, etc.) -- reads as real work happening without
// claiming a false level of precision.
const BOOT_MESSAGES = [
  'Verifying provider connection…',
  'Confirming Node pairing…',
  'Loading Cortex workspace…',
  'Almost there…',
]

export function BootProgressBar({ done }: { done: boolean }) {
  const [progress, setProgress] = useState(4)
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    if (done) return
    const progressTimer = setInterval(() => {
      setProgress((p) => (p >= 92 ? p : p + (92 - p) * 0.12 + 0.4))
    }, 200)
    const messageTimer = setInterval(() => {
      setMessageIndex((i) => (i + 1) % BOOT_MESSAGES.length)
    }, 2600)
    return () => {
      clearInterval(progressTimer)
      clearInterval(messageTimer)
    }
  }, [done])

  return (
    <div className="flex w-56 flex-col items-center gap-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary-200">
        <div
          className={cn(
            'h-full rounded-full bg-gold transition-[width] duration-300 ease-out',
            'animate-[psy-morph_4s_linear_infinite]',
          )}
          style={{ width: `${done ? 100 : progress}%` }}
        />
      </div>
      <p className="text-xs text-primary-500" aria-live="polite">
        {done ? 'Ready.' : BOOT_MESSAGES[messageIndex]}
      </p>
    </div>
  )
}
