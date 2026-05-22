import { describe, expect, it } from 'vitest'
import stripAnsi from 'strip-ansi'
import { renderMarkdownPlain, renderMarkdownToLines } from './markdown.js'
import { renderShellFrame } from './text.js'
import type { TuiRuntimeEvent } from '../runtime/types.js'

describe('markdown rendering', () => {
  it('renders assistant markdown as terminal text instead of raw markdown markers', () => {
    const plain = renderMarkdownPlain([
      '项目里的 **README.md** 可以先看。',
      '',
      '- 阅读 `docs/guide.md`',
      '- 再运行 `pnpm test`',
    ].join('\n'))

    expect(plain).toContain('README.md')
    expect(plain).toContain('docs/guide.md')
    expect(plain).toContain('- 阅读 docs/guide.md')
    expect(plain).not.toContain('**README.md**')
    expect(plain).not.toContain('`docs/guide.md`')
  })

  it('preserves code fences as readable terminal code blocks', () => {
    const plain = renderMarkdownPlain('```ts\nconst ok = true\n```')

    expect(plain).toContain('```ts')
    expect(plain).toContain('const ok = true')
  })

  it('renders tables without exposing the source separator row', () => {
    const plain = renderMarkdownPlain([
      '| file | status |',
      '| --- | --- |',
      '| README.md | ok |',
    ].join('\n'))

    expect(plain).toContain('| file')
    expect(plain).toContain('| README.md')
    expect(plain).not.toContain('| --- | --- |')
  })

  it('wraps wide CJK markdown without slicing source text first', () => {
    const lines = renderMarkdownToLines('给你一个 **README.md**，里面包含中文路径 `docs/设计.md`。', { width: 24 })

    expect(lines.length).toBeGreaterThan(1)
    expect(lines.map(line => line.segments.map(segment => segment.text).join('')).join('\n')).toContain('docs/设计.md')
  })

  it('uses markdown rendering in the text shell frame assistant timeline', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'user', content: '随便给我一个md文档' },
      { type: 'assistant', content: '给你 **README.md**，可以看 `docs/guide.md`。' },
    ]
    const frame = stripAnsi(renderShellFrame({
      cwd: '/tmp/repo',
      sessions: [],
      events,
      status: 'ready',
    }))

    expect(frame).toContain('README.md')
    expect(frame).toContain('docs/guide.md')
    expect(frame).not.toContain('**README.md**')
    expect(frame).not.toContain('`docs/guide.md`')
  })
})
