'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

// Wraps an assistant text block while it's actively receiving tokens:
// a bordered bubble with a pulsing border + light sweep (mirrors
// OpenClaw's own dashboard chatStreamPulse), plus a throttled fade/
// slide-up "unfold" retrigger as new chunks land. The retrigger is a
// classic force-reflow restart (remove class, force layout, re-add) on
// the same DOM node rather than a React key remount, so the already-
// parsed markdown subtree underneath is never torn down and rebuilt --
// only the CSS animation restarts. Throttled to avoid restarting on
// every single SSE delta (some models stream many per second, which
// would just read as flicker, not "gradual unfold").
const RETRIGGER_INTERVAL_MS = 180

export function StreamingBubble({
  isStreaming,
  children,
  className,
}: {
  isStreaming: boolean
  children: React.ReactNode
  className?: string
}) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const lastTriggerRef = useRef(0)

  useEffect(() => {
    if (!isStreaming) return
    const el = contentRef.current
    if (!el) return
    const now = Date.now()
    if (now - lastTriggerRef.current < RETRIGGER_INTERVAL_MS) return
    lastTriggerRef.current = now
    el.classList.remove('psy-unfold')
    void el.offsetWidth
    el.classList.add('psy-unfold')
  })

  return (
    <div
      className={cn(
        isStreaming && 'psy-stream-bubble rounded-xl border border-primary-300 bg-primary-100/40 px-4 py-3',
        className,
      )}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  )
}
