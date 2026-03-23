/**
 * Tiny OAuth callback server for development.
 * Listens on port 1455 for OpenAI OAuth redirects and forwards
 * the code/state to the Vite dev app on port 1420.
 */
import { createServer } from 'node:http'

const PORT = 1455
const APP_PORT = 1420

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Sign-in Complete</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#020202;color:#e4e4e7}
.card{text-align:center;padding:2rem}h1{font-size:1.25rem;margin-bottom:0.5rem;color:#bf5af2}p{color:#71717a;font-size:0.875rem}</style>
</head><body><div class="card"><h1>Authorization successful</h1><p>You can close this tab.</p></div>
<script>
// Post result to the app tab via localStorage (triggers 'storage' event on other tabs)
const params = new URLSearchParams(window.location.search);
localStorage.setItem('oauth_callback_result', JSON.stringify({
  code: params.get('code'),
  state: params.get('state'),
}));
</script>
</body></html>`

const ERROR_HTML = (msg) => `<!DOCTYPE html>
<html><head><title>Sign-in Failed</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#020202;color:#e4e4e7}
.card{text-align:center;padding:2rem}h1{font-size:1.25rem;margin-bottom:0.5rem;color:#ef4444}p{color:#71717a;font-size:0.875rem}</style>
</head><body><div class="card"><h1>Authorization failed</h1><p>${msg}</p></div></body></html>`

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/auth/callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) {
      const desc = url.searchParams.get('error_description') || error
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(ERROR_HTML(desc))
      return
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(ERROR_HTML('Missing authorization code'))
      return
    }

    // Redirect to app with code/state so the SPA can handle token exchange
    const appUrl = `http://localhost:${APP_PORT}/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state || '')}`
    res.writeHead(302, { Location: appUrl })
    res.end()
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`  OAuth callback server listening on http://localhost:${PORT}`)
})
