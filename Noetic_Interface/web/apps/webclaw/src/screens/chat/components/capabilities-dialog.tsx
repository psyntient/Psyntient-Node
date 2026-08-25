import { HugeiconsIcon } from '@hugeicons/react'
import {
  Brain02Icon,
  Cancel01Icon,
  HardDriveIcon,
  Message01Icon,
  MicroscopeIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Hand-authored, not generated from Cortex_Agent/CAPABILITIES.md (that file
// is written for the agent to consult mid-conversation -- CLI syntax, file
// paths -- not plain-language for a non-technical researcher). Kept
// consistent with it by fact-checking at write time: nothing below claims a
// capability listed under CAPABILITIES.md's "Explicitly NOT Available"
// section (Noetic Archive, Observation Packets, Node API, entitlement
// tiers, multi-device sync).
const CATEGORIES: Array<{
  icon: IconSvgElement
  title: string
  body: string
}> = [
  {
    icon: Message01Icon,
    title: 'Chat & conversation',
    body: 'Ask anything, anytime. Cortex answers as a capable research assistant — no special phrasing required.',
  },
  {
    icon: Brain02Icon,
    title: 'Memory',
    body: "Cortex remembers what you've discussed and searches past sessions by meaning, not just keywords, before it answers.",
  },
  {
    icon: MicroscopeIcon,
    title: 'Research Agent',
    body: 'Say the word and Cortex plans a study, follows your own research protocols, and works through your Vault data with you.',
  },
  {
    icon: HardDriveIcon,
    title: 'Vault & storage',
    body: 'Your data stays on this machine. Cortex reads and writes to your local Vault directly — nothing leaves without you.',
  },
]

type CapabilitiesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CapabilitiesDialog({
  open,
  onOpenChange,
}: CapabilitiesDialogProps) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,92vw)] max-h-[80vh] overflow-auto">
        <div className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="mb-1">What can Cortex do?</DialogTitle>
              <DialogDescription className="hidden">
                An overview of Cortex's real, built capabilities
              </DialogDescription>
            </div>
            <DialogClose
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-primary-500 hover:bg-primary-100 hover:text-primary-700"
                  aria-label="Close"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={20}
                    strokeWidth={1.5}
                  />
                </Button>
              }
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CATEGORIES.map((category) => (
              <div
                key={category.title}
                className="rounded-2xl border border-primary-200 bg-primary-100/60 p-4"
              >
                <div className="flex size-9 items-center justify-center rounded-full bg-primary-200 text-gold-light">
                  <HugeiconsIcon
                    icon={category.icon}
                    size={18}
                    strokeWidth={1.5}
                  />
                </div>
                <div className="mt-2 text-sm font-medium text-primary-900">
                  {category.title}
                </div>
                <div className="mt-1 text-xs text-primary-600">
                  {category.body}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-primary-500">
            More is on the way — shared archives, multi-device sync, and
            structured data capture aren't built yet.
          </p>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
