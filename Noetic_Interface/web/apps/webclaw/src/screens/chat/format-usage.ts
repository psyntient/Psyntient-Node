export function formatTokenCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n)
}

// Raw model ids are "provider/vendor-model-version" refs (e.g.
// "google/gemini-3.7-flash"), not display names. Mechanical transform
// instead of a models.list catalog lookup -- see plan notes: avoids a
// second data dependency/loading state for a label that's already legible
// after stripping the provider prefix and title-casing.
export function formatModelName(raw?: string): string {
  if (!raw) return ''
  const withoutProvider = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw
  return withoutProvider
    .split(/[-_]/)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

export function formatCostUsd(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}
