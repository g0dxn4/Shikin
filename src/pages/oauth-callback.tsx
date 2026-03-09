import { useEffect } from 'react'

export function OAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    if (window.opener) {
      window.opener.postMessage(
        { type: 'oauth_callback', code, state },
        window.location.origin
      )
      window.close()
    } else {
      // Same-window redirect fallback
      sessionStorage.setItem('oauth_callback_result', JSON.stringify({ code, state }))
      window.location.href = '/settings'
    }
  }, [])

  return (
    <div className="flex h-screen items-center justify-center bg-[#020202]">
      <p className="font-body text-muted-foreground text-sm">Completing sign-in...</p>
    </div>
  )
}
