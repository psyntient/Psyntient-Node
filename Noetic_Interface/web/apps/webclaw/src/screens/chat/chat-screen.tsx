import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deriveFriendlyIdFromKey,
  isMissingGatewayAuth,
  isSessionNotFound,
  readError,
} from './utils'
import { createOptimisticMessage } from './chat-screen-utils'
import {
  appendHistoryMessage,
  chatQueryKeys,
  clearHistoryMessages,
  fetchGatewayStatus,
  removeHistoryMessageByClientId,
  updateHistoryMessageByClientId,
  updateSessionLastMessage,
} from './chat-queries'
import { chatUiQueryKey, getChatUiState, setChatUiState } from './chat-ui'
import { ChatSidebar } from './components/chat-sidebar'
import { ChatHeader } from './components/chat-header'
import { InstallBanner } from './components/install-banner'
import { ChatMessageList } from './components/chat-message-list'
import { ChatComposer } from './components/chat-composer'
import { GatewayStatusMessage } from './components/gateway-status-message'
import { SuggestionChips } from './components/suggestion-chips'
import { CapabilitiesDialog } from './components/capabilities-dialog'
import {
  hasPendingGeneration,
  hasPendingSend,
  isRecentSession,
  setPendingGeneration,
  setRecentSession,
  stashPendingSend,
} from './pending-send'
import { useChatMeasurements } from './hooks/use-chat-measurements'
import { useChatHistory } from './hooks/use-chat-history'
import { useChatMobile } from './hooks/use-chat-mobile'
import { useChatSessions } from './hooks/use-chat-sessions'
import { useChatStream } from './hooks/use-chat-stream'
import { useChatPendingSend } from './hooks/use-chat-pending-send'
import { shouldRedirectToConnect } from './hooks/use-chat-error-state'
import { useChatRedirect } from './hooks/use-chat-redirect'
import type { AttachmentFile } from '@/components/attachment-button'
import type { ChatComposerHelpers } from './components/chat-composer'
import { useExport } from '@/hooks/use-export'
import { ElfAvatar } from '@/components/elf-avatar'
import { useChatSettings } from '@/hooks/use-chat-settings'
import { cn, randomUUID } from '@/lib/utils'

type ChatScreenProps = {
  activeFriendlyId: string
  isNewChat?: boolean
  onSessionResolved?: (payload: {
    sessionKey: string
    friendlyId: string
  }) => void
  forcedSessionKey?: string
}

export function ChatScreen({
  activeFriendlyId,
  isNewChat = false,
  onSessionResolved,
  forcedSessionKey,
}: ChatScreenProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sending, setSending] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false)
  const { headerRef, composerRef, mainRef, pinGroupMinHeight, headerHeight } =
    useChatMeasurements()
  const [waitingForResponse, setWaitingForResponse] = useState(
    () => hasPendingSend() || hasPendingGeneration(),
  )
  const [pinToTop, setPinToTop] = useState(
    () => hasPendingSend() || hasPendingGeneration(),
  )
  const { settings } = useChatSettings()
  const pendingRunIdsRef = useRef(new Set<string>())
  const pendingRunTimersRef = useRef(new Map<string, number>())
  const { isMobile } = useChatMobile(queryClient)
  const {
    sessionsQuery,
    sessions,
    activeSession,
    activeExists,
    activeSessionKey,
    activeTitle,
    sessionsError,
  } = useChatSessions({ activeFriendlyId, isNewChat, forcedSessionKey })
  const {
    historyQuery,
    displayMessages,
    historyError,
    resolvedSessionKey,
    activeCanonicalKey,
    sessionKeyForHistory,
  } = useChatHistory({
    activeFriendlyId,
    activeSessionKey,
    forcedSessionKey,
    isNewChat,
    isRedirecting,
    activeExists,
    sessionsReady: sessionsQuery.isSuccess,
    queryClient,
  })

  const { exportConversation } = useExport({
    currentFriendlyId: activeFriendlyId,
    currentSessionKey: sessionKeyForHistory,
    sessionTitle: activeTitle,
  })

  const uiQuery = useQuery({
    queryKey: chatUiQueryKey,
    queryFn: function readUiState() {
      return getChatUiState(queryClient)
    },
    initialData: function initialUiState() {
      return getChatUiState(queryClient)
    },
    staleTime: Infinity,
  })
  const gatewayStatusQuery = useQuery({
    queryKey: ['gateway', 'status'],
    queryFn: fetchGatewayStatus,
    // Self-healing: fetchGatewayStatus aborts at 2.5s, so any transient blip
    // (a gateway restart, a slow first probe) used to latch "OpenClaw gateway
    // is unreachable" permanently -- retry:false plus no refetch on focus or
    // reconnect meant nothing ever re-checked, and even the visible "Retry"
    // button did not clear it. Reproduced live: /api/ping returned {"ok":true}
    // and 18 sessions listed while the UI still showed the error banner.
    // One retry absorbs the common single-blip case; focus/reconnect refetch
    // recovers when the user returns to the tab or the network comes back;
    // the error-only 10s poll heals an unattended tab without adding any
    // steady-state polling once the gateway is healthy again.
    retry: 1,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.error || query.state.data?.ok === false ? 10000 : false,
  })
  const gatewayStatusMountRef = useRef(Date.now())
  const gatewayStatusError =
    gatewayStatusQuery.error instanceof Error
      ? gatewayStatusQuery.error.message
      : gatewayStatusQuery.data && !gatewayStatusQuery.data.ok
        ? gatewayStatusQuery.data.error || 'Gateway unavailable'
        : null
  const gatewayError = gatewayStatusError ?? sessionsError ?? historyError
  const handleGatewayRefetch = useCallback(() => {
    void gatewayStatusQuery.refetch()
  }, [gatewayStatusQuery])
  const isSidebarCollapsed = uiQuery.data.isSidebarCollapsed
  const handleActiveSessionDelete = useCallback(() => {
    setIsRedirecting(true)
    navigate({ to: '/new', replace: true })
  }, [navigate])
  const stableContentStyle = useMemo<React.CSSProperties>(() => ({}), [])
  const missingSessionError =
    isSessionNotFound(historyError ?? '') ||
    isSessionNotFound(sessionsError ?? '')

  const shouldRedirectToNew =
    !isNewChat &&
    !forcedSessionKey &&
    !isRecentSession(activeFriendlyId) &&
    sessionsQuery.isSuccess &&
    !sessions.some((session) => session.friendlyId === activeFriendlyId) &&
    (missingSessionError || (!historyQuery.isFetching && !historyQuery.isSuccess))

  const refreshHistory = useCallback(() => {
    void historyQuery.refetch()
  }, [historyQuery])

  // Explicit, first-party belt-and-suspenders: react-query's own default
  // refetchOnWindowFocus (query-core's focusManager, itself a
  // visibilitychange listener) already covers "switch tabs away and back
  // refetches history," which is why that workaround has appeared to fix a
  // stuck reply in the past. But that's an implicit dependency-default
  // behavior nobody documented here -- someone could disable it globally
  // later without realizing it was load-bearing for this bug. Wiring our
  // own listener makes the recovery path explicit and independent of that
  // default ever changing.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshHistory()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refreshHistory])

  // Mirrors this thread's transcript into
  // Working_Memory/chat_context/<friendlyId>/ (Phase I). Best-effort — the
  // Gateway's own session store stays ground truth, so a failed sync just
  // leaves the mirror stale until the next successful one, not data loss.
  const syncWorkingMemory = useCallback(() => {
    if (!activeFriendlyId) return
    void fetch('/api/working-memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        friendlyId: activeFriendlyId,
        sessionKey: resolvedSessionKey,
      }),
    }).catch(() => {})
  }, [activeFriendlyId, resolvedSessionKey])

  // Triggered by displayMessages itself rather than the stream's
  // 'final'/'chat.history' events directly: this app has more than one
  // path that ends up updating historyQuery's cache (direct sendMessage
  // refreshes, the known EventSource-reconnect-race safety net, possibly
  // others), and displayMessages is what all of them funnel into. Only
  // fires once a turn is no longer in flight (not on every streaming
  // delta), and only after the content reference has actually changed.
  const lastSyncedMessagesRef = useRef<unknown>(null)
  useEffect(() => {
    if (waitingForResponse) return
    if (!activeFriendlyId) return
    if (displayMessages.length === 0) return
    if (lastSyncedMessagesRef.current === displayMessages) return
    lastSyncedMessagesRef.current = displayMessages
    syncWorkingMemory()
  }, [displayMessages, waitingForResponse, activeFriendlyId, syncWorkingMemory])

  // Backstop: the effect above can miss a turn if historyQuery's cache
  // settles into a state React doesn't consider "changed" (observed in
  // testing — this app's live-update plumbing has more than one path,
  // documented as unreliable in CLAUDE.md's known-issues section, and
  // this mirror shouldn't inherit that fragility). Polling every 20s
  // while idle guarantees the mirror converges even if the reactive path
  // is missed, without depending on which internal event mechanism
  // WebClaw actually used to update the screen.
  useEffect(() => {
    if (!activeFriendlyId) return
    const interval = window.setInterval(() => {
      if (waitingForResponse) return
      syncWorkingMemory()
    }, 20000)
    return () => window.clearInterval(interval)
  }, [activeFriendlyId, waitingForResponse, syncWorkingMemory])

  const hideUi = shouldRedirectToNew || isRedirecting

  const finishRun = useCallback(
    (runId: string) => {
      if (!runId) return
      const timer = pendingRunTimersRef.current.get(runId)
      if (typeof timer === 'number') {
        window.clearTimeout(timer)
      }
      pendingRunTimersRef.current.delete(runId)
      pendingRunIdsRef.current.delete(runId)
      if (pendingRunIdsRef.current.size === 0) {
        setPendingGeneration(false)
        setWaitingForResponse(false)
      }
    },
    [setWaitingForResponse],
  )

  const startRun = useCallback(
    (runId: string) => {
      if (!runId) return
      pendingRunIdsRef.current.add(runId)
      const existingTimer = pendingRunTimersRef.current.get(runId)
      if (typeof existingTimer === 'number') {
        window.clearTimeout(existingTimer)
      }
      // Safety-net recovery for the known EventSource reconnect race (see
      // CLAUDE.md "Known issue: live stream display can stick on
      // Generating...") — if the live 'final' event for this run never
      // arrives, force a history refetch so the UI self-heals instead of
      // requiring a manual reload. Resets on every 'delta', so this only
      // fires after a real gap in activity, not during a normal
      // multi-second generation. 120s was long enough that the app looked
      // permanently broken before this fired; 15s recovers quickly while
      // still tolerating a slow tool call or thinking pause.
      const timeout = window.setTimeout(() => {
        pendingRunTimersRef.current.delete(runId)
        pendingRunIdsRef.current.delete(runId)
        refreshHistory()
        if (pendingRunIdsRef.current.size === 0) {
          setPendingGeneration(false)
          setWaitingForResponse(false)
        }
      }, 15000)
      pendingRunTimersRef.current.set(runId, timeout)
      setPendingGeneration(true)
      setWaitingForResponse(true)
    },
    [refreshHistory],
  )

  const finishAllRuns = useCallback(() => {
    for (const [, timer] of pendingRunTimersRef.current) {
      window.clearTimeout(timer)
    }
    pendingRunTimersRef.current.clear()
    pendingRunIdsRef.current.clear()
    setPendingGeneration(false)
    setWaitingForResponse(false)
  }, [])

  useEffect(() => {
    return () => {
      finishAllRuns()
    }
  }, [finishAllRuns])

  function sendMessage(
    sessionKey: string,
    friendlyId: string,
    body: string,
    skipOptimistic = false,
    attachments?: Array<AttachmentFile>,
  ) {
    let optimisticClientId = ''
    if (!skipOptimistic) {
      const { clientId, optimisticMessage } = createOptimisticMessage(
        body,
        attachments,
      )
      optimisticClientId = clientId
      appendHistoryMessage(
        queryClient,
        friendlyId,
        sessionKey,
        optimisticMessage,
      )
      updateSessionLastMessage(
        queryClient,
        sessionKey,
        friendlyId,
        optimisticMessage,
      )
    }

    setPendingGeneration(true)
    setSending(true)
    setWaitingForResponse(true)
    setPinToTop(true)

    const attachmentsPayload = attachments?.map((a) => ({
      mimeType: a.file.type,
      content: a.base64,
    }))

    const idempotencyKey = randomUUID()

    fetch('/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionKey,
        friendlyId,
        message: body,
        thinking: settings.thinkingLevel,
        idempotencyKey,
        attachments: attachmentsPayload,
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res))
        const payload = (await res.json().catch(() => ({}))) as {
          runId?: string
        }
        // Always arm the safety net, even if the server response is missing
        // a runId (unexpected shape, edge-case error path, etc.) -- falling
        // back to the idempotencyKey we already generated. Previously this
        // only armed when payload.runId was present, so that gap left
        // waitingForResponse=true with no per-run timer at all and no
        // rescue -- a real user report of a reply never appearing traced
        // back to exactly this.
        const runId =
          typeof payload.runId === 'string' && payload.runId.trim().length > 0
            ? payload.runId.trim()
            : idempotencyKey
        startRun(runId)
        refreshHistory()
      })
      .catch((err) => {
        const messageText = err instanceof Error ? err.message : String(err)
        if (isMissingGatewayAuth(messageText)) {
          navigate({ to: '/connect', replace: true })
          return
        }
        if (optimisticClientId) {
          updateHistoryMessageByClientId(
            queryClient,
            friendlyId,
            sessionKey,
            optimisticClientId,
            function markFailed(message) {
              return { ...message, status: 'error' }
            },
          )
        }
        setPendingGeneration(false)
        setWaitingForResponse(false)
        setPinToTop(false)
      })
      .finally(() => {
        setSending(false)
      })
  }

  const createSessionForMessage = useCallback(async () => {
    setCreatingSession(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await readError(res))

      const data = (await res.json()) as {
        sessionKey?: string
        friendlyId?: string
      }

      const sessionKey =
        typeof data.sessionKey === 'string' ? data.sessionKey : ''
      const friendlyId =
        typeof data.friendlyId === 'string' && data.friendlyId.trim().length > 0
          ? data.friendlyId.trim()
          : deriveFriendlyIdFromKey(sessionKey)

      if (!sessionKey || !friendlyId) {
        throw new Error('Invalid session response')
      }

      queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
      return { sessionKey, friendlyId }
    } finally {
      setCreatingSession(false)
    }
  }, [queryClient])

  const send = useCallback(
    (body: string, helpers: ChatComposerHelpers) => {
      const attachments = helpers.attachments
      if (body.length === 0 && (!attachments || attachments.length === 0))
        return
      helpers.reset()

      if (isNewChat) {
        const { clientId, optimisticId, optimisticMessage } =
          createOptimisticMessage(body, attachments)
        appendHistoryMessage(queryClient, 'new', 'new', optimisticMessage)
        setPendingGeneration(true)
        setSending(true)
        setWaitingForResponse(true)
        setPinToTop(true)

        createSessionForMessage()
          .then(({ sessionKey, friendlyId }) => {
            setRecentSession(friendlyId)
            stashPendingSend({
              sessionKey,
              friendlyId,
              message: body,
              optimisticMessage,
              attachments,
            })
            if (onSessionResolved) {
              onSessionResolved({ sessionKey, friendlyId })
              return
            }
            navigate({
              to: '/chat/$sessionKey',
              params: { sessionKey: friendlyId },
              replace: true,
            })
          })
          .catch(() => {
            removeHistoryMessageByClientId(
              queryClient,
              'new',
              'new',
              clientId,
              optimisticId,
            )
            helpers.setValue(body)
            setPendingGeneration(false)
            setWaitingForResponse(false)
            setPinToTop(false)
            setSending(false)
          })
        return
      }

      const sessionKeyForSend =
        forcedSessionKey ||
        resolvedSessionKey ||
        activeSessionKey ||
        activeFriendlyId
      sendMessage(sessionKeyForSend, activeFriendlyId, body, false, attachments)
    },
    [
      activeFriendlyId,
      activeSessionKey,
      createSessionForMessage,
      forcedSessionKey,
      isNewChat,
      navigate,
      onSessionResolved,
      queryClient,
      resolvedSessionKey,
      settings.thinkingLevel,
    ],
  )

  // For suggestion chips: sends a canned prompt through the same path as a
  // real composer submission, with no-op helpers since there's no actual
  // composer input to reset/clear.
  const sendPrompt = useCallback(
    (text: string) => send(text, { reset: () => {}, setValue: () => {} }),
    [send],
  )

  const startNewChat = useCallback(() => {
    setWaitingForResponse(false)
    setPinToTop(false)
    clearHistoryMessages(queryClient, 'new', 'new')
    navigate({ to: '/new' })
    if (isMobile) {
      setChatUiState(queryClient, function collapse(state) {
        return { ...state, isSidebarCollapsed: true }
      })
    }
  }, [isMobile, navigate, queryClient])

  const handleToggleSidebarCollapse = useCallback(() => {
    setChatUiState(queryClient, function toggle(state) {
      return { ...state, isSidebarCollapsed: !state.isSidebarCollapsed }
    })
  }, [queryClient])

  const handleSelectSession = useCallback(() => {
    if (!isMobile) return
    setChatUiState(queryClient, function collapse(state) {
      return { ...state, isSidebarCollapsed: true }
    })
  }, [isMobile, queryClient])

  const handleOpenSidebar = useCallback(() => {
    setChatUiState(queryClient, function open(state) {
      return { ...state, isSidebarCollapsed: false }
    })
  }, [queryClient])

  const historyLoading = historyQuery.isLoading || isRedirecting
  const showGatewayDown = Boolean(gatewayStatusError)
  const showGatewayNotice =
    showGatewayDown &&
    gatewayStatusQuery.errorUpdatedAt > gatewayStatusMountRef.current
  const redirectToConnect = shouldRedirectToConnect({
    isRedirecting,
    shouldRedirectToNew,
    sessionsReady: sessionsQuery.isSuccess,
    activeExists,
    sessionsError,
    historyError,
    gatewayStatusError,
  })
  const historyEmpty = !historyLoading && displayMessages.length === 0
  const gatewayNotice = useMemo(() => {
    if (!showGatewayNotice) return null
    if (!gatewayError) return null
    return (
      <GatewayStatusMessage
        state="error"
        error={gatewayError}
        onRetry={handleGatewayRefetch}
      />
    )
  }, [gatewayError, handleGatewayRefetch, showGatewayNotice])

  useChatStream({
    activeFriendlyId,
    isNewChat,
    isRedirecting,
    resolvedSessionKey,
    sessionKeyForHistory,
    queryClient,
    refreshHistory,
    onChatEvent(payload) {
       
      console.log('[wm-debug] onChatEvent', payload.state, payload.sessionKey, resolvedSessionKey, sessionKeyForHistory)
      const payloadSessionKey =
        typeof payload.sessionKey === 'string' ? payload.sessionKey : ''
      if (
        payloadSessionKey &&
        resolvedSessionKey &&
        payloadSessionKey !== resolvedSessionKey &&
        payloadSessionKey !== sessionKeyForHistory
      ) {
        return
      }
      const runId = typeof payload.runId === 'string' ? payload.runId : ''
      const state = typeof payload.state === 'string' ? payload.state : ''
      if (runId && state === 'delta') {
        startRun(runId)
      }
      if (
        runId &&
        (state === 'final' || state === 'error' || state === 'aborted')
      ) {
        finishRun(runId)
      }
      if (
        !runId &&
        (state === 'final' || state === 'error' || state === 'aborted')
      ) {
        finishAllRuns()
      }
    },
  })

  useChatRedirect({
    activeFriendlyId,
    isNewChat,
    isRedirecting,
    shouldRedirectToNew,
    sessionsReady: sessionsQuery.isSuccess,
    sessionKeyForHistory,
    queryClient,
    setIsRedirecting,
  })

  useChatPendingSend({
    activeFriendlyId,
    activeSessionKey,
    forcedSessionKey,
    isNewChat,
    queryClient,
    resolvedSessionKey,
    setWaitingForResponse,
    setPinToTop,
    sendMessage,
  })

  const sidebar = (
    <ChatSidebar
      sessions={sessions}
      activeFriendlyId={activeFriendlyId}
      creatingSession={creatingSession}
      onCreateSession={startNewChat}
      isCollapsed={isMobile ? false : isSidebarCollapsed}
      onToggleCollapse={handleToggleSidebarCollapse}
      onSelectSession={handleSelectSession}
      onActiveSessionDelete={handleActiveSessionDelete}
      onOpenCapabilities={() => setCapabilitiesOpen(true)}
    />
  )

  if (redirectToConnect) {
    return <Navigate to="/connect" replace />
  }

  return (
    <div className="h-screen bg-surface text-primary-900">
      <div
        className={cn(
          'h-full overflow-hidden',
          isMobile ? 'relative' : 'grid grid-cols-[auto_1fr]',
        )}
      >
        {hideUi ? null : isMobile ? (
          <>
            <div
              className={cn(
                'fixed inset-y-0 left-0 z-50 w-[300px] transition-transform duration-200',
                isSidebarCollapsed ? '-translate-x-full' : 'translate-x-0',
              )}
            >
              {sidebar}
            </div>
          </>
        ) : (
          sidebar
        )}

        <main className="flex flex-col h-full min-h-0" ref={mainRef}>
          <ChatHeader
            activeTitle={activeTitle}
            wrapperRef={headerRef}
            showSidebarButton={isMobile}
            onOpenSidebar={handleOpenSidebar}
            onExport={exportConversation}
            exportDisabled={historyLoading || displayMessages.length === 0}
            showExport={!isNewChat}
            usedTokens={activeSession?.totalTokens}
            maxTokens={activeSession?.contextTokens}
            costUsd={activeSession?.estimatedCostUsd}
          />
          <InstallBanner />

          {hideUi ? null : (
            <>
              <ChatMessageList
                messages={displayMessages}
                loading={historyLoading}
                empty={historyEmpty}
                notice={gatewayNotice}
                noticePosition="end"
                waitingForResponse={waitingForResponse}
                sessionKey={activeCanonicalKey}
                pinToTop={pinToTop}
                pinGroupMinHeight={pinGroupMinHeight}
                headerHeight={headerHeight}
                contentStyle={stableContentStyle}
                emptyState={
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <ElfAvatar
                      speaking={false}
                      sparkle={false}
                      frameSize={128}
                      alt=""
                      className="h-24 w-24 rounded-full"
                    />
                    <p className="font-serif text-xl text-primary-950">
                      What are we exploring today?
                    </p>
                    <p className="text-sm text-primary-600">
                      Ask Cortex anything — it remembers as you go.
                    </p>
                    <SuggestionChips
                      onSend={sendPrompt}
                      onOpenCapabilities={() => setCapabilitiesOpen(true)}
                    />
                  </div>
                }
              />
              <ChatComposer
                onSubmit={send}
                isLoading={sending}
                disabled={sending}
                wrapperRef={composerRef}
                model={activeSession?.model}
                usedTokens={activeSession?.totalTokens}
                costUsd={activeSession?.estimatedCostUsd}
              />
            </>
          )}
        </main>
      </div>
      <CapabilitiesDialog
        open={capabilitiesOpen}
        onOpenChange={setCapabilitiesOpen}
      />
    </div>
  )
}
