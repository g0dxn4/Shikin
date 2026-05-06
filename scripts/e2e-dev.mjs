import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const tempHome = mkdtempSync(join(tmpdir(), 'shikin-e2e-home-'))

const child = spawn('node', ['scripts/dev.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    HOME: tempHome,
    XDG_DATA_HOME: join(tempHome, '.local', 'share'),
  },
})

let shuttingDown = false

function cleanup() {
  rmSync(tempHome, { recursive: true, force: true })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  if (child.exitCode === null) {
    child.kill('SIGTERM')
  }

  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL')
    }
    cleanup()
    process.exit(code)
  }, 500).unref()
}

child.on('exit', (code, signal) => {
  if (shuttingDown) return
  cleanup()

  if (signal) {
    process.exit(1)
  }

  process.exit(code ?? 0)
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('exit', cleanup)
