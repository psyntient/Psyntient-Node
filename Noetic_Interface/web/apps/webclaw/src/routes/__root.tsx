import { useEffect, useState } from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import appCss from '../styles.css?url'
import { ProcessingSpinner } from '@/screens/onboarding/processing-spinner'
import { BootProgressBar } from '@/components/boot-progress-bar'


const themeScript = `
(() => {
  try {
    const stored = localStorage.getItem('chat-settings')
    let theme = 'dark'
    if (stored) {
      const parsed = JSON.parse(stored)
      const storedTheme = parsed?.state?.settings?.theme
      if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
        theme = storedTheme
      }
    }
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      root.classList.remove('light', 'dark', 'system')
      root.classList.add(theme)
      if (theme === 'system' && media.matches) {
        root.classList.add('dark')
      }
    }
    apply()
    media.addEventListener('change', () => {
      if (theme === 'system') apply()
    })
  } catch {}
})()
`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Psyntient Node',
      },
      {
        name: 'description',
        content: 'Chat with Cortex on your own Psyntient Node.',
      },
      {
        name: 'theme-color',
        content: '#0C0A1D',
      },
      {
        name: 'apple-mobile-web-app-capable',
        content: 'yes',
      },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'black-translucent',
      },
      {
        name: 'apple-mobile-web-app-title',
        content: 'Psyntient Node',
      },
      {
        property: 'og:image',
        content: '/cover.webp',
      },
      {
        property: 'og:image:type',
        content: 'image/webp',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        name: 'twitter:image',
        content: '/cover.webp',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/png',
        href: '/brand/psyntient-mark-32.png',
      },
      {
        rel: 'apple-touch-icon',
        href: '/brand/noetic-app-icon-192-v2.png',
      },
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
    ],
  }),

  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: RootNotFound,
})

const queryClient = new QueryClient()

function RootLayout() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installability degrades gracefully without it; not fatal.
      })
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingGate>
        <Outlet />
      </OnboardingGate>
    </QueryClientProvider>
  )
}

type OnboardingStatus = { hasProvider: boolean; isPaired: boolean; completed: boolean }

// Real, unavoidable cost: checking hasProvider shells out to OpenClaw's
// own auth store (models auth list), observed at ~10-15s of actual CLI
// startup/work, not something fixable by removing subprocess layers --
// verified the raw `openclaw models auth list --json` call alone costs
// the same. Paying that on every single page load would be a real
// regression for a returning, already-onboarded user (the old interim
// flow paid this once per app *launch*, at the daemon level -- this
// client-side gate would otherwise pay it once per page *load*, which
// happens more often). Once confirmed complete, cache that in
// sessionStorage so it's only paid once per browser session, not once
// per navigation/reload. A revoked pairing is still caught within 5min
// by the heartbeat loop and by every real Gateway/Archive call anyway;
// this cache only affects whether the *wizard UI* re-shows, not whether
// pairing is actually enforced elsewhere.
const SESSION_CACHE_KEY = 'psyntient-onboarding-complete'

// Client-only gate (same pattern as every other API-consuming component
// in this app -- fetch inside useEffect, nothing during SSR) redirecting
// to /onboarding whenever the wizard (CLAUDE.md "TARGET onboarding
// flow") hasn't been fully satisfied yet. Runs on every route except
// /onboarding itself, to avoid a redirect loop.
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)
  // Separate from `checked` so the boot bar can visibly finish (snap to
  // 100%, hold briefly) instead of unmounting mid-fill the instant the
  // real check resolves.
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    if (window.location.pathname === '/onboarding') {
      setChecked(true)
      return
    }
    if (sessionStorage.getItem(SESSION_CACHE_KEY) === '1') {
      setChecked(true)
      return
    }
    fetch('/api/onboarding')
      .then((res) => res.json())
      .then((data: { ok?: boolean; status?: OnboardingStatus }) => {
        const s = data.status
        const done = Boolean(s && s.hasProvider && s.isPaired && s.completed)
        if (!done) {
          // The gate's job is done once it decides to send the user to
          // /onboarding -- checked=true here means "let <Outlet/> render
          // whatever's now active," not "onboarding is complete." Leaving
          // this false would make the gate itself block /onboarding's own
          // content forever, since it wraps every route including that one.
          void navigate({ to: '/onboarding' })
          setResolved(true)
          setChecked(true)
          return
        }
        sessionStorage.setItem(SESSION_CACHE_KEY, '1')
        setResolved(true)
        // Let the boot bar visibly reach 100% before revealing chat,
        // rather than snapping straight from ~60-92% to gone.
        setTimeout(() => setChecked(true), 320)
      })
      .catch(() => {
        // If the check itself fails, don't strand the user on a blank
        // screen -- let them through rather than blocking on our own
        // request failure.
        setResolved(true)
        setChecked(true)
      })
  }, [navigate])

  if (!checked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface text-center">
        <ProcessingSpinner />
        <p className="text-base text-primary-500">Checking your setup…</p>
        <BootProgressBar done={resolved} />
      </div>
    )
  }
  return <>{children}</>
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <div className="root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}

function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <p className="text-pretty text-sm text-primary-700">Page not found.</p>
    </div>
  )
}
