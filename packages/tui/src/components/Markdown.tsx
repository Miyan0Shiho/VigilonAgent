import React from 'react'
import { Box, Text } from 'ink'
import { renderMarkdownToLines, type MarkdownLine, type MarkdownSegment, type MarkdownStyle } from '../render/markdown.js'

export function Markdown({
  children,
  maxLines,
  width = 88,
}: {
  children: string
  maxLines?: number
  width?: number
}): React.ReactElement {
  const lines = renderMarkdownToLines(children, { maxLines, width })
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => <MarkdownTextLine key={index} line={line} />)}
    </Box>
  )
}

function MarkdownTextLine({ line }: { line: MarkdownLine }): React.ReactElement {
  return (
    <Text wrap="wrap">
      {line.segments.map((segment, index) => <MarkdownTextSegment key={index} segment={segment} />)}
    </Text>
  )
}

function MarkdownTextSegment({ segment }: { segment: MarkdownSegment }): React.ReactElement {
  return (
    <Text {...styleProps(segment.style)}>
      {segment.text}
    </Text>
  )
}

function styleProps(style: MarkdownStyle | undefined): {
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dimColor?: boolean
} {
  switch (style) {
    case 'heading':
      return { bold: true }
    case 'strong':
      return { bold: true }
    case 'em':
      return { italic: true }
    case 'codespan':
      return { color: 'cyan' }
    case 'code':
      return { color: 'gray' }
    case 'link':
      return { color: 'cyan', underline: true }
    case 'blockquote':
      return { color: 'gray' }
    case 'listMarker':
      return { color: 'green' }
    case 'muted':
      return { color: 'gray' }
    default:
      return {}
  }
}
