import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildMcpToolName,
  createMutablePermissionGate,
  InMemoryTranscriptStore,
  loadRuntimeMcpTools,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('runtime MCP loading', () => {
  it('builds Claude-style fully qualified MCP tool names', () => {
    expect(buildMcpToolName('local server', 'echo.tool')).toBe(
      'mcp__local_server__echo_tool',
    )
  })

  it('loads local stdio MCP tools and invokes them through ToolUseContext', async () => {
    const cwd = await createTempRoot('vigilon-mcp-')
    const serverPath = path.join(cwd, 'fake-mcp-server.js')
    await writeFile(serverPath, fakeMcpServerSource())
    await chmod(serverPath, 0o755)

    const loaded = await loadRuntimeMcpTools({
      cwd,
      servers: {
        local: {
          type: 'stdio',
          command: process.execPath,
          args: [serverPath],
        },
      },
    })
    try {
      expect(loaded.servers).toMatchObject([{ type: 'connected', name: 'local' }])
      expect(loaded.tools.map(tool => tool.name)).toEqual([
        'mcp__local__echo',
      ])

      const transcript = new InMemoryTranscriptStore()
      const result = await loaded.tools[0]?.invoke(
        { text: 'hello mcp' },
        {
          cwd,
          abortSignal: new AbortController().signal,
          permissionGate: createMutablePermissionGate({
            mode: 'bypass-local',
            transcript,
          }),
          transcript,
        },
      )

      expect(result).toMatchObject({
        ok: true,
        content: 'echo: hello mcp',
      })
      expect((await transcript.readAll()).map(event => event.type)).toContain(
        'permission',
      )
    } finally {
      loaded.close()
    }
  })

  it('surfaces MCP server connection failures without throwing away other servers', async () => {
    const cwd = await createTempRoot('vigilon-mcp-failure-')
    const serverPath = path.join(cwd, 'fake-mcp-server.js')
    await writeFile(serverPath, fakeMcpServerSource())

    const loaded = await loadRuntimeMcpTools({
      cwd,
      servers: {
        good: { command: process.execPath, args: [serverPath] },
        bad: { command: process.execPath, args: ['missing-server.js'] },
      },
    })
    try {
      expect(loaded.servers.map(server => server.type).sort()).toEqual([
        'connected',
        'failed',
      ])
      expect(loaded.tools).toHaveLength(1)
    } finally {
      loaded.close()
    }
  })

  it('adds read-only MCP resource tools for servers with resources', async () => {
    const cwd = await createTempRoot('vigilon-mcp-resources-')
    const serverPath = path.join(cwd, 'fake-mcp-resource-server.js')
    await writeFile(serverPath, fakeMcpResourceServerSource())

    const loaded = await loadRuntimeMcpTools({
      cwd,
      servers: {
        local: { command: process.execPath, args: [serverPath] },
      },
    })
    try {
      expect(loaded.resources).toEqual([
        {
          uri: 'memory://note',
          name: 'note',
          mimeType: 'text/plain',
          description: 'A note',
          server: 'local',
        },
      ])
      expect(loaded.tools.map(tool => tool.name)).toEqual([
        'ListMcpResourcesTool',
        'ReadMcpResourceTool',
      ])

      const transcript = new InMemoryTranscriptStore()
      const context = {
        cwd,
        abortSignal: new AbortController().signal,
        permissionGate: createMutablePermissionGate({
          mode: 'read-only',
          transcript,
        }),
        transcript,
      }
      const listResult = await loaded.tools[0]?.invoke({}, context)
      expect(listResult).toMatchObject({
        ok: true,
        content: expect.stringContaining('memory://note'),
      })

      const readResult = await loaded.tools[1]?.invoke(
        { server: 'local', uri: 'memory://note' },
        context,
      )
      expect(readResult).toMatchObject({
        ok: true,
        content: expect.stringContaining('resource text'),
      })
      expect((await transcript.readAll()).map(event => event.type)).toEqual([
        'permission',
        'permission',
      ])
    } finally {
      loaded.close()
    }
  })

  it('persists binary MCP resource blobs outside model context', async () => {
    const cwd = await createTempRoot('vigilon-mcp-blob-')
    const serverPath = path.join(cwd, 'fake-mcp-blob-server.js')
    await writeFile(serverPath, fakeMcpBlobServerSource())

    const loaded = await loadRuntimeMcpTools({
      cwd,
      servers: {
        local: { command: process.execPath, args: [serverPath] },
      },
    })
    try {
      const readTool = loaded.tools.find(tool => tool.name === 'ReadMcpResourceTool')
      const transcript = new InMemoryTranscriptStore()
      const result = await readTool?.invoke(
        { server: 'local', uri: 'blob://artifact' },
        {
          cwd,
          abortSignal: new AbortController().signal,
          permissionGate: createMutablePermissionGate({
            mode: 'read-only',
            transcript,
          }),
          transcript,
        },
      )

      expect(result?.ok).toBe(true)
      expect(result?.content).toContain('blobSavedTo')
      expect(result?.content).toContain('.vigilon/mcp-resources')
      expect(result?.content).not.toContain(Buffer.from('binary-data').toString('base64'))
    } finally {
      loaded.close()
    }
  })
})

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function fakeMcpServerSource(): string {
  return `#!/usr/bin/env node
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', line => {
  const request = JSON.parse(line)
  if (request.method === 'initialize') {
    respond(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-mcp', version: '0.0.0' }
    })
    return
  }
  if (request.method === 'notifications/initialized') return
  if (request.method === 'tools/list') {
    respond(request.id, {
      tools: [{
        name: 'echo',
        description: 'Echo text',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: true }
      }]
    })
    return
  }
  if (request.method === 'tools/call') {
    respond(request.id, {
      content: [{ type: 'text', text: 'echo: ' + request.params.arguments.text }]
    })
    return
  }
  respond(request.id, null)
})
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
}
`
}

function fakeMcpResourceServerSource(): string {
  return `#!/usr/bin/env node
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', line => {
  const request = JSON.parse(line)
  if (request.method === 'initialize') {
    respond(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { resources: {} },
      serverInfo: { name: 'fake-mcp', version: '0.0.0' }
    })
    return
  }
  if (request.method === 'notifications/initialized') return
  if (request.method === 'tools/list') {
    respond(request.id, { tools: [] })
    return
  }
  if (request.method === 'resources/list') {
    respond(request.id, {
      resources: [{
        uri: 'memory://note',
        name: 'note',
        mimeType: 'text/plain',
        description: 'A note'
      }]
    })
    return
  }
  if (request.method === 'resources/read') {
    respond(request.id, {
      contents: [{
        uri: request.params.uri,
        mimeType: 'text/plain',
        text: 'resource text'
      }]
    })
    return
  }
  respond(request.id, null)
})
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
}
`
}

function fakeMcpBlobServerSource(): string {
  const blob = Buffer.from('binary-data').toString('base64')
  return `#!/usr/bin/env node
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', line => {
  const request = JSON.parse(line)
  if (request.method === 'initialize') {
    respond(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { resources: {} },
      serverInfo: { name: 'fake-mcp', version: '0.0.0' }
    })
    return
  }
  if (request.method === 'notifications/initialized') return
  if (request.method === 'tools/list') {
    respond(request.id, { tools: [] })
    return
  }
  if (request.method === 'resources/list') {
    respond(request.id, {
      resources: [{ uri: 'blob://artifact', name: 'artifact', mimeType: 'application/octet-stream' }]
    })
    return
  }
  if (request.method === 'resources/read') {
    respond(request.id, {
      contents: [{
        uri: request.params.uri,
        mimeType: 'application/octet-stream',
        blob: '${blob}'
      }]
    })
    return
  }
  respond(request.id, null)
})
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
}
`
}
