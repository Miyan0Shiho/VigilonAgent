export type PromptBufferState = {
  value: string
  cursor: number
}

export function createPromptBuffer(value = '', cursor = value.length): PromptBufferState {
  return {
    value,
    cursor: clampCursor(value, cursor),
  }
}

export function replacePromptBuffer(value: string): PromptBufferState {
  return createPromptBuffer(value, value.length)
}

export function insertPromptText(
  state: PromptBufferState,
  text: string,
): PromptBufferState {
  if (!text) return state
  const normalized = text.replace(/\r?\n/g, ' ')
  const value = `${state.value.slice(0, state.cursor)}${normalized}${state.value.slice(state.cursor)}`
  return {
    value,
    cursor: state.cursor + normalized.length,
  }
}

export function movePromptCursor(
  state: PromptBufferState,
  direction: 'left' | 'right' | 'start' | 'end',
): PromptBufferState {
  if (direction === 'start') return { ...state, cursor: 0 }
  if (direction === 'end') return { ...state, cursor: state.value.length }
  const delta = direction === 'left' ? -1 : 1
  return {
    ...state,
    cursor: clampCursor(state.value, state.cursor + delta),
  }
}

export function backspacePromptBuffer(state: PromptBufferState): PromptBufferState {
  if (state.cursor <= 0) return state
  return {
    value: `${state.value.slice(0, state.cursor - 1)}${state.value.slice(state.cursor)}`,
    cursor: state.cursor - 1,
  }
}

export function deletePromptBuffer(state: PromptBufferState): PromptBufferState {
  if (state.cursor >= state.value.length) return state
  return {
    value: `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}`,
    cursor: state.cursor,
  }
}

export function splitPromptAtCursor(state: PromptBufferState): {
  before: string
  cursorText: string
  after: string
} {
  const cursor = clampCursor(state.value, state.cursor)
  return {
    before: state.value.slice(0, cursor),
    cursorText: state.value[cursor] ?? ' ',
    after: state.value.slice(cursor + 1),
  }
}

function clampCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length
  return Math.max(0, Math.min(value.length, Math.trunc(cursor)))
}
