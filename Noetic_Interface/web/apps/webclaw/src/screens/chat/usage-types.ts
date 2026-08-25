export type UsageTotals = {
  totalTokens: number
  totalCost: number
}

export type UsageModelRow = {
  provider?: string
  model?: string
  count: number
  totals: UsageTotals
}

export type UsageResponse = {
  startDate?: string
  endDate?: string
  totals?: UsageTotals
  aggregates?: {
    byModel?: Array<UsageModelRow>
  }
  error?: string
}
