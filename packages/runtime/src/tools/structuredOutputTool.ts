import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'

const VALID_FORMATS = ['json', 'yaml', 'csv', 'markdown-table'] as const
type OutputFormat = (typeof VALID_FORMATS)[number]

export const StructuredOutputTool: Tool = {
  name: 'StructuredOutput',
  description:
    'Produces structured output (JSON, YAML, CSV, or markdown table) that ' +
    'downstream tools or scripts can consume. Use this when you need to output ' +
    'machine-parseable data rather than prose.',
  readOnly: true,
  searchTerms: ['structured output', 'json', 'yaml', 'csv', 'table', 'parseable'],
  inputJsonSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: [...VALID_FORMATS],
        description: 'Output format',
      },
      data: {
        type: 'string',
        description:
          'The structured content. For JSON/YAML: valid JSON string. ' +
          'For CSV: comma-separated rows with optional header. ' +
          'For markdown-table: pipe-delimited table rows.',
      },
      schema: {
        type: 'string',
        description:
          'Optional JSON Schema to validate the output against. Only applies to JSON format.',
      },
    },
    required: ['format', 'data'],
    additionalProperties: false,
  },
  async invoke(input: unknown, _context: ToolUseContext): Promise<ToolResult> {
    const { format, data, schema } = input as {
      format: OutputFormat
      data: string
      schema?: string
    }

    if (!VALID_FORMATS.includes(format)) {
      return failed(`Unsupported format: ${format}. Valid: ${VALID_FORMATS.join(', ')}`)
    }

    // Validate JSON output against optional schema
    if (format === 'json' && schema) {
      try {
        const parsed = JSON.parse(data)
        const schemaObj = JSON.parse(schema)
        const errors = validateJsonSchema(parsed, schemaObj)
        if (errors.length > 0) {
          return failed(`Schema validation failed:\n${errors.join('\n')}`)
        }
        return ok(formatStructuredOutput(format, parsed), {
          format,
          validated: true,
        })
      } catch (err) {
        return failed(
          `Invalid JSON or schema: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // For JSON/YAML, validate parseable
    if (format === 'json' || format === 'yaml') {
      try {
        JSON.parse(data)
      } catch {
        return failed(`Invalid ${format.toUpperCase()}: could not parse`)
      }
    }

    return ok(formatStructuredOutput(format, data), { format })
  },
}

function formatStructuredOutput(format: OutputFormat, data: unknown): string {
  const fence = format === 'json' ? 'json' : format === 'yaml' ? 'yaml' : ''
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  if (!fence) return body
  return '```' + fence + '\n' + body + '\n```'
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { ok: true, content, metadata, toolCallId: '' }
}

function failed(reason: string, metadata?: Record<string, unknown>): ToolResult {
  return { ok: false, content: reason, metadata, toolCallId: '' }
}

/** Minimal JSON Schema keyword validation. */
function validateJsonSchema(
  instance: unknown,
  schema: Record<string, unknown>,
  path = '$',
): string[] {
  const errors: string[] = []

  if (schema.type === 'object' && typeof instance === 'object' && instance !== null) {
    const required = (schema.required as string[] | undefined) ?? []
    const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {}

    for (const key of required) {
      if (!(key in (instance as Record<string, unknown>))) {
        errors.push(`${path}.${key}: required property missing`)
      }
    }
    for (const [key, value] of Object.entries(instance as Record<string, unknown>)) {
      const propSchema = props[key]
      if (propSchema) {
        errors.push(...validateJsonSchema(value, propSchema, `${path}.${key}`))
      }
    }
  } else if (schema.type === 'array' && Array.isArray(instance)) {
    const itemSchema = (schema.items as Record<string, unknown> | undefined) ?? {}
    for (let i = 0; i < instance.length; i++) {
      errors.push(...validateJsonSchema(instance[i], itemSchema, `${path}[${i}]`))
    }
  } else if (schema.type === 'string' && typeof instance !== 'string') {
    errors.push(`${path}: expected string, got ${typeof instance}`)
  } else if (schema.type === 'number' && typeof instance !== 'number') {
    errors.push(`${path}: expected number, got ${typeof instance}`)
  } else if (schema.type === 'boolean' && typeof instance !== 'boolean') {
    errors.push(`${path}: expected boolean, got ${typeof instance}`)
  }

  return errors
}
