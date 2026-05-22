import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  RuntimeMcpServerConfig,
  Tool,
  ToolResult,
  ToolUseContext,
} from './contracts.js'
import { withToolPermissionOrigin } from './permissionOrigins.js'

export type RuntimeMcpTool = Tool & {
  mcpInfo: {
    serverName: string
    toolName: string
  }
}

export type RuntimeMcpServerState =
  | {
      type: 'connected'
      name: string
      client: RuntimeMcpStdioClient
      tools: RuntimeMcpTool[]
      supportsResources: boolean
    }
  | {
      type: 'failed'
      name: string
      error: string
    }

export type LoadedRuntimeMcp = {
  servers: RuntimeMcpServerState[]
  tools: Tool[]
  resources: RuntimeMcpResource[]
  close(): void
}

type McpToolDefinition = {
  name: string
  description?: string
  inputSchema?: Tool['inputJsonSchema']
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
  }
  _meta?: Record<string, unknown>
}

export type RuntimeMcpResource = {
  uri: string
  name: string
  mimeType?: string
  description?: string
  server: string
}

type McpResourceContent = {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

type McpReadResourceResult = {
  contents?: McpResourceContent[]
}

type JsonRpcResponse = {
  id?: number
  method?: string
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

export async function loadRuntimeMcpTools(options: {
  servers?: Record<string, RuntimeMcpServerConfig>
  cwd: string
  env?: NodeJS.ProcessEnv
}): Promise<LoadedRuntimeMcp> {
  const entries = Object.entries(options.servers ?? {})
  const states: RuntimeMcpServerState[] = []

  for (const [name, config] of entries) {
    try {
      const client = new RuntimeMcpStdioClient({
        name,
        config,
        cwd: options.cwd,
        env: options.env,
      })
      await client.connect()
      const tools = (await client.listTools()).map(tool =>
        createRuntimeMcpTool(name, tool, client),
      )
      states.push({
        type: 'connected',
        name,
        client,
        tools,
        supportsResources: client.supportsResources(),
      })
    } catch (error) {
      states.push({
        type: 'failed',
        name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const resourceTools = createRuntimeMcpResourceTools(states, options.cwd)

  return {
    servers: states,
    tools: [
      ...states.flatMap(state => (state.type === 'connected' ? state.tools : [])),
      ...resourceTools,
    ],
    resources: (
      await Promise.all(
        states.map(state =>
          state.type === 'connected' && state.supportsResources
            ? state.client.listResources().catch(() => [])
            : Promise.resolve([]),
        ),
      )
    ).flat(),
    close() {
      for (const state of states) {
        if (state.type === 'connected') state.client.close()
      }
    },
  }
}

function createRuntimeMcpResourceTools(
  states: RuntimeMcpServerState[],
  cwd: string,
): Tool[] {
  const hasResourceServer = states.some(
    state => state.type === 'connected' && state.supportsResources,
  )
  if (!hasResourceServer) return []
  return [
    createListMcpResourcesTool(states),
    createReadMcpResourceTool(states, cwd),
  ]
}

function createListMcpResourcesTool(states: RuntimeMcpServerState[]): Tool {
  return {
    name: 'ListMcpResourcesTool',
    description: 'List resources from connected MCP servers.',
    readOnly: true,
    inputJsonSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Optional server name to filter resources by',
        },
      },
      additionalProperties: false,
    },
    async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
      const server = stringField(input, 'server')
      const clients = selectConnectedMcpServers(states, server)
      if (clients.length === 0 && server) {
        return {
          toolCallId: '',
          ok: false,
          content: serverNotFoundMessage(server, states),
        }
      }

	      const decision = await context.permissionGate.requestPermission({
	        action: 'read',
	        subject: server ? `MCP resources on ${server}` : 'MCP resources',
	        risk: 'low',
	        reason: 'List MCP resources',
	        origin: withToolPermissionOrigin(context.permissionOrigin, 'McpListResources'),
	      })
      if (!decision.allowed) {
        return { toolCallId: '', ok: false, content: decision.reason }
      }

      const resources = (
        await Promise.all(
          clients.map(async state => {
            if (!state.supportsResources) return []
            try {
              return await state.client.listResources()
            } catch {
              return []
            }
          }),
        )
      ).flat()

      return {
        toolCallId: '',
        ok: true,
        content:
          resources.length > 0
            ? JSON.stringify(resources, null, 2)
            : 'No resources found. MCP servers may still provide tools even if they have no resources.',
        metadata: { mcpResourceCount: resources.length },
      }
    },
  }
}

function createReadMcpResourceTool(
  states: RuntimeMcpServerState[],
  cwd: string,
): Tool {
  return {
    name: 'ReadMcpResourceTool',
    description: 'Read a specific MCP resource by server name and URI.',
    readOnly: true,
    inputJsonSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'The MCP server name' },
        uri: { type: 'string', description: 'The resource URI to read' },
      },
      required: ['server', 'uri'],
      additionalProperties: false,
    },
    async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
      const server = stringField(input, 'server')
      const uri = stringField(input, 'uri')
      if (!server || !uri) {
        return {
          toolCallId: '',
          ok: false,
          content: 'ReadMcpResourceTool requires server and uri',
        }
      }

      const state = selectConnectedMcpServers(states, server)[0]
      if (!state) {
        return { toolCallId: '', ok: false, content: serverNotFoundMessage(server, states) }
      }
      if (!state.supportsResources) {
        return {
          toolCallId: '',
          ok: false,
          content: `Server "${server}" does not support resources`,
        }
      }

	      const decision = await context.permissionGate.requestPermission({
	        action: 'read',
	        subject: `MCP resource ${server} ${uri}`,
	        risk: 'low',
	        reason: 'Read MCP resource',
	        origin: withToolPermissionOrigin(context.permissionOrigin, 'McpReadResource'),
	      })
      if (!decision.allowed) {
        return { toolCallId: '', ok: false, content: decision.reason }
      }

      try {
        const result = await state.client.readResource(uri)
        const contents = await formatMcpResourceContents({
          server,
          cwd,
          result,
        })
        return {
          toolCallId: '',
          ok: true,
          content: JSON.stringify({ contents }, null, 2),
          metadata: {
            mcpServer: server,
            mcpResourceUri: uri,
            mcpResourceContentCount: contents.length,
          },
        }
      } catch (error) {
        return {
          toolCallId: '',
          ok: false,
          content: `MCP resource ${server} ${uri} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      }
    },
  }
}

function selectConnectedMcpServers(
  states: RuntimeMcpServerState[],
  server?: string,
): Array<Extract<RuntimeMcpServerState, { type: 'connected' }>> {
  return states.filter(
    (state): state is Extract<RuntimeMcpServerState, { type: 'connected' }> =>
      state.type === 'connected' && (!server || state.name === server),
  )
}

function serverNotFoundMessage(
  server: string,
  states: RuntimeMcpServerState[],
): string {
  return `Server "${server}" not found. Available servers: ${states.map(state => state.name).join(', ')}`
}

function stringField(input: unknown, field: string): string | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined
  }
  const value = (input as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

async function formatMcpResourceContents(options: {
  server: string
  cwd: string
  result: McpReadResourceResult
}): Promise<Array<Omit<McpResourceContent, 'blob'> & { blobSavedTo?: string }>> {
  const contents = options.result.contents ?? []
  return Promise.all(
    contents.map(async (content, index) => {
      if (typeof content.text === 'string') {
        return {
          uri: content.uri,
          mimeType: content.mimeType,
          text: content.text,
        }
      }
      if (typeof content.blob !== 'string') {
        return {
          uri: content.uri,
          mimeType: content.mimeType,
        }
      }

      const saved = await persistMcpResourceBlob({
        cwd: options.cwd,
        server: options.server,
        uri: content.uri,
        mimeType: content.mimeType,
        blob: content.blob,
        index,
      })
      return {
        uri: content.uri,
        mimeType: content.mimeType,
        blobSavedTo: saved.filepath,
        text: `[Resource from ${options.server} at ${content.uri}] Binary content (${content.mimeType ?? 'unknown type'}, ${saved.size} bytes) saved to ${saved.filepath}`,
      }
    }),
  )
}

async function persistMcpResourceBlob(options: {
  cwd: string
  server: string
  uri: string
  mimeType?: string
  blob: string
  index: number
}): Promise<{ filepath: string; size: number }> {
  const dir = path.join(options.cwd, '.vigilon', 'mcp-resources')
  await mkdir(dir, { recursive: true })
  const bytes = Buffer.from(options.blob, 'base64')
  const filename = [
    'mcp-resource',
    normalizeNameForMcp(options.server),
    normalizeNameForMcp(options.uri).slice(0, 48),
    Date.now(),
    options.index,
  ].join('-')
  const filepath = path.join(dir, `${filename}.${extensionForMimeType(options.mimeType)}`)
  await writeFile(filepath, bytes)
  return { filepath, size: bytes.length }
}

function extensionForMimeType(mimeType: string | undefined): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  switch (normalized) {
    case 'application/json':
      return 'json'
    case 'application/pdf':
      return 'pdf'
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'text/csv':
      return 'csv'
    case 'text/html':
      return 'html'
    case 'text/markdown':
      return 'md'
    case 'text/plain':
      return 'txt'
    default:
      return 'bin'
  }
}

export function buildMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${normalizeNameForMcp(serverName)}__${normalizeNameForMcp(toolName)}`
}

export function normalizeNameForMcp(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function createRuntimeMcpTool(
  serverName: string,
  definition: McpToolDefinition,
  client: RuntimeMcpStdioClient,
): RuntimeMcpTool {
  const toolName = definition.name
  const name = buildMcpToolName(serverName, toolName)
  return {
    name,
    description: definition.description ?? `MCP tool ${serverName}/${toolName}`,
    inputJsonSchema: definition.inputSchema ?? {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
    readOnly: definition.annotations?.readOnlyHint ?? false,
    mcpInfo: { serverName, toolName },
    async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
	      const decision = await context.permissionGate.requestPermission({
	        action: 'external-tool',
	        subject: name,
	        risk: definition.annotations?.readOnlyHint ? 'low' : 'medium',
	        reason: `Invoke MCP tool ${serverName}/${toolName}`,
	        origin: withToolPermissionOrigin(context.permissionOrigin, `MCP:${serverName}/${toolName}`),
	      })
      if (!decision.allowed) {
        return {
          toolCallId: '',
          ok: false,
          content: decision.reason,
        }
      }
      try {
        const result = await client.callTool(toolName, asRecord(input), context.abortSignal)
        return {
          toolCallId: '',
          ok: true,
          content: formatMcpToolResult(result),
          metadata: {
            mcpServer: serverName,
            mcpTool: toolName,
          },
        }
      } catch (error) {
        return {
          toolCallId: '',
          ok: false,
          content: `MCP tool ${serverName}/${toolName} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      }
    },
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function formatMcpToolResult(result: unknown): string {
  if (typeof result === 'object' && result !== null && 'content' in result) {
    const content = (result as { content?: unknown }).content
    if (Array.isArray(content)) {
      return content
        .map(item => {
          if (
            typeof item === 'object' &&
            item !== null &&
            'text' in item &&
            typeof (item as { text?: unknown }).text === 'string'
          ) {
            return (item as { text: string }).text
          }
          return JSON.stringify(item)
        })
        .join('\n')
    }
  }
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
}

export class RuntimeMcpStdioClient {
  private process?: ChildProcessWithoutNullStreams
  private nextId = 1
  private buffer = ''
  private capabilities?: Record<string, unknown>
  private resourcesCache?: RuntimeMcpResource[]
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
    }
  >()

  constructor(
    private readonly options: {
      name: string
      config: RuntimeMcpServerConfig
      cwd: string
      env?: NodeJS.ProcessEnv
    },
  ) {}

  async connect(): Promise<void> {
    if (this.options.config.type && this.options.config.type !== 'stdio') {
      throw new Error(`Unsupported MCP transport for ${this.options.name}`)
    }
    this.process = spawn(this.options.config.command, this.options.config.args ?? [], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ...(this.options.env ?? {}),
        ...(this.options.config.env ?? {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.process.stdout.on('data', chunk => this.handleStdout(String(chunk)))
    this.process.once('exit', (code, signal) => {
      const error = new Error(
        `MCP server ${this.options.name} exited (${code ?? signal ?? 'unknown'})`,
      )
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })
    this.process.stderr.on('data', () => {
      // Stderr is intentionally not surfaced unless a request fails; many MCP
      // servers use it for diagnostics.
    })

    const initResult = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'vigilon-runtime',
        version: '0.1.0',
      },
    })
    this.capabilities = readCapabilities(initResult)
    this.notify('notifications/initialized', {})
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request('tools/list', {})
    if (
      typeof result !== 'object' ||
      result === null ||
      !Array.isArray((result as { tools?: unknown }).tools)
    ) {
      throw new Error(`MCP server ${this.options.name} returned invalid tools/list`)
    }
    return (result as { tools: McpToolDefinition[] }).tools
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) {
      return Promise.reject(new Error('MCP tool call aborted'))
    }
    return this.request('tools/call', {
      name,
      arguments: args,
    })
  }

  supportsResources(): boolean {
    return Boolean(this.capabilities?.resources)
  }

  async listResources(): Promise<RuntimeMcpResource[]> {
    if (!this.supportsResources()) return []
    if (this.resourcesCache) return this.resourcesCache
    const result = await this.request('resources/list', {})
    if (
      typeof result !== 'object' ||
      result === null ||
      !Array.isArray((result as { resources?: unknown }).resources)
    ) {
      throw new Error(`MCP server ${this.options.name} returned invalid resources/list`)
    }
    this.resourcesCache = (result as { resources: Array<Omit<RuntimeMcpResource, 'server'>> })
      .resources.map(resource => ({
        ...resource,
        server: this.options.name,
      }))
    return this.resourcesCache
  }

  async readResource(uri: string): Promise<McpReadResourceResult> {
    if (!this.supportsResources()) {
      throw new Error(`MCP server ${this.options.name} does not support resources`)
    }
    const result = await this.request('resources/read', { uri })
    if (
      typeof result !== 'object' ||
      result === null ||
      !Array.isArray((result as { contents?: unknown }).contents)
    ) {
      throw new Error(`MCP server ${this.options.name} returned invalid resources/read`)
    }
    return result as McpReadResourceResult
  }

  close(): void {
    this.process?.kill()
    this.process = undefined
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    this.write({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private write(message: unknown): void {
    if (!this.process) throw new Error(`MCP server ${this.options.name} is not connected`)
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const newlineIndex = this.buffer.indexOf('\n')
      if (newlineIndex === -1) return
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (!line) continue
      this.handleMessage(JSON.parse(line) as JsonRpcResponse)
    }
  }

  private handleMessage(message: JsonRpcResponse): void {
    if (isResourceListChangedNotification(message)) {
      this.resourcesCache = undefined
      return
    }
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(message.error.message ?? `MCP error ${message.error.code}`))
      return
    }
    pending.resolve(message.result)
  }
}

function readCapabilities(result: unknown): Record<string, unknown> | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const capabilities = (result as { capabilities?: unknown }).capabilities
  return typeof capabilities === 'object' && capabilities !== null
    ? (capabilities as Record<string, unknown>)
    : undefined
}

function isResourceListChangedNotification(message: JsonRpcResponse): boolean {
  return (
    message.method === 'resources/list_changed' ||
    message.method === 'notifications/resources/list_changed'
  )
}
