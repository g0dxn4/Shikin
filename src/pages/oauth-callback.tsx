import { useEffect } from 'react'

export function OAuthCallback() {
  const done = !window.opener

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    if (window.opener) {
      // Popup flow: post message back to parent window
      window.opener.postMessage({ type: 'oauth_callback', code, state }, window.location.origin)
      window.close()
    } else {
      // New tab: notify the original tab via localStorage, then close
      localStorage.setItem('oauth_callback_result', JSON.stringify({ code, state }))
      // Try to close this tab (works if opened via window.open)
      setTimeout(() => window.close(), 500)
    }
  }, [])

  return (
    <div className="flex h-screen items-center justify-center bg-[#020202]">
      <p className="font-body text-muted-foreground text-sm">
        {done ? 'Sign-in complete — you can close this tab.' : 'Completing sign-in...'}
      </p>
    </div>
  )
}
