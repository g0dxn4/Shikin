// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { createProgram } from './cli.js'
import { getPackagedWebRoot, validateWebPort, WEB_DEFAULT_PORT } from './web-host.js'

describe('hosted web CLI command', () => {
  it('uses the documented loopback port by default and registers the command', () => {
    const webCommand = createProgram([]).commands.find((command) => command.name() === 'web')

    expect(webCommand).toBeDefined()
    expect(webCommand?.opts().port).toBe(String(WEB_DEFAULT_PORT))
    expect(webCommand?.options.map((option) => option.long)).toContain('--port')
  })

  it('accepts only non-privileged TCP ports', () => {
    expect(validateWebPort(WEB_DEFAULT_PORT)).toBe(WEB_DEFAULT_PORT)
    expect(validateWebPort('1024')).toBe(1024)
    expect(validateWebPort('65535')).toBe(65535)

    for (const port of ['1023', '65536', '8480.5', '8480x', '', undefined]) {
      expect(() => validateWebPort(port)).toThrow('Use an integer from 1024 to 65535')
    }
  })

  it('resolves packaged assets beside the built CLI output', () => {
    expect(getPackagedWebRoot('file:///tmp/shikin/cli/dist/web-host.js')).toBe(
      '/tmp/shikin/cli/web'
    )
  })
})
