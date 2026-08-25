import { HugeiconsIcon } from '@hugeicons/react'
import { Download01Icon } from '@hugeicons/core-free-icons'
import { useInstallPrompt } from '@/hooks/use-install-prompt'
import { Button } from '@/components/ui/button'

// Same use-install-prompt.ts hook the post-onboarding banner and Settings
// use -- one source of truth for "can this browser install, and if not,
// what should we tell the user instead." Never blocks progress: this is
// a recommendation, not a gate, same posture as VaultStep.
export function InstallStep({ onNext }: { onNext: () => void }) {
  const { canPrompt, isStandalone, fallbackKind, promptInstall } = useInstallPrompt()

  const instructions = isStandalone
    ? "You're already running Psyntient Node as an installed app."
    : canPrompt
      ? 'Your browser supports installing it directly — no browser bar, its own window.'
      : fallbackKind === 'safari'
        ? 'Safari: tap Share, then Add to Dock.'
        : fallbackKind === 'opera'
          ? "Opera doesn't support app installation — bookmarking is the way to go here."
          : 'Bookmark this page (⌘/Ctrl+D) for quick access.'

  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
      <div className="space-y-3">
        <h1 className="font-serif text-4xl text-primary-950">Quick access to your Node</h1>
        <p className="text-lg text-primary-600">
          Psyntient Node runs in your browser by default. For easy access, we
          recommend either downloading it as an app, or bookmarking this
          page — whichever fits your browser.
        </p>
      </div>

      <div className="w-full rounded-2xl border border-primary-200 bg-primary-50 px-5 py-4 text-left">
        <div className="text-sm font-medium text-primary-900">
          {isStandalone ? 'Installed' : 'Recommended for your browser'}
        </div>
        <div className="mt-1 text-sm text-primary-600">{instructions}</div>
        {canPrompt && !isStandalone ? (
          <Button
            variant="gold"
            size="sm"
            className="mt-3"
            onClick={() => void promptInstall()}
          >
            <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.75} />
            Download app
          </Button>
        ) : null}
      </div>

      <div className="flex w-full flex-col gap-3">
        <Button variant="gold" size="lg" className="h-12 text-base" onClick={onNext}>
          Continue →
        </Button>
      </div>
    </div>
  )
}
