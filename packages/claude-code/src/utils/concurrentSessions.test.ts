import { beforeEach, describe, expect, it, vi } from 'vitest'

const chmod = vi.fn()
const mkdir = vi.fn()
const unlink = vi.fn()
const writeFile = vi.fn()

vi.mock('src/bun-bundle.ts', () => ({
  feature: () => false,
}))

vi.mock('fs/promises', () => ({
  chmod,
  mkdir,
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink,
  writeFile,
}))

vi.mock('../bootstrap/state', () => ({
  getOriginalCwd: () => '/repo',
  getSessionId: () => 'session-1',
  onSessionSwitch: vi.fn(),
}))

vi.mock('./cleanupRegistry', () => ({
  registerCleanup: vi.fn(),
}))

vi.mock('./debug', () => ({
  logForDebugging: vi.fn(),
}))

vi.mock('./envUtils', () => ({
  getClaudeConfigHomeDir: () => '/tmp/claude-home',
}))

vi.mock('./errors', () => ({
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  isFsInaccessible: () => false,
}))

vi.mock('./genericProcessUtils', () => ({
  isProcessRunning: vi.fn(),
}))

vi.mock('./platform', () => ({
  getPlatform: () => 'darwin',
}))

vi.mock('./slowOperations', () => ({
  jsonParse: JSON.parse,
  jsonStringify: JSON.stringify,
}))

vi.mock('./teammate', () => ({
  getAgentId: () => null,
}))

describe('registerSession', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mkdir.mockResolvedValue(undefined)
    unlink.mockResolvedValue(undefined)
    writeFile.mockResolvedValue(undefined)
  })

  it('continues when chmod on the sessions directory is denied', async () => {
    chmod.mockRejectedValue(
      Object.assign(new Error('operation not permitted'), { code: 'EPERM' }),
    )

    const { registerSession } = await import('./concurrentSessions')

    await expect(registerSession()).resolves.toBe(true)
    expect(writeFile).toHaveBeenCalledTimes(1)
  })
})
