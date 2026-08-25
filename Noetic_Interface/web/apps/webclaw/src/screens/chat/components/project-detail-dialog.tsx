import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/prompt-kit/markdown'

type ProjectDetail = {
  projectId: string
  title: string
  createdAt: string | null
  lastSyncedAt: string | null
  notes: string
  modality?: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return 'unknown'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

type ProjectDetailDialogProps = {
  projectId: string | null
  onOpenChange: (open: boolean) => void
}

// Read-only viewer for a Vault-backed research project -- there's no
// UI-driven edit/rename here, matching sidebar-projects.tsx's read-only
// scope (project mutation is a research-agent-skill action, not a form).
export function ProjectDetailDialog({
  projectId,
  onOpenChange,
}: ProjectDetailDialogProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setDetail(null)
      return
    }
    setLoading(true)
    fetch(`/api/projects?id=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; project?: ProjectDetail }) => {
        setDetail(data.ok && data.project ? data.project : null)
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }, [projectId])

  return (
    <DialogRoot
      open={Boolean(projectId)}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="w-[min(560px,92vw)] max-h-[80vh] overflow-auto">
        <div className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="mb-1">
                {detail?.title || projectId || 'Project'}
              </DialogTitle>
              <DialogDescription className="hidden">
                Project details and notes
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

          {loading ? (
            <p className="mt-4 text-sm text-primary-500">Loading…</p>
          ) : !detail ? (
            <p className="mt-4 text-sm text-primary-500">
              Couldn't load this project.
            </p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-primary-500">
                <span>Created {formatDate(detail.createdAt)}</span>
                <span>
                  {detail.lastSyncedAt
                    ? `Synced to Vault ${formatDate(detail.lastSyncedAt)}`
                    : 'Not yet synced to Vault'}
                </span>
                {detail.modality ? <span>{detail.modality}</span> : null}
              </div>
              <div className="mt-4 border-t border-primary-200 pt-4">
                {detail.notes.trim() ? (
                  <Markdown className="text-sm text-primary-900">
                    {detail.notes}
                  </Markdown>
                ) : (
                  <p className="text-sm text-primary-500">No notes yet.</p>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
