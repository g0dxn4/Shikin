import { useEffect } from 'react'

export function OAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    if (window.opener) {
      // Popup flow: post message back to parent window
      window.opener.postMessage(
        { type: 'oauth_callback', code, state },
        window.location.origin
      )
      window.close()
    } else {
      // New tab / same-window: store in localStorage (shared across tabs) and redirect
      localStorage.setItem('oauth_callback_result', JSON.stringify({ code, state }))
      // Navigate this tab to settings (or close if opened as a tab)
      window.location.href = '/settings'
    }
  }, [])

  return (
    <div className="flex h-screen items-center justify-center bg-[#020202]">
      <p className="font-body text-muted-foreground text-sm">Completing sign-in...</p>
    </div>
  )
}
