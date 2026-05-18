import type {
  AskUserQuestionInput,
  AskUserQuestionOutput,
  Tool,
  ToolResult,
  ToolUseContext,
} from '../runtime/contracts.js'

export const AskUserQuestionTool: Tool = {
  name: 'AskUserQuestion',
  description:
    'Pauses execution and collects structured operator answers before continuing the task.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description:
          'One to four structured questions. Each question includes a prompt, short header, and two to four answer options.',
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseAskUserQuestionInput(input)
    const validation = validateQuestions(parsed)
    if (validation) return failed(validation)

    const permission = await context.permissionGate.requestPermission({
      action: 'ask-user',
      subject: 'Structured operator clarification',
      risk: 'low',
      reason: 'Need structured human input before continuing the task',
    })
    if (!permission.allowed) {
      return failed(`AskUserQuestion permission denied: ${permission.reason}`)
    }
    if (!context.operator) {
      return failed(
        'AskUserQuestion requires an interactive operator surface to collect answers.',
      )
    }

    const answered = await context.operator.askQuestions({
      questions: parsed.questions,
      annotations: parsed.annotations,
      answers: parsed.answers,
      metadata: parsed.metadata,
    })
    if (!answered || Object.keys(answered.answers).length === 0) {
      return failed('User declined to answer questions.')
    }

    const output: AskUserQuestionOutput = {
      questions: parsed.questions,
      answers: answered.answers,
      ...(answered.annotations ? { annotations: answered.annotations } : {}),
    }
    return ok(buildContinuation(output), output)
  },
}

function parseAskUserQuestionInput(input: unknown): AskUserQuestionInput {
  if (!input || typeof input !== 'object') {
    return { questions: [] }
  }
  const value = input as Record<string, unknown>
  return {
    questions: Array.isArray(value.questions)
      ? value.questions.map(question => normalizeQuestion(question)).filter(isPresent)
      : [],
    answers:
      value.answers && typeof value.answers === 'object'
        ? Object.fromEntries(
            Object.entries(value.answers).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : undefined,
    annotations:
      value.annotations && typeof value.annotations === 'object'
        ? Object.fromEntries(
            Object.entries(value.annotations).map(([key, annotation]) => [
              key,
              normalizeAnnotation(annotation),
            ]),
          )
        : undefined,
    metadata:
      value.metadata &&
      typeof value.metadata === 'object' &&
      typeof (value.metadata as Record<string, unknown>).source === 'string'
        ? { source: (value.metadata as Record<string, string>).source }
        : undefined,
  }
}

function normalizeQuestion(
  question: unknown,
): AskUserQuestionInput['questions'][number] | null {
  if (!question || typeof question !== 'object') return null
  const value = question as Record<string, unknown>
  return {
    question: typeof value.question === 'string' ? value.question : '',
    header: typeof value.header === 'string' ? value.header : '',
    options: Array.isArray(value.options)
      ? value.options.map(option => normalizeOption(option)).filter(isPresent)
      : [],
    multiSelect: value.multiSelect === true,
  }
}

function normalizeOption(
  option: unknown,
): AskUserQuestionInput['questions'][number]['options'][number] | null {
  if (!option || typeof option !== 'object') return null
  const value = option as Record<string, unknown>
  return {
    label: typeof value.label === 'string' ? value.label : '',
    description: typeof value.description === 'string' ? value.description : '',
    preview: typeof value.preview === 'string' ? value.preview : undefined,
  }
}

function normalizeAnnotation(
  annotation: unknown,
): NonNullable<AskUserQuestionInput['annotations']>[string] {
  if (!annotation || typeof annotation !== 'object') return {}
  const value = annotation as Record<string, unknown>
  return {
    preview: typeof value.preview === 'string' ? value.preview : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  }
}

function validateQuestions(input: AskUserQuestionInput): string | null {
  if (input.questions.length < 1 || input.questions.length > 4) {
    return 'AskUserQuestion requires between 1 and 4 questions.'
  }
  const seenQuestions = new Set<string>()
  for (const question of input.questions) {
    if (!question.question.trim()) return 'Each question needs non-empty text.'
    if (seenQuestions.has(question.question)) {
      return `Duplicate question text: ${question.question}`
    }
    seenQuestions.add(question.question)
    if (!question.header.trim()) return 'Each question needs a header.'
    if (question.header.trim().length > 12) {
      return `Question header must be 12 characters or fewer: ${question.header}`
    }
    if (question.options.length < 2 || question.options.length > 4) {
      return `Question "${question.question}" requires between 2 and 4 options.`
    }
    const seenLabels = new Set<string>()
    for (const option of question.options) {
      if (!option.label.trim() || !option.description.trim()) {
        return `Question "${question.question}" has an incomplete option.`
      }
      if (seenLabels.has(option.label)) {
        return `Question "${question.question}" has duplicate option label "${option.label}".`
      }
      seenLabels.add(option.label)
    }
  }
  return null
}

function buildContinuation(output: AskUserQuestionOutput): string {
  const lines = ['User has answered your questions:']
  for (const question of output.questions) {
    const answer = output.answers[question.question] ?? '(no answer)'
    lines.push(`${question.question}: ${answer}`)
  }
  lines.push('')
  lines.push('You can now continue the task with this operator guidance.')
  return lines.join('\n')
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata }
}

function failed(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: false, content, metadata }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}
