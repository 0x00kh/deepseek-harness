import { describe, expect, it } from 'vitest'
import {
  extractReadyUrl,
  latestDiagnostic,
  sidecarSpawnRequest,
} from '../../apps/desktop/launcher/launcher.js'

describe('desktop launcher', () => {
  it('waits for the assembled runtime ready line and accepts an assigned port', () => {
    expect(extractReadyUrl('booting\n')).toBeUndefined()
    expect(extractReadyUrl('booting\ndsh web: http://127.0.0.1:43129\n')).toBe('http://127.0.0.1:43129')
    expect(extractReadyUrl('dsh web: http://0.0.0.0:43129')).toBeUndefined()
  })

  it('shows only one bounded diagnostic line', () => {
    expect(latestDiagnostic('first\n\nsecond\n')).toBe('second')
    expect(latestDiagnostic('x'.repeat(300))).toBe(`${'x'.repeat(237)}…`)
  })

  it('starts only the bundled Web sidecar from the user home directory', () => {
    expect(sidecarSpawnRequest('/app/runtime/dsh/lib/bin.js', '/Users/test')).toEqual({
      program: 'binaries/dsh-sidecar',
      args: [
        '/app/runtime/dsh/lib/bin.js',
        'web',
        '--host',
        '127.0.0.1',
        '--port',
        '0',
      ],
      options: { cwd: '/Users/test', sidecar: true },
    })
  })
})
