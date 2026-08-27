import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

import { chatQueryKeys, fetchHistory } from '../chat-queries'
import { getMessageTimestamp, textFromMessage } from '../utils'
import type { QueryClient } from '@tanstack/react-query'
import type { GatewayMessage, HistoryResponse } from '../types'

type UseChatHistoryInput = {
  activeFriendlyId: string
  activeSessionKey: string
  forcedSessionKey?: string
  isNewChat: boolean
  isRedirecting: boolean
  activeExists: boolean
  sessionsReady: boolean
  queryClient: QueryClient
}

export function useChatHistory({
  activeFriendlyId,
  activeSessionKey,
  forcedSessionKey,
  isNewChat,
  isRedirecting,
  activeExists,
  sessionsReady,
  queryClient,
}: UseChatHistoryInput) {
  const sessionKeyForHistory = forcedSessionKey || activeSessionKey || ''
  const historyKey = chatQueryKeys.history(
    activeFriendlyId,
    sessionKeyForHistory,
  )
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: async function fetchHistoryForSession() {
      const cached = queryClient.getQueryData<HistoryResponse>(historyKey)
      const cachedMessages = Array.isArray(cached?.messages)
        ? cached.messages
        : []
      const optimisticMessages = cachedMessages.filter((message) => {
        if (message.status === 'sending') return true
        if (message.__optimisticId) return true
        return Boolean(message.clientId)
      })
      const streamingMessages = cachedMessages.filter((message) => {
        const runId = (message as { __streamRunId?: unknown }).__streamRunId
        return typeof runId === 'string' && runId.trim().length > 0
      })

      const serverData = await fetchHistory({
        sessionKey: sessionKeyForHistory,
        friendlyId: activeFriendlyId,
      })
      if (!optimisticMessages.length && !streamingMessages.length) {
        return serverData
      }

      const mergedWithOptimistic = mergeOptimisticHistoryMessages(
        serverData.messages,
        optimisticMessages,
      )
      const merged = mergeStreamingHistoryMessages(
        mergedWithOptimistic,
        streamingMessages,
      )

      return {
        ...serverData,
        messages: merged,
      }
    },
    enabled:
      !isNewChat &&
      Boolean(activeFriendlyId) &&
      !isRedirecting &&
      (!sessionsReady || activeExists),
    retry: false,
    placeholderData: function useCachedHistory(): HistoryResponse | undefined {
      return queryClient.getQueryData(historyKey)
    },
    gcTime: 1000 * 60 * 10,
  })

  const stableHistorySignatureRef = useRef('')
  const stableHistoryMessagesRef = useRef<Array<GatewayMessage>>([])
  const historyMessages = useMemo(() => {
    const rawMessages = Array.isArray(historyQuery.data?.messages)
      ? historyQuery.data.messages
      : []
    // Hide superseded failed attempts.
    //
    // When the provider 429s, OpenClaw retries internally and persists EVERY
    // failed attempt as its own assistant turn. A single question produced
    // four "The agent run failed before producing a reply." bubbles followed
    // by the real answer -- the retry worked, but the user watched it fail
    // four times. Drop a failed attempt only when a later assistant message
    // actually succeeded, so a genuinely failed turn still surfaces its
    // error rather than rendering as silence.
    const lastRealAssistant = (() => {
      for (let i = rawMessages.length - 1; i >= 0; i -= 1) {
        const m = rawMessages[i]
        if (m.role !== 'assistant') continue
        if (!isFailedAttemptMessage(m)) return i
      }
      return -1
    })()
    const messages =
      lastRealAssistant === -1
        ? rawMessages
        : rawMessages.filter(
            (m, i) => !(i < lastRealAssistant && isFailedAttemptMessage(m)),
          )
    const last = messages.at(-1)
    const lastId = typeof last?.id === 'string' ? last.id : ''
    const lastRole = typeof last?.role === 'string' ? last.role : ''
    const lastText = last ? textFromMessage(last) : ''
    const lastContentSignature = last ? contentSignatureFromMessage(last) : ''
    const signature = `${messages.length}:${lastRole}:${lastId}:${lastText.slice(-32)}:${lastContentSignature}`
    if (signature === stableHistorySignatureRef.current) {
      return stableHistoryMessagesRef.current
    }
    stableHistorySignatureRef.current = signature
    stableHistoryMessagesRef.current = messages
    return messages
  }, [historyQuery.data?.messages])

  const historyError =
    historyQuery.error instanceof Error ? historyQuery.error.message : null
  const resolvedSessionKey = useMemo(() => {
    if (forcedSessionKey) return forcedSessionKey
    const key = historyQuery.data?.sessionKey
    if (typeof key === 'string' && key.trim().length > 0) return key.trim()
    return activeSessionKey
  }, [activeSessionKey, forcedSessionKey, historyQuery.data?.sessionKey])
  const activeCanonicalKey = isNewChat
    ? 'new'
    : resolvedSessionKey || activeFriendlyId

  return {
    historyQuery,
    historyMessages,
    displayMessages: historyMessages,
    historyError,
    resolvedSessionKey,
    activeCanonicalKey,
    sessionKeyForHistory,
  }
}

function contentSignatureFromMessage(message: GatewayMessage): string {
  const content = Array.isArray(message.content) ? message.content : []
  return content
    .map((part) => {
      if (part.type === 'text') {
        return `text:${String(part.text ?? '').length}`
      }
      if (part.type === 'thinking') {
        return `thinking:${String(part.thinking ?? '').length}`
      }
      const id = 'id' in part ? String(part.id ?? '') : ''
      const name = 'name' in part ? String(part.name ?? '') : ''
      const partialJson = 'partialJson' in part ? String(part.partialJson ?? '') : ''
      return `toolCall:${id}:${name}:${partialJson.length}`
    })
    .join('|')
}

// A retry attempt OpenClaw persisted after a provider error. Matches the
// literal text the runtime writes plus the stopReason/empty-content shape,
// so it stays correct if the wording changes.
function isFailedAttemptMessage(message: GatewayMessage): boolean {
  if (message.role !== 'assistant') return false
  const stop = (message as { stopReason?: unknown }).stopReason
  const text = textFromMessage(message).trim()
  if (text === 'The agent run failed before producing a reply.') return true
  if (stop === 'error' && text.length === 0) return true
  return false
}

function mergeStreamingHistoryMessages(
  serverMessages: Array<GatewayMessage>,
  streamingMessages: Array<GatewayMessage>,
): Array<GatewayMessage> {
  if (!streamingMessages.length) return serverMessages

  const merged = [...serverMessages]
  for (const streamingMessage of streamingMessages) {
    const runId = (streamingMessage as { __streamRunId?: unknown }).__streamRunId
    if (typeof runId !== 'string' || runId.trim().length === 0) continue

    const hasMatch = merged.some((serverMessage) => {
      const serverRunId = (serverMessage as { __streamRunId?: unknown })
        .__streamRunId

      if (serverMessage.role !== streamingMessage.role) return false
      const streamingTime = getMessageTimestamp(streamingMessage)
      const serverTime = getMessageTimestamp(serverMessage)

      // Identical text is proof of identity on its own -- never let the time
      // window veto it. The streamed copy is stamped when its FIRST delta
      // arrives; the server stamps the same message at completion. Any reply
      // slower than the old hard 15s gate therefore had its two copies fall
      // outside the window and got appended twice, which is the reported
      // double-render (backend verified as holding exactly one message).
      // Response times here routinely exceed 15s, so that gate was
      // systematically wrong rather than an edge case.
      const sameTextIdentity = (() => {
        const a = normalizeAssistantTextForDedup(textFromMessage(streamingMessage))
        const b = normalizeAssistantTextForDedup(textFromMessage(serverMessage))
        return a.length > 0 && a === b
      })()

      // Widened from 15s to 120s for the non-identical (still-streaming
      // partial) case, where text differs legitimately and timing is the
      // only available signal.
      if (!sameTextIdentity && Math.abs(streamingTime - serverTime) > 120000) {
        return false
      }

      if (
        typeof serverRunId === 'string' &&
        serverRunId.trim().length > 0 &&
        serverRunId === runId
      ) {
        return messageCoversStreamingMessage(serverMessage, streamingMessage)
      }

      const streamingText = textFromMessage(streamingMessage)
      const serverText = textFromMessage(serverMessage)
      if (streamingText && streamingText !== serverText) {
        const normalizedStreamingText = normalizeAssistantTextForDedup(streamingText)
        const normalizedServerText = normalizeAssistantTextForDedup(serverText)
        const textLikelySameResponse =
          normalizedStreamingText.length > 0 &&
          normalizedServerText.length > 0 &&
          (normalizedStreamingText === normalizedServerText ||
            normalizedStreamingText.includes(normalizedServerText) ||
            normalizedServerText.includes(normalizedStreamingText))

        if (!textLikelySameResponse && !serverText.startsWith(streamingText)) {
          return false
        }
      }

      return messageCoversStreamingMessage(serverMessage, streamingMessage)
    })

    if (!hasMatch) {
      merged.push(streamingMessage)
    }
  }

  return merged
}

function messageCoversStreamingMessage(
  serverMessage: GatewayMessage,
  streamingMessage: GatewayMessage,
): boolean {
  const serverSignatures = nonTextPartSignatures(serverMessage)
  const streamingSignatures = nonTextPartSignatures(streamingMessage)
  if (streamingSignatures.size === 0) return true

  for (const signature of streamingSignatures) {
    if (!serverSignatures.has(signature)) {
      return false
    }
  }

  return true
}

function nonTextPartSignatures(message: GatewayMessage): Set<string> {
  const signatures = new Set<string>()
  const parts = Array.isArray(message.content) ? message.content : []
  for (const part of parts) {
    if (part.type === 'text') continue
    try {
      signatures.add(`${part.type}:${JSON.stringify(part)}`)
    } catch {
      signatures.add(`${part.type}:unserializable`)
    }
  }
  return signatures
}

function normalizeAssistantTextForDedup(text: string): string {
  return text
    .replace(/\[\[reply_to:[^\]]*\]\]\s*/gi, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mergeOptimisticHistoryMessages(
  serverMessages: Array<GatewayMessage>,
  optimisticMessages: Array<GatewayMessage>,
): Array<GatewayMessage> {
  if (!optimisticMessages.length) return serverMessages

  const merged = [...serverMessages]
  for (const optimisticMessage of optimisticMessages) {
    const hasMatch = merged.some((serverMessage) => {
      if (
        optimisticMessage.clientId &&
        serverMessage.clientId &&
        optimisticMessage.clientId === serverMessage.clientId
      ) {
        return true
      }
      if (
        optimisticMessage.__optimisticId &&
        serverMessage.__optimisticId &&
        optimisticMessage.__optimisticId === serverMessage.__optimisticId
      ) {
        return true
      }
      if (optimisticMessage.role && serverMessage.role) {
        if (optimisticMessage.role !== serverMessage.role) return false
      }
      const optimisticText = textFromMessage(optimisticMessage)
      if (!optimisticText) return false
      if (optimisticText !== textFromMessage(serverMessage)) return false
      const optimisticTime = getMessageTimestamp(optimisticMessage)
      const serverTime = getMessageTimestamp(serverMessage)
      // Reached only when role matches AND the text is already byte-identical
      // (checked just above), so this window is a tiebreaker, not the identity
      // test. 10s was too tight for the same reason the streaming path's 15s
      // gate was: an optimistic user message is stamped client-side at send,
      // while the server stamps it on persist, and a slow/queued turn pushes
      // those apart -- leaving the optimistic copy stranded as a duplicate.
      return Math.abs(optimisticTime - serverTime) <= 120000
    })

    if (!hasMatch) {
      merged.push(optimisticMessage)
    }
  }

  return merged
}
