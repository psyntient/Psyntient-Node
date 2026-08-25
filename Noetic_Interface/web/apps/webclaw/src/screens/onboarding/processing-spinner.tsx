import { cn } from '@/lib/utils'

// The Psyntient mark is already a Flower-of-Life / Seed-of-Life sacred
// geometry pattern -- spinning it slowly during real wait states (not a
// fast mechanical spinner) reads as "processing" while staying on-brand,
// no new asset needed. Linear/continuous, unlike psy-aura's pulse --
// this is meant to communicate "actively working," not ambient presence.
export function ProcessingSpinner({ size = 'size-12' }: { size?: string }) {
  return (
    <img
      src="/brand/psyntient-mark.png"
      alt=""
      className={cn(size, 'animate-spin [animation-duration:5s]')}
    />
  )
}
