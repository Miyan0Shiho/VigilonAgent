import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appendFileSync = vi.fn()
const mkdirSync = vi.fn()
const writeToStderr = vi.fn()

vi.mock('src/bootstrap/state', () => ({
  getSessionId: () => 'test-session',
}))

vi.mock('./fsOperations', () => ({
  getFsImplementation: () => ({
    appendFileSync,
    mkdirSync,
  }),
}))

vi.mock('./envUtils', () => ({
  getClaudeConfigHomeDir: () => '/tmp/claude-home',
  isEnvTruthy: (value: string | undefined) =>
    value === '1' || value === 'true',
}))

vi.mock('./process', () => ({
  writeToStderr,
}))

vi.mock('./cleanupRegistry', () => ({
  registerCleanup: vi.fn(),
}))

vi.mock('./debugFilter', () => ({
  parseDebugFilter: () => null,
  shouldShowDebugMessage: () => true,
}))

vi.mock('./slowOperations', () => ({
  jsonStringify: JSON.stringify,
}))

describe('logForDebugging', () => {
  const originalArgv = [...process.argv]
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.argv = ['node', 'cli', '--debug']
    process.env.NODE_ENV = 'development'
    delete process.env.CLAUDE_CODE_DEBUG_LOGS_DIR
  })

  it('does not throw when debug log file writes fail', async () => {
    appendFileSync.mockImplementation(() => {
      const error = new Error('permission denied')
      ;(error as NodeJS.ErrnoException).code = 'EPERM'
      throw error
    })

    const { logForDebugging } = await import('./debug')

    expect(() => logForDebugging('startup message')).not.toThrow()
    expect(writeToStderr).toHaveBeenCalled()
  })

  afterEach(() => {
    process.argv = originalArgv
    process.env.NODE_ENV = originalNodeEnv
  })
})
