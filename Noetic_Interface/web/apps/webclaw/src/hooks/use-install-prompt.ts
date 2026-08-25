import { useSyncExternalStore } from 'react'

// beforeinstallprompt can fire at any point in the page's lifetime,
// including before any component mounts -- so the listener attaches at
// module scope, once, rather than inside a component effect (which could
// miss an early fire). useSyncExternalStore lets any component subscribe
// to this module-level state without prop-drilling or a context provider.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredEvent: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's own mini-infobar -- we show our own UI
    // instead, on our own timing (after onboarding, not on first paint).
    event.preventDefault()
    deferredEvent = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferredEvent = null
    emit()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return deferredEvent !== null
}

function isStandaloneNow(): boolean {
  if (typeof window === 'undefined') return false
  const mql = window.matchMedia?.('(display-mode: standalone)')
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone
  return Boolean(mql?.matches || iosStandalone)
}

// Chromium-based browsers (Chrome, Edge, and should include Opera) fire
// beforeinstallprompt; Safari and Firefox desktop never do, and need
// manual "Add to Home Screen"/bookmark instructions instead. Detected
// once at module load, not per-render.
function detectFallbackKind(): 'safari' | 'firefox' | 'generic' {
  if (typeof navigator === 'undefined') return 'generic'
  const ua = navigator.userAgent
  const isSafari = /^((?!chrome|android|crios|edgios|opr).)*safari/i.test(ua)
  if (isSafari) return 'safari'
  if (/firefox/i.test(ua)) return 'firefox'
  return 'generic'
}

const fallbackKind = detectFallbackKind()

export function useInstallPrompt() {
  const canPrompt = useSyncExternalStore(subscribe, getSnapshot, () => false)
  const isStandalone = isStandaloneNow()

  async function promptInstall() {
    if (!deferredEvent) return
    await deferredEvent.prompt()
    await deferredEvent.userChoice
    // The captured event is one-shot per user gesture regardless of
    // outcome; if dismissed, a fresh one may fire again later.
    deferredEvent = null
    emit()
  }

  return {
    canPrompt,
    isStandalone: isStandalone || installed,
    fallbackKind,
    promptInstall,
  }
}
