import { describe, expect, it } from 'vitest'
import {
  firstCommandSuggestion,
  formatCommandHelpLines,
  getCommandSuggestions,
  parseTuiCommand,
} from './commandCatalog.js'

describe('commandCatalog', () => {
  it('parses slash commands and quit aliases through one catalog', () => {
    expect(parseTuiCommand('/resume 2 continue')?.definition.name).toBe('resume')
    expect(parseTuiCommand('/resume 2 continue')?.args).toBe('2 continue')
    expect(parseTuiCommand('exit')?.definition.name).toBe('quit')
    expect(parseTuiCommand('/details')?.definition.name).toBe('details')
    expect(parseTuiCommand('/unknown')).toBeNull()
  })

  it('returns focused slash suggestions', () => {
    expect(getCommandSuggestions('/re').map(command => command.name)).toEqual(['resume'])
    expect(firstCommandSuggestion('/app')?.usage).toBe('/approve <index|session-id> [prompt]')
  })

  it('keeps help text generated from the same command definitions', () => {
    expect(formatCommandHelpLines()).toContainEqual(expect.stringContaining('/sessions'))
    expect(formatCommandHelpLines()).toContainEqual(expect.stringContaining('/doctor'))
  })
})
