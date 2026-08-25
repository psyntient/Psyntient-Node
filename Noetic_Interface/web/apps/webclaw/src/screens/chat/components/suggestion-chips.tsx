import { cn } from '@/lib/utils'

// 4 chips send a real message -- each maps to a genuinely built capability
// (research-agent skill, semantic memory search, Vault read, baseline chat),
// cross-checked against Cortex_Agent/CAPABILITIES.md so nothing aspirational
// is suggested. "Start a research project" deliberately echoes the
// research-agent skill's own documented trigger phrase. The 5th chip opens
// the capability panel instead of sending -- "what can you do" is a
// discovery action, not a task; sending it as a chat message would just make
// the LLM paraphrase this same content unreliably.
const CHIPS: Array<
  | { kind: 'send'; label: string; prompt: string }
  | { kind: 'open'; label: string }
> = [
  {
    kind: 'send',
    label: 'Start a research project',
    prompt: "I'd like to start a new research project. Can you help me plan it?",
  },
  {
    kind: 'send',
    label: 'Search what we’ve discussed before',
    prompt: 'Search our past conversations for anything relevant.',
  },
  {
    kind: 'send',
    label: 'Look at what’s in my Vault',
    prompt: "What's currently in my Vault?",
  },
  {
    kind: 'send',
    label: 'Just think something through',
    prompt: 'I want to think out loud about something — no project needed yet.',
  },
  { kind: 'open', label: 'What can Cortex do?' },
]

type SuggestionChipsProps = {
  onSend: (prompt: string) => void
  onOpenCapabilities: () => void
}

export function SuggestionChips({
  onSend,
  onOpenCapabilities,
}: SuggestionChipsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {CHIPS.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={
            chip.kind === 'send' ? () => onSend(chip.prompt) : onOpenCapabilities
          }
          className={cn(
            'rounded-full border border-primary-400 bg-transparent px-4 py-2',
            'text-sm text-primary-700 transition-colors duration-150',
            'hover:border-gold hover:bg-primary-100 hover:text-gold-light',
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
