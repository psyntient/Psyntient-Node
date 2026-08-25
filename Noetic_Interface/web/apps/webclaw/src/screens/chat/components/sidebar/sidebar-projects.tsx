'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export type ProjectMeta = {
  projectId: string
  title: string
  createdAt: string | null
  lastSyncedAt: string | null
}

async function fetchProjects(): Promise<Array<ProjectMeta>> {
  const res = await fetch('/api/projects')
  if (!res.ok) return []
  const body = (await res.json()) as { ok: boolean; projects?: Array<ProjectMeta> }
  return body.ok && body.projects ? body.projects : []
}

type SidebarProjectsProps = {
  onOpenProject: (projectId: string) => void
}

// Vault-backed research projects (daemon/working-memory.mjs's
// cortex_projects lifecycle) -- created by the research-agent skill during
// a conversation, not through this UI, so this section is read-only: no
// pin/rename/delete controls, since there's no backend support for
// UI-driven project mutation to back them with.
export const SidebarProjects = memo(function SidebarProjects({
  onOpenProject,
}: SidebarProjectsProps) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    // Projects appear out-of-band (the agent creates them mid-conversation,
    // not through this sidebar), so poll rather than only fetching once --
    // matches Working_Memory's existing 20s idle-poll convention
    // (CLAUDE.md SS9) so a new project shows up without a manual reload.
    refetchInterval: 20000,
  })

  return (
    <Collapsible className="flex flex-col w-full shrink-0" defaultOpen>
      <CollapsibleTrigger className="w-fit pl-1.5 shrink-0 ml-2">
        Projects
        <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-3 transition-transform duration-150 group-data-panel-open:rotate-90"
          />
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel
        className="w-full h-auto data-starting-style:h-0 data-ending-style:h-0"
        contentClassName="flex flex-col max-h-40"
      >
        {projects.length === 0 ? (
          <p className="px-3.5 py-2 text-xs text-primary-500">
            No projects yet. Ask Cortex to start a research project.
          </p>
        ) : (
          <ScrollAreaRoot className="flex-1 min-h-0">
            <ScrollAreaViewport className="min-h-0">
              <div className="flex flex-col gap-px pl-2 pr-2">
                {projects.map((project) => (
                  <button
                    key={project.projectId}
                    type="button"
                    onClick={() => onOpenProject(project.projectId)}
                    className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm text-primary-800 hover:bg-primary-200/60"
                  >
                    <span className="relative inline-flex size-2 shrink-0 items-center justify-center">
                      <span
                        className={cn(
                          'absolute inline-flex size-2 rounded-full bg-gold',
                          project.lastSyncedAt &&
                            'animate-[psy-aura_7s_ease-in-out_infinite]',
                        )}
                        aria-hidden="true"
                      />
                      <span
                        className="relative inline-flex size-1 rounded-full bg-gold"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="truncate">{project.title}</span>
                  </button>
                ))}
              </div>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical">
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollAreaRoot>
        )}
      </CollapsiblePanel>
    </Collapsible>
  )
})
