import chalk from 'chalk'
import { marked, type Token, type Tokens } from 'marked'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'
import wrapAnsi from 'wrap-ansi'

const MARKDOWN_PATTERN = /[*_`#>\-[\]|]|\d+\.\s/
const MAX_CACHE_ENTRIES = 200
const tokenCache = new Map<string, Token[]>()

export type MarkdownStyle =
  | 'text'
  | 'paragraph'
  | 'heading'
  | 'strong'
  | 'em'
  | 'codespan'
  | 'code'
  | 'link'
  | 'blockquote'
  | 'listMarker'
  | 'muted'

export type MarkdownSegment = {
  text: string
  style?: MarkdownStyle
}

export type MarkdownLine = {
  segments: MarkdownSegment[]
}

export type MarkdownRenderOptions = {
  width?: number
  maxLines?: number
}

export function lexMarkdown(source: string): Token[] {
  const text = normalizeMarkdown(source)
  if (!text) return []
  if (!MARKDOWN_PATTERN.test(text)) return [plainParagraphToken(text)]

  const cached = tokenCache.get(text)
  if (cached) return cached

  const tokens = marked.lexer(text, { gfm: true, breaks: false })
  tokenCache.set(text, tokens)
  if (tokenCache.size > MAX_CACHE_ENTRIES) {
    const oldest = tokenCache.keys().next().value
    if (oldest) tokenCache.delete(oldest)
  }
  return tokens
}

export function renderMarkdownToLines(
  source: string,
  options: MarkdownRenderOptions = {},
): MarkdownLine[] {
  const width = Math.max(24, options.width ?? 88)
  return limitLines(renderBlockTokens(lexMarkdown(source), { width }), options.maxLines)
}

export function renderMarkdownToAnsi(source: string, options: MarkdownRenderOptions = {}): string {
  return renderMarkdownToLines(source, options)
    .map(line => line.segments.map(formatAnsiSegment).join(''))
    .join('\n')
    .trimEnd()
}

export function renderMarkdownPlain(source: string, options: MarkdownRenderOptions = {}): string {
  return stripAnsi(renderMarkdownToAnsi(source, options))
}

function renderBlockTokens(tokens: Token[], options: Required<Pick<MarkdownRenderOptions, 'width'>>): MarkdownLine[] {
  const lines: MarkdownLine[] = []
  for (const token of tokens) {
    const next = renderBlockToken(token, options)
    if (next.length === 0) continue
    if (lines.length > 0 && !isBlank(lines.at(-1)) && shouldSeparate(token)) lines.push(blankLine())
    lines.push(...next)
  }
  return trimOuterBlankLines(lines)
}

function renderBlockToken(token: Token, options: Required<Pick<MarkdownRenderOptions, 'width'>>): MarkdownLine[] {
  switch (token.type) {
    case 'space':
      return []
    case 'paragraph':
      return wrapSegments(renderInlineTokens((token as Tokens.Paragraph).tokens), options.width)
    case 'heading':
      return wrapSegments(renderInlineTokens((token as Tokens.Heading).tokens).map(segment => ({
        ...segment,
        style: segment.style ?? 'heading',
      })), options.width)
    case 'blockquote':
      return renderBlockTokens((token as Tokens.Blockquote).tokens ?? [], { width: Math.max(20, options.width - 2) })
        .map(line => ({
          segments: [
            { text: '│ ', style: 'blockquote' as const },
            ...line.segments.map(segment => ({ ...segment, style: segment.style ?? 'blockquote' })),
          ],
        }))
    case 'code':
      return renderCodeBlock(token as Tokens.Code, options.width)
    case 'list':
      return renderList(token as Tokens.List, options.width)
    case 'table':
      return renderTable(token as Tokens.Table, options.width)
    case 'hr':
      return [{ segments: [{ text: '─'.repeat(Math.min(options.width, 72)), style: 'muted' }] }]
    case 'html':
      return token.block ? wrapSegments([{ text: token.text, style: 'muted' }], options.width) : []
    case 'text':
      return wrapSegments(renderInlineTokens([token]), options.width)
    default:
      return token.raw ? wrapSegments([{ text: token.raw }], options.width) : []
  }
}

function renderInlineTokens(tokens: Token[] | undefined): MarkdownSegment[] {
  if (!tokens || tokens.length === 0) return []
  return tokens.flatMap(token => {
    switch (token.type) {
      case 'text':
        return token.tokens ? renderInlineTokens(token.tokens) : [{ text: token.text }]
      case 'escape':
        return [{ text: token.text }]
      case 'br':
        return [{ text: '\n' }]
      case 'codespan':
        return [{ text: token.text, style: 'codespan' }]
      case 'strong':
        return renderInlineTokens(token.tokens).map(segment => ({ ...segment, style: segment.style ?? 'strong' }))
      case 'em':
        return renderInlineTokens(token.tokens).map(segment => ({ ...segment, style: segment.style ?? 'em' }))
      case 'del':
        return renderInlineTokens(token.tokens).map(segment => ({ ...segment, style: segment.style ?? 'muted' }))
      case 'link':
        return renderLink(token as Tokens.Link)
      case 'image':
        return [{ text: token.text ? `[image: ${token.text}]` : '[image]', style: 'muted' }]
      case 'html':
        return token.block ? [] : [{ text: token.text, style: 'muted' }]
      default:
        return 'tokens' in token && Array.isArray(token.tokens)
          ? renderInlineTokens(token.tokens)
          : token.raw ? [{ text: token.raw }] : []
    }
  })
}

function renderLink(token: Tokens.Link): MarkdownSegment[] {
  const label = renderInlineTokens(token.tokens)
  const visibleLabel = label.map(segment => segment.text).join('').trim()
  if (!token.href || token.href === visibleLabel) return label.map(segment => ({ ...segment, style: segment.style ?? 'link' }))
  return [
    ...label.map(segment => ({ ...segment, style: segment.style ?? 'link' })),
    { text: ` (${token.href})`, style: 'muted' },
  ]
}

function renderCodeBlock(token: Tokens.Code, width: number): MarkdownLine[] {
  const language = token.lang?.trim()
  const header: MarkdownLine[] = language ? [{ segments: [{ text: `\`\`\`${language}`, style: 'muted' }] }] : []
  const body = token.text.split('\n').flatMap(line => (
    wrapSegments([{ text: line || ' ', style: 'code' }], Math.max(20, width - 2))
      .map(wrapped => ({ segments: [{ text: '  ', style: 'muted' as const }, ...wrapped.segments] }))
  ))
  return [...header, ...body]
}

function renderList(token: Tokens.List, width: number): MarkdownLine[] {
  const lines: MarkdownLine[] = []
  token.items.forEach((item, index) => {
    const marker = token.ordered ? `${Number(token.start || 1) + index}. ` : '- '
    const content = renderListItem(item, Math.max(20, width - marker.length))
    if (content.length === 0) {
      lines.push({ segments: [{ text: marker.trimEnd(), style: 'listMarker' }] })
      return
    }
    content.forEach((line, lineIndex) => {
      lines.push({
        segments: [
          { text: lineIndex === 0 ? marker : ' '.repeat(marker.length), style: 'listMarker' },
          ...line.segments,
        ],
      })
    })
  })
  return lines
}

function renderListItem(item: Tokens.ListItem, width: number): MarkdownLine[] {
  const checkbox = item.task ? `${item.checked ? '[x]' : '[ ]'} ` : ''
  const rendered = renderBlockTokens(item.tokens, { width: Math.max(20, width - checkbox.length) })
  if (!checkbox || rendered.length === 0) return rendered
  const [first, ...rest] = rendered
  return [
    { segments: [{ text: checkbox, style: 'muted' }, ...first.segments] },
    ...rest.map(line => ({ segments: [{ text: ' '.repeat(checkbox.length), style: 'muted' as const }, ...line.segments] })),
  ]
}

function renderTable(token: Tokens.Table, width: number): MarkdownLine[] {
  const rows = [
    token.header.map(cell => renderInlineTokens(cell.tokens).map(segment => segment.text).join('')),
    ...token.rows.map(row => row.map(cell => renderInlineTokens(cell.tokens).map(segment => segment.text).join(''))),
  ]
  if (rows.length === 0 || rows[0]?.length === 0) return []
  const columnCount = rows[0].length
  const widths = Array.from({ length: columnCount }, (_, column) => (
    Math.min(32, Math.max(...rows.map(row => visualWidth(row[column] ?? '')), 3))
  ))
  const tableWidth = widths.reduce((sum, next) => sum + next, 0) + (columnCount * 3) + 1
  if (tableWidth > width) return renderVerticalTable(rows, token.header.map(cell => cell.text), width)

  const divider = `|${widths.map(size => `${'-'.repeat(size + 2)}`).join('|')}|`
  return rows.flatMap((row, rowIndex) => {
    const line = `| ${row.map((cell, column) => padVisual(cell, widths[column] ?? 3)).join(' | ')} |`
    const renderedLine: MarkdownLine = {
      segments: [{ text: line, style: rowIndex === 0 ? 'strong' : 'text' }],
    }
    return rowIndex === 0
      ? [renderedLine, { segments: [{ text: divider, style: 'muted' }] }]
      : [renderedLine]
  })
}

function renderVerticalTable(rows: string[][], headers: string[], width: number): MarkdownLine[] {
  return rows.slice(1).flatMap((row, index) => [
    { segments: [{ text: `row ${index + 1}`, style: 'muted' }] },
    ...row.flatMap((cell, column) => wrapSegments([
      { text: `${headers[column] ?? `col ${column + 1}`}: `, style: 'strong' },
      { text: cell },
    ], width)),
  ])
}

function wrapSegments(segments: MarkdownSegment[], width: number): MarkdownLine[] {
  const plain = segments.map(segment => segment.text).join('')
  if (!plain) return []
  const wrapped = wrapAnsi(plain, width, { hard: false, trim: false }).split('\n')
  if (segments.length === 1) return wrapped.map(text => ({ segments: [{ ...segments[0], text }] }))
  if (wrapped.length <= 1) return [{ segments }]
  return wrapped.map(text => ({ segments: [{ text, style: dominantStyle(segments) }] }))
}

function dominantStyle(segments: MarkdownSegment[]): MarkdownStyle | undefined {
  const styled = segments.find(segment => segment.style)
  return styled?.style
}

function formatAnsiSegment(segment: MarkdownSegment): string {
  switch (segment.style) {
    case 'heading':
      return chalk.bold(segment.text)
    case 'strong':
      return chalk.bold(segment.text)
    case 'em':
      return chalk.italic(segment.text)
    case 'codespan':
      return chalk.cyan(segment.text)
    case 'code':
      return chalk.gray(segment.text)
    case 'link':
      return chalk.cyan.underline(segment.text)
    case 'blockquote':
      return chalk.gray(segment.text)
    case 'listMarker':
      return chalk.green(segment.text)
    case 'muted':
      return chalk.gray(segment.text)
    default:
      return segment.text
  }
}

function limitLines(lines: MarkdownLine[], maxLines: number | undefined): MarkdownLine[] {
  if (!maxLines || lines.length <= maxLines) return lines
  return [
    ...lines.slice(0, Math.max(0, maxLines - 1)),
    { segments: [{ text: `... ${lines.length - maxLines + 1} more markdown lines`, style: 'muted' }] },
  ]
}

function shouldSeparate(token: Token): boolean {
  return token.type !== 'space'
}

function isBlank(line: MarkdownLine | undefined): boolean {
  return !line || line.segments.every(segment => segment.text.trim() === '')
}

function blankLine(): MarkdownLine {
  return { segments: [{ text: '' }] }
}

function trimOuterBlankLines(lines: MarkdownLine[]): MarkdownLine[] {
  let start = 0
  let end = lines.length
  while (start < end && isBlank(lines[start])) start += 1
  while (end > start && isBlank(lines[end - 1])) end -= 1
  return lines.slice(start, end)
}

function padVisual(value: string, width: number): string {
  const text = stripAnsi(value)
  return `${text}${' '.repeat(Math.max(0, width - visualWidth(text)))}`
}

function visualWidth(value: string): number {
  return stringWidth(stripAnsi(value))
}

function normalizeMarkdown(source: string): string {
  return source.replace(/\r\n?/g, '\n').trim()
}

function plainParagraphToken(text: string): Tokens.Paragraph {
  return {
    type: 'paragraph',
    raw: text,
    text,
    tokens: [{ type: 'text', raw: text, text }],
  }
}
