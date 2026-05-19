import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'

const DEFAULT_MAX_CONTENT_CHARS = 12_000
const DEFAULT_MAX_REDIRECTS = 10

export const WebFetchTool: Tool = {
  name: 'WebFetch',
  description:
    'Fetches a public webpage with domain-level permission checks and safe redirect handling.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The fully qualified URL to fetch.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const url = parseUrlInput(input)
    if (!url) {
      return failed('WebFetch requires a valid url string.')
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return failed(`WebFetch invalid URL: ${url}`, {
        code: 'INVALID_URL',
      })
    }
    if (parsedUrl.protocol === 'http:') {
      parsedUrl = new URL(parsedUrl.toString().replace(/^http:/, 'https:'))
    }

    const permission = await context.permissionGate.requestPermission({
      action: 'network',
      subject: `domain:${parsedUrl.hostname}`,
      risk: 'medium',
      reason: `Fetch public webpage ${parsedUrl.origin}`,
    })
    if (!permission.allowed) {
      return failed(`WebFetch permission denied: ${permission.reason}`, {
        code: 'DOMAIN_BLOCKED',
        domain: parsedUrl.hostname,
      })
    }

  try {
      const cacheKey = parsedUrl.toString()
      const cached = context.webFetch?.cache?.get(cacheKey)
      if (cached) {
        return ok(cached.content, {
          url: cached.url,
          code: cached.code,
          codeText: cached.codeText,
          bytes: cached.bytes,
          cache: 'hit',
          fetchedAt: cached.fetchedAt,
        })
      }
      const response = await fetchWithRedirects(parsedUrl, context, 0)
      context.webFetch?.cache?.set(cacheKey, {
        url: String(response.url),
        fetchedAt: new Date().toISOString(),
        code: Number(response.code),
        codeText: String(response.codeText),
        content: response.result,
        bytes: Number(response.bytes),
      })
      return ok(response.result, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return failed(`WebFetch failed: ${message}`, {
        code: context.abortSignal.aborted ? 'ABORTED' : 'NETWORK_ERROR',
        url: parsedUrl.toString(),
      })
    }
  },
}

async function fetchWithRedirects(
  url: URL,
  context: ToolUseContext,
  redirectCount: number,
): Promise<Record<string, unknown> & { result: string }> {
  const fetchImpl = context.webFetch?.fetch ?? fetch
  if (redirectCount === 0) {
    assertFetchableProtocol(url)
  }
  const startedAt = Date.now()
  const response = await fetchImpl(url, {
    signal: context.abortSignal,
    redirect: 'manual',
  })
  const durationMs = Date.now() - startedAt
  const maxRedirects = context.webFetch?.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  if (isRedirectStatus(response.status)) {
    if (redirectCount >= maxRedirects) {
      throw new Error('Too many redirects')
    }
    const location = response.headers.get('location')
    if (!location) {
      throw new Error('Redirect missing Location header')
    }
    const nextUrl = new URL(location, url)
    if (!isSafeRedirect(url, nextUrl)) {
      const message = [
        `REDIRECT DETECTED: ${url.toString()} -> ${nextUrl.toString()}`,
        'This redirect crosses the allowed host boundary.',
        'Call WebFetch again with the redirect target if you want to continue.',
      ].join('\n')
      return {
        url: url.toString(),
        code: response.status,
        codeText: response.statusText || defaultStatusText(response.status),
        bytes: Buffer.byteLength(message),
        durationMs,
        result: message,
      }
    }
    return fetchWithRedirects(nextUrl, context, redirectCount + 1)
  }

  const rawText = await response.text()
  const normalized = normalizeFetchedContent(
    rawText,
    context.webFetch?.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
  )
  const summarized =
    context.webFetch?.summarize && normalized.length >= (context.webFetch?.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS)
      ? await context.webFetch.summarize({
          url: url.toString(),
          content: normalized,
          maxChars: context.webFetch?.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
        })
      : normalized
  return {
    url: url.toString(),
    code: response.status,
    codeText: response.statusText || defaultStatusText(response.status),
    bytes: Buffer.byteLength(rawText),
    durationMs,
    contentType: response.headers.get('content-type') ?? undefined,
    summarized: summarized !== normalized,
    result: summarized,
  }
}

function assertFetchableProtocol(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new Error(`WebFetch only supports https URLs after normalization: ${url.toString()}`)
  }
}

function normalizeFetchedContent(content: string, maxChars: number): string {
  // Simple HTML to Markdown-ish conversion
  let markdown = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    // Headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    // Paragraphs
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    // Lists
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    // Bold/Italic
    .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Cleanup whitespace
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  if (markdown.length <= maxChars) {
    return markdown;
  }
  return `${markdown.slice(0, maxChars)}\n\n[Truncated by WebFetch result budget]`;
}

function parseUrlInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  return typeof value.url === 'string' ? value.url : null
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isSafeRedirect(from: URL, to: URL): boolean {
  if (from.protocol !== to.protocol) return false
  if (normalizeHost(from.hostname) !== normalizeHost(to.hostname)) return false
  if (from.port !== to.port) return false
  if (to.username || to.password) return false
  return true
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, '')
}

function defaultStatusText(status: number): string {
  if (status === 302) return 'Found'
  if (status === 301) return 'Moved Permanently'
  if (status === 303) return 'See Other'
  if (status === 307) return 'Temporary Redirect'
  if (status === 308) return 'Permanent Redirect'
  if (status === 200) return 'OK'
  return String(status)
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata }
}

function failed(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: false, content, metadata }
}
