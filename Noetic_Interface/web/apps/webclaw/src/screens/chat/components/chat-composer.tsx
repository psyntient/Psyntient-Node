import { memo, useCallback, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUp02Icon, Mic01Icon, StopIcon } from '@hugeicons/core-free-icons'
import { formatCostUsd, formatModelName, formatTokenCount } from '../format-usage'
import type { Ref } from 'react'

import type { AttachmentFile } from '@/components/attachment-button'
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from '@/components/prompt-kit/prompt-input'
import { Button } from '@/components/ui/button'
import { AttachmentButton } from '@/components/attachment-button'
import { AttachmentPreviewList } from '@/components/attachment-preview'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProcessingSpinner } from '@/screens/onboarding/processing-spinner'

type ChatComposerProps = {
  onSubmit: (value: string, helpers: ChatComposerHelpers) => void
  isLoading: boolean
  disabled: boolean
  wrapperRef?: Ref<HTMLDivElement>
  model?: string
  usedTokens?: number
  costUsd?: number
}

type ChatComposerHelpers = {
  reset: () => void
  setValue: (value: string) => void
  attachments?: Array<AttachmentFile>
}

function ChatComposerComponent({
  onSubmit,
  isLoading,
  disabled,
  wrapperRef,
  model,
  usedTokens,
  costUsd,
}: ChatComposerProps) {
  const [attachments, setAttachments] = useState<Array<AttachmentFile>>([])
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const valueRef = useRef('')
  const setValueRef = useRef<((value: string) => void) | null>(null)
  const [recordingState, setRecordingState] = useState<
    'idle' | 'setting-up' | 'recording' | 'transcribing'
  >('idle')
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Array<Blob>>([])
  const focusPrompt = useCallback(() => {
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      promptRef.current?.focus()
    })
  }, [])
  const reset = useCallback(() => {
    if (setValueRef.current) {
      setValueRef.current('')
    }
    setAttachments((prev) => {
      prev.forEach((attachment) => {
        if (attachment.preview) {
          URL.revokeObjectURL(attachment.preview)
        }
      })
      return []
    })
    focusPrompt()
  }, [focusPrompt])
  const handleFileSelect = useCallback((file: AttachmentFile) => {
    setAttachments((prev) => [...prev, file])
  }, [])
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((attachment) => attachment.id === id)
      if (removed?.preview) {
        URL.revokeObjectURL(removed.preview)
      }
      return prev.filter((attachment) => attachment.id !== id)
    })
  }, [])
  const setComposerValue = useCallback(
    (nextValue: string) => {
      if (setValueRef.current) {
        setValueRef.current(nextValue)
      }
      focusPrompt()
    },
    [focusPrompt],
  )
  const insertTranscribedText = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const existing = valueRef.current
      const next = existing.trim().length > 0 ? `${existing} ${trimmed}` : trimmed
      if (setValueRef.current) {
        setValueRef.current(next)
      }
      focusPrompt()
    },
    [focusPrompt],
  )
  const transcribeRecording = useCallback(async () => {
    const chunks = recordedChunksRef.current
    recordedChunksRef.current = []
    if (chunks.length === 0) {
      setRecordingState('idle')
      return
    }
    setRecordingState('transcribing')
    try {
      const blob = new Blob(chunks, { type: chunks[0].type })
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': blob.type || 'audio/webm' },
        body: blob,
      })
      const body = (await res.json()) as { ok: boolean; text?: string; error?: string }
      if (!body.ok) {
        throw new Error(body.error || 'Transcription failed')
      }
      insertTranscribedText(body.text || '')
      setRecordingError(null)
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : 'Voice input failed')
    } finally {
      setRecordingState('idle')
    }
  }, [insertTranscribedText])
  const startRecording = useCallback(async () => {
    setRecordingError(null)
    setRecordingState('setting-up')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recordedChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        void transcribeRecording()
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecordingState('recording')
    } catch {
      setRecordingError('Microphone access was denied or unavailable')
      setRecordingState('idle')
    }
  }, [transcribeRecording])
  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
  }, [])
  const handleMicClick = useCallback(() => {
    if (recordingState === 'idle') {
      void startRecording()
    } else if (recordingState === 'recording') {
      stopRecording()
    }
  }, [recordingState, startRecording, stopRecording])
  const handleSubmit = useCallback(() => {
    if (disabled) return
    const body = valueRef.current.trim()
    // Allow submit if there's text OR valid attachments
    const validAttachments = attachments.filter((a) => !a.error && a.base64)
    if (body.length === 0 && validAttachments.length === 0) return
    onSubmit(body, {
      reset,
      setValue: setComposerValue,
      attachments: validAttachments,
    })
    focusPrompt()
  }, [disabled, focusPrompt, onSubmit, reset, setComposerValue, attachments])
  const submitDisabled = disabled

  return (
    <div
      className="mx-auto w-full max-w-full px-5 sm:max-w-[768px] sm:min-w-[400px] relative pb-3"
      ref={wrapperRef}
    >
      <TooltipProvider>
        <PromptInput
          valueRef={valueRef}
          setValueRef={setValueRef}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          disabled={disabled}
        >
          <AttachmentPreviewList
            attachments={attachments}
            onRemove={handleRemoveAttachment}
          />
          <PromptInputTextarea
            placeholder="Type a message…"
            inputRef={promptRef}
          />
          <PromptInputActions className="justify-end px-3">
            <div className="flex items-center gap-2 min-h-8 flex-nowrap">
              <PromptInputAction
                tooltip="Attach image"
                render={(triggerProps) => (
                  <AttachmentButton
                    onFileSelect={handleFileSelect}
                    disabled={disabled}
                    buttonProps={{
                      ...triggerProps,
                      className: cn('rounded-full', triggerProps.className),
                    }}
                  />
                )}
              />
              <PromptInputAction
                tooltip={
                  recordingState === 'recording'
                    ? 'Stop recording'
                    : recordingState === 'idle'
                      ? 'Voice input — transcribed locally on your device'
                      : undefined
                }
                render={(triggerProps) => (
                  <Button
                    {...triggerProps}
                    type="button"
                    onClick={(event) => {
                      triggerProps.onClick?.(event)
                      handleMicClick()
                    }}
                    disabled={
                      disabled ||
                      recordingState === 'setting-up' ||
                      recordingState === 'transcribing'
                    }
                    size="icon-sm"
                    variant="ghost"
                    className={cn(
                      'rounded-full',
                      recordingState === 'recording' &&
                        'text-gold animate-[psy-stream-pulse_1.6s_ease-in-out_infinite]',
                      triggerProps.className,
                    )}
                    aria-label={recordingState === 'recording' ? 'Stop recording' : 'Voice input'}
                  >
                    {recordingState === 'setting-up' || recordingState === 'transcribing' ? (
                      <ProcessingSpinner size="size-5" />
                    ) : (
                      <HugeiconsIcon
                        icon={recordingState === 'recording' ? StopIcon : Mic01Icon}
                        size={20}
                        strokeWidth={1.5}
                      />
                    )}
                  </Button>
                )}
              />
              <PromptInputAction
                tooltip="Send message"
                render={(triggerProps) => (
                  <Button
                    {...triggerProps}
                    onClick={(event) => {
                      triggerProps.onClick?.(event)
                      handleSubmit()
                    }}
                    disabled={submitDisabled || triggerProps.disabled}
                    size="icon-sm"
                    variant="gold"
                    className={cn('rounded-full', triggerProps.className)}
                    aria-label="Send message"
                  >
                    <HugeiconsIcon
                      icon={ArrowUp02Icon}
                      size={20}
                      strokeWidth={1.5}
                    />
                  </Button>
                )}
              />
            </div>
          </PromptInputActions>
        </PromptInput>
        {model || typeof usedTokens === 'number' ? (
          <p className="mt-1 px-1 text-xs text-primary-400 flex items-center gap-1.5 select-none">
            {model ? (
              <span className="font-medium text-primary-500">
                {formatModelName(model)}
              </span>
            ) : null}
            {typeof usedTokens === 'number' ? (
              <span>
                {formatTokenCount(usedTokens)} tokens
                {typeof costUsd === 'number' ? ` · ${formatCostUsd(costUsd)}` : ''}
              </span>
            ) : null}
          </p>
        ) : null}
        {recordingError ? (
          <p className="mt-1 px-1 text-xs text-red-500">{recordingError}</p>
        ) : null}
      </TooltipProvider>
    </div>
  )
}

const MemoizedChatComposer = memo(ChatComposerComponent)

export { MemoizedChatComposer as ChatComposer }
export type { ChatComposerHelpers }
