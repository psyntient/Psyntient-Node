'use client'

import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

// Fully-rounded pills are "signature Psyntient" per the branding spec —
// default every button to a pill; opt out per-instance with an explicit
// rounded-* override where a square/icon button genuinely needs it.
const buttonVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0] select-none duration-150',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3',
        lg: 'h-10 px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-md': 'size-10',
        'icon-xl': 'size-11 [&_svg]:size-5',
      },
      variant: {
        default:
          'bg-primary-950 text-primary-50 hover:bg-primary-900 shadow-sm outline outline-primary-900/10 shadow-2xs',
        secondary:
          'bg-primary-50 text-primary-950 hover:bg-primary-200 outline outline-primary-900/10 shadow-2xs',
        outline:
          'border-primary-200 bg-transparent text-primary-900 hover:bg-primary-50 shadow-2xs outline outline-primary-900/10',
        ghost: 'text-primary-900 hover:bg-primary-200 hover:text-primary-950',
        destructive: 'bg-red-600 text-primary-50 hover:bg-red-700 shadow-sm',
        // Psyntient gold CTA — reserve for the single primary action per
        // view (e.g. the composer send button). Everything else stays a
        // neutral ink/cream variant above.
        gold: 'bg-gradient-to-br from-gold-light via-gold to-gold-deep text-[#0C0A1D] shadow-[0_12px_32px_-14px_rgba(238,188,74,0.55)] hover:brightness-105 focus-visible:ring-gold',
      },
    },
  },
)

interface ButtonProps extends useRender.ComponentProps<'button'> {
  variant?: VariantProps<typeof buttonVariants>['variant']
  size?: VariantProps<typeof buttonVariants>['size']
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>['type'] =
    render ? undefined : 'button'

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    'data-slot': 'button',
    type: typeValue,
  }

  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(defaultProps, props),
    render,
  })
}

export { Button, buttonVariants }
