import { describe, expect, it } from 'vitest'
import {
  backspacePromptBuffer,
  createPromptBuffer,
  deletePromptBuffer,
  insertPromptText,
  movePromptCursor,
  replacePromptBuffer,
  splitPromptAtCursor,
} from './promptBuffer.js'

describe('promptBuffer', () => {
  it('inserts text at the cursor instead of appending blindly', () => {
    const state = movePromptCursor(createPromptBuffer('abcd'), 'left')
    expect(insertPromptText(state, 'X')).toEqual({ value: 'abcXd', cursor: 4 })
  })

  it('handles cursor movement and deletion around the cursor', () => {
    let state = replacePromptBuffer('abcd')
    state = movePromptCursor(state, 'left')
    state = movePromptCursor(state, 'left')
    expect(backspacePromptBuffer(state)).toEqual({ value: 'acd', cursor: 1 })
    expect(deletePromptBuffer(state)).toEqual({ value: 'abd', cursor: 2 })
  })

  it('clamps cursor bounds and exposes render segments', () => {
    const state = createPromptBuffer('abc', 99)
    expect(movePromptCursor(state, 'start')).toEqual({ value: 'abc', cursor: 0 })
    expect(splitPromptAtCursor(state)).toEqual({
      before: 'abc',
      cursorText: ' ',
      after: '',
    })
  })
})
