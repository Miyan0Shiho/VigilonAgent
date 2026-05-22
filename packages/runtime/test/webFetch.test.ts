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

  it('caches normalized fetch results by URL', async () => {
    let calls = 0
    const cache = new Map()
    const context = createContext('/tmp/project', {
      permissionGate: createLocalPermissionGate({ mode: 'bypass-local' }),
      webFetch: {
        cache,
        fetch: async () => {
          calls += 1
          return new Response('<h1>Cached</h1>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        },
      },
    })

    const first = await WebFetchTool.invoke({ url: 'https://example.com/cache' }, context)
    const second = await WebFetchTool.invoke({ url: 'https://example.com/cache' }, context)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(calls).toBe(1)
    expect(second.metadata).toMatchObject({ cache: 'hit' })
  })

  it('uses secondary summarization when normalized content exceeds budget', async () => {
    const result = await WebFetchTool.invoke(
      { url: 'https://example.com/large' },
      createContext('/tmp/project', {
        permissionGate: createLocalPermissionGate({ mode: 'bypass-local' }),
        webFetch: {
          maxContentChars: 20,
          fetch: async () =>
            new Response(`<p>${'alpha '.repeat(20)}</p>`, {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
          summarize: async ({ url }) => `summary for ${url}`,
        },
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toBe('summary for https://example.com/large')
    expect(result.metadata).toMatchObject({ summarized: true })
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
