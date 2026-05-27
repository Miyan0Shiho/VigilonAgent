import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'

const DEFAULT_MAX_CONTENT_CHARS = 12_000
const DEFAULT_MAX_REDIRECTS = 10

export const WebFetchTool: Tool = {
  name: 'WebFetch',
  description:
    'Fetches a public webpage. In "text" mode (default), returns markdown content. ' +
    'In "browse" mode, returns structured page data (links, forms, buttons) for navigation.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The fully qualified URL to fetch.',
      },
      mode: {
        type: 'string',
        enum: ['text', 'browse'],
        description: '"text" returns page content (default). "browse" extracts links, forms, and buttons for navigation.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const { url, mode } = input as { url: unknown; mode?: string }
    if (!url || typeof url !== 'string') {
      return failed('WebFetch requires a valid url string.')
    }

    const browseMode = mode === 'browse'

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

    if (isBlockedHost(parsedUrl.hostname)) {
      return failed(`WebFetch blocked: ${parsedUrl.hostname} is not a public host`, {
        code: 'BLOCKED_HOST',
        hostname: parsedUrl.hostname,
      })
    }

    const permission = await context.permissionGate.requestPermission({
      action: 'network',
      subject: `domain:${parsedUrl.hostname}`,
      risk: 'medium',
      reason: `Fetch public webpage ${parsedUrl.origin}`,
      origin: withToolPermissionOrigin(context.permissionOrigin, 'WebFetch'),
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
      // Browse mode: extract structured page data
      const rawTextForBrowse = typeof response.rawText === 'string' ? response.rawText : ''
      const browseMeta = browseMode ? extractBrowseData(rawTextForBrowse, parsedUrl) : undefined
      context.webFetch?.cache?.set(cacheKey, {
        url: String(response.url),
        fetchedAt: new Date().toISOString(),
        code: Number(response.code),
        codeText: String(response.codeText),
        content: response.result,
        bytes: Number(response.bytes),
      })
      return ok(
        browseMeta?.text ?? response.result,
        { ...response, browseData: browseMeta },
      )
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
): Promise<Record<string, unknown> & { result: string; rawText: string }> {
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
        rawText: '',
      }
    }
    if (isBlockedHost(nextUrl.hostname)) {
      const message = [
        `REDIRECT BLOCKED: ${url.toString()} -> ${nextUrl.toString()}`,
        `The redirect target ${nextUrl.hostname} is not a public host.`,
      ].join('\n')
      return {
        url: url.toString(),
        code: response.status,
        codeText: response.statusText || defaultStatusText(response.status),
        bytes: Buffer.byteLength(message),
        durationMs,
        result: message,
        rawText: '',
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
    rawText,
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

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '[::]',
  '169.254.169.254',
  'metadata.google.internal',
])

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(lower)) return true
  if (lower.endsWith('.local')) return true
  if (lower.endsWith('.internal')) return true
  return isPrivateIPv4(lower)
}

function isPrivateIPv4(hostname: string): boolean {
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!ipv4Match) return false
  const b0 = Number(ipv4Match[1])
  const b1 = Number(ipv4Match[2])
  if (b0 === 10) return true
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true
  if (b0 === 192 && b1 === 168) return true
  if (b0 === 127) return true
  if (b0 === 169 && b1 === 254) return true
  return false
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata }
}

function failed(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: false, content, metadata }
}

/** Extract links, forms, and buttons from HTML for browse-mode navigation. */
function extractBrowseData(
  html: string,
  baseUrl: URL,
): { text: string; links: string[]; forms: string[]; buttons: string[] } {
  const links: string[] = []
  const forms: string[] = []
  const buttons: string[] = []

  // Extract <a href> links
  const linkRegex = /<a\s[^>]*?href="([^"]*)"[^>]*?>([^<]*)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1]!
    const text = match[2]?.trim() || href
    try {
      const resolved = new URL(href, baseUrl).toString()
      links.push(`- [${text}](${resolved})`)
    } catch {
      links.push(`- ${text} (${href})`)
    }
    if (links.length >= 50) break
  }

  // Extract <form> elements
  const formRegex = /<form\s[^>]*?(?:action="([^"]*)")?[^>]*?method="([^"]*)"[^>]*?>/gi
  let formIdx = 0
  while ((match = formRegex.exec(html)) !== null) {
    formIdx++
    const action = match[1] || ''
    const method = (match[2] || 'get').toUpperCase()
    try {
      forms.push(`- Form #${formIdx}: ${method} ${new URL(action, baseUrl).toString()}`)
    } catch {
      forms.push(`- Form #${formIdx}: ${method} ${action || '(no action)'}`)
    }
    if (forms.length >= 20) break
  }

  // Extract <button> and <input type=submit>
  const buttonRegex = /<(?:button|input\s[^>]*?type="submit")[^>]*?>(?:([^<]*?)<\/button>)?/gi
  let btnIdx = 0
  while ((match = buttonRegex.exec(html)) !== null) {
    btnIdx++
    const label = match[1]?.trim() || `button-${btnIdx}`
    buttons.push(`- ${label}`)
    if (buttons.length >= 20) break
  }

  const sections: string[] = []
  if (links.length > 0) sections.push(`Links (${links.length}):\n${links.join('\n')}`)
  if (forms.length > 0) sections.push(`Forms (${forms.length}):\n${forms.join('\n')}`)
  if (buttons.length > 0) sections.push(`Buttons (${buttons.length}):\n${buttons.join('\n')}`)

  return {
    text: sections.length > 0 ? sections.join('\n\n') : '(No navigable elements found)',
    links: links.map(l => l.replace(/^- \[([^\]]+)\]\(([^)]+)\)$/, '$2')),
    forms: forms.map(f => f.replace(/^- Form #\d+: \w+ /, '')),
    buttons: buttons.map(b => b.replace(/^- /, '')),
  }
}
