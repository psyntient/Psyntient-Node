import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export type ChatSettings = {
  showToolMessages: boolean
  showReasoningBlocks: boolean
  thinkingLevel: ThinkingLevel
  theme: ThemeMode
}

type ChatSettingsState = {
  settings: ChatSettings
  updateSettings: (updates: Partial<ChatSettings>) => void
}

export const useChatSettingsStore = create<ChatSettingsState>()(
  persist(
    (set) => ({
      settings: {
        showToolMessages: true,
        showReasoningBlocks: true,
        thinkingLevel: 'off',
        theme: 'dark',
      },
      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),
    }),
    {
      name: 'chat-settings',
      // v1: this Node's default chat model (claude-3-haiku) has no thinking
      // support at all, so the old 'medium' default broke every message
      // ("Thinking level \"medium\" is not supported ... Use one of: off.").
      // One-time correction for anyone with the old default already
      // persisted; a deliberate later choice (including switching back to
      // low/medium/high for a model that supports it) is untouched after
      // this runs once.
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as ChatSettingsState
        if (state?.settings?.thinkingLevel && state.settings.thinkingLevel !== 'off') {
          return {
            ...state,
            settings: { ...state.settings, thinkingLevel: 'off' },
          }
        }
        return state
      },
    },
  ),
)

export function useChatSettings() {
  const settings = useChatSettingsStore((state) => state.settings)
  const updateSettings = useChatSettingsStore((state) => state.updateSettings)

  return {
    settings,
    updateSettings,
  }
}

export function useResolvedTheme() {
  const theme = useChatSettingsStore((state) => state.settings.theme)
  const [systemIsDark, setSystemIsDark] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemIsDark(media.matches)
    function handleChange(event: MediaQueryListEvent) {
      setSystemIsDark(event.matches)
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return useMemo(() => {
    if (theme === 'dark') return 'dark'
    if (theme === 'light') return 'light'
    return systemIsDark ? 'dark' : 'light'
  }, [theme, systemIsDark])
}
