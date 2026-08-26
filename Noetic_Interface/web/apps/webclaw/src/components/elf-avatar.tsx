import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type Frame = 'idle' | 'blink' | 'talk'
type FrameSize = 32 | 40 | 64 | 128 | 256

const FRAMES: Record<FrameSize, Record<Frame, string>> = {
  32: {
    idle: '/brand/elf/elf-chat-idle-32.png',
    blink: '/brand/elf/elf-chat-blink-32.png',
    talk: '/brand/elf/elf-chat-talk-32.png',
  },
  40: {
    idle: '/brand/elf/elf-chat-idle-40.png',
    blink: '/brand/elf/elf-chat-blink-40.png',
    talk: '/brand/elf/elf-chat-talk-40.png',
  },
  64: {
    idle: '/brand/elf/elf-chat-idle-64.png',
    blink: '/brand/elf/elf-chat-blink-64.png',
    talk: '/brand/elf/elf-chat-talk-64.png',
  },
  128: {
    idle: '/brand/elf/elf-chat-idle-128.png',
    blink: '/brand/elf/elf-chat-blink-128.png',
    talk: '/brand/elf/elf-chat-talk-128.png',
  },
  256: {
    idle: '/brand/elf/elf-chat-idle-256.png',
    blink: '/brand/elf/elf-chat-blink-256.png',
    talk: '/brand/elf/elf-chat-talk-256.png',
  },
}

// Four sparkle positions around the portrait, staggered so they twinkle
// independently rather than in lockstep -- reads as ambient magic dust, not
// a single pulsing ring. Kept off entirely unless actually speaking.
const SPARKLES = [
  { top: '-6%', left: '78%', delay: '0ms', duration: '1100ms' },
  { top: '68%', left: '-8%', delay: '260ms', duration: '1300ms' },
  { top: '4%', left: '4%', delay: '520ms', duration: '1000ms' },
  { top: '78%', left: '82%', delay: '380ms', duration: '1200ms' },
]

/**
 * The Cortex chat persona: idle/blink/talk frame-swapped portrait, with a
 * few gold sparkle particles while actively speaking. `speaking` is the only
 * behavioral input -- everything else (blink timing, reduced-motion) is
 * handled internally so every call site stays a one-liner.
 */
export function ElfAvatar({
  speaking = false,
  frameSize = 64,
  className,
  sparkle = true,
  alt = 'Cortex',
}: {
  speaking?: boolean
  frameSize?: FrameSize
  className?: string
  sparkle?: boolean
  alt?: string
}) {
  const frames = FRAMES[frameSize]
  const [frame, setFrame] = useState<Frame>('idle')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setFrame('idle')
      return
    }

    if (speaking) {
      let on = false
      const id = setInterval(() => {
        on = !on
        setFrame(on ? 'talk' : 'idle')
      }, 140) // ~7fps talk cycle
      return () => {
        clearInterval(id)
        setFrame('idle')
      }
    }

    let blinkTimer: ReturnType<typeof setTimeout>
    let closeTimer: ReturnType<typeof setTimeout>
    const scheduleBlink = () => {
      blinkTimer = setTimeout(
        () => {
          setFrame('blink')
          closeTimer = setTimeout(() => {
            setFrame('idle')
            scheduleBlink()
          }, 120)
        },
        4000 + Math.random() * 3000,
      )
    }
    scheduleBlink()
    return () => {
      clearTimeout(blinkTimer)
      clearTimeout(closeTimer)
    }
  }, [speaking])

  return (
    <span className="relative inline-block">
      <img
        src={frames[frame]}
        alt={alt}
        draggable={false}
        className={cn('block select-none', className)}
      />
      {sparkle && speaking && (
        <span className="pointer-events-none absolute inset-0" aria-hidden="true">
          {SPARKLES.map((s, i) => (
            <span
              key={i}
              className="absolute size-[3px] rounded-full bg-gold"
              style={{
                top: s.top,
                left: s.left,
                animation: `psy-sparkle-twinkle ${s.duration} ease-in-out infinite`,
                animationDelay: s.delay,
                boxShadow: '0 0 4px 1px var(--color-gold)',
              }}
            />
          ))}
        </span>
      )}
    </span>
  )
}
