import { Button } from '@/components/ui/button'

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <img
        src="/brand/psyntient-mark.png"
        alt=""
        className="size-20 animate-[psy-aura_7s_ease-in-out_infinite]"
      />
      <div className="space-y-3">
        <h1 className="font-serif text-5xl text-primary-950">
          Welcome to Psyntient Node
        </h1>
        <p className="max-w-md text-lg text-primary-600">
          Your own local, sovereign AI runtime. Everything here runs on your
          machine — your key, your Vault, your data.
        </p>
      </div>
      <Button variant="gold" size="lg" className="h-12 px-8 text-base" onClick={onNext}>
        Initialize Node →
      </Button>
    </div>
  )
}
