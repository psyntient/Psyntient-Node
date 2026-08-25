import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, Download01Icon } from '@hugeicons/core-free-icons'
import { useInstallPrompt } from '@/hooks/use-install-prompt'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DISMISSED_KEY = 'psyntient-install-banner-dismissed'

// Browser install-prompt UX is too inconsistent to rely on natively --
// Chromium browsers gate their own address-bar icon behind an opaque
// engagement heuristic, Safari has no programmatic install API at all,
// and Opera's icon (Chromium-based, but its own heuristics) isn't
// reliably discoverable either. This shows one clear, on-brand ask
// instead of hoping someone notices browser chrome.
export function InstallBanner() {
  const { canPrompt, isStandalone, fallbackKind, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === '1')
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1')
    setDismissed(true)
  }

  if (isStandalone || dismissed) return null
  // Firefox desktop has no install path and no reliable "add to home
  // screen" affordance either -- nothing useful to show there.
  if (!canPrompt && fallbackKind === 'firefox') return null

  const message = canPrompt
    ? 'Install Psyntient Node for quick access, without the browser bar.'
    : fallbackKind === 'safari'
      ? 'Add Psyntient Node to your Dock: tap Share, then Add to Dock.'
      : fallbackKind === 'opera'
        ? "Opera doesn't support app installation — bookmark this page for quick access instead."
        : 'Bookmark this page for quick access to your Node.'

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-primary-200 bg-primary-50 px-4 py-2 text-sm',
      )}
    >
      <span className="flex-1 text-primary-800">{message}</span>
      {canPrompt ? (
        <Button
          size="sm"
          variant="gold"
          onClick={() => {
            void promptInstall()
            dismiss()
          }}
        >
          <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.75} />
          Install
        </Button>
      ) : null}
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={dismiss}
        className="text-primary-500 hover:bg-primary-100 hover:text-primary-700"
        aria-label="Dismiss"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.75} />
      </Button>
    </div>
  )
}
