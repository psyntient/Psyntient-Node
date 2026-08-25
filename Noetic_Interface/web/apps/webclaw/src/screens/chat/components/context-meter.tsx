import { memo, useMemo } from 'react'
import { formatCostUsd, formatTokenCount } from '../format-usage'
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from '@/components/ui/preview-card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ContextMeterProps = {
  usedTokens?: number
  maxTokens?: number
  costUsd?: number
}

function ContextMeterComponent({
  usedTokens,
  maxTokens,
  costUsd,
}: ContextMeterProps) {
  const { percentage, usedLabel, leftPercentage } = useMemo(() => {
    if (
      typeof usedTokens !== 'number' ||
      typeof maxTokens !== 'number' ||
      maxTokens <= 0
    )
      return {
        percentage: 0,
        usedLabel: '',
        leftPercentage: 0,
      }
    const pct = Math.min((usedTokens / maxTokens) * 100, 100)
    return {
      percentage: pct,
      usedLabel: `${formatTokenCount(usedTokens)} / ${formatTokenCount(maxTokens)} tokens used`,
      leftPercentage: Math.max(0, 100 - pct),
    }
  }, [usedTokens, maxTokens])

  if (usedLabel.length === 0) return null

  return (
    <PreviewCard>
      <PreviewCardTrigger
        className={cn(
          buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
          'text-primary-800 hover:bg-primary-100',
        )}
      >
        <div className="size-4 text-primary-200">
          <svg
            viewBox="0 0 36 36"
            className="size-4 -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-primary-300"
            />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              className="text-primary-600"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${(percentage / 100) * 97.4} 97.4`}
            />
          </svg>
        </div>
      </PreviewCardTrigger>
      <PreviewCardPopup align="end" sideOffset={0} className="w-52 px-2 py-1">
        <div className="space-y-0.5 text-xs text-primary-900">
          <div className="text-primary-950 font-[450]">Context window:</div>
          <div className="tabular-nums text-primary-700">
            {percentage.toFixed(0)}% used ({leftPercentage.toFixed(0)}% left)
          </div>
          <div className="tabular-nums text-primary-700">{usedLabel}</div>
          {typeof costUsd === 'number' ? (
            <div className="tabular-nums text-primary-700">
              {formatCostUsd(costUsd)} estimated cost
            </div>
          ) : null}
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  )
}

export const ContextMeter = memo(ContextMeterComponent)
