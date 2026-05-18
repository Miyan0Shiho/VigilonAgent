import { describe, expect, it } from 'vitest'
import {
  createLocalPermissionGate,
  InMemoryTranscriptStore,
  type ToolUseContext,
  WebFetchTool,
} from '../src/index.js'

describe('WebFetchTool', () => {
  it('fetches public pages and returns a normalized text result', async () => {
    const result = await WebFetchTool.invoke(
      { url: 'https://example.com/docs' },
      createContext('/tmp/project', {
        permissionGate: createLocalPermissionGate({ mode: 'bypass-local' }),
        webFetch: {
          fetch: async () =>
            new Response('<html><body><h1>Docs</h1><p>Alpha beta</p></body></html>', {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
        },
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Docs')
    expect(result.content).toContain('Alpha beta')
    expect(result.metadata).toMatchObject({
      url: 'https://example.com/docs',
      code: 200,
      codeText: 'OK',
    })
  })

  it('refuses cross-host redirects and returns a recoverable explanation', async () => {
    const result = await WebFetchTool.invoke(
      { url: 'https://example.com/start' },
      createContext('/tmp/project', {
        permissionGate: createLocalPermissionGate({ mode: 'bypass-local' }),
        webFetch: {
          fetch: async () =>
            new Response('', {
              status: 302,
              headers: { location: 'https://other.example.com/landing' },
            }),
        },
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('REDIRECT DETECTED')
    expect(result.content).toContain('other.example.com')
    expect(result.metadata).toMatchObject({
      code: 302,
      codeText: 'Found',
    })
  })

  it('fails closed when network permission is denied', async () => {
    const transcript = new InMemoryTranscriptStore()
    const result = await WebFetchTool.invoke(
      { url: 'https://example.com/private' },
      createContext('/tmp/project', {
        transcript,
        permissionGate: createLocalPermissionGate({
          mode: 'read-only',
          transcript,
        }),
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('permission')
    const permissions = (await transcript.readAll()).filter(
      event => event.type === 'permission',
    )
    expect(permissions).toHaveLength(1)
    expect(permissions[0]).toMatchObject({
      request: {
        action: 'network',
        subject: 'domain:example.com',
      },
      decision: {
        allowed: false,
      },
    })
  })
})

function createContext(
  cwd: string,
  overrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  const transcript = overrides.transcript ?? new InMemoryTranscriptStore()
  return {
    cwd,
    abortSignal: new AbortController().signal,
    transcript,
    permissionGate:
      overrides.permissionGate ??
      createLocalPermissionGate({ mode: 'read-only', transcript }),
    readFileState: overrides.readFileState ?? new Map(),
    fileReadingLimits: overrides.fileReadingLimits,
    globLimits: overrides.globLimits,
    bashLimits: overrides.bashLimits,
    projectConfig: overrides.projectConfig,
    webFetch: overrides.webFetch,
  }
}
