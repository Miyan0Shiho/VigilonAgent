import type { Tool } from './contracts.js'

export class ToolRegistry {
  private readonly toolsByName = new Map<string, Tool>()

  constructor(tools: readonly Tool[] = []) {
    for (const tool of tools) {
      this.register(tool)
    }
  }

  register(tool: Tool): void {
    if (this.toolsByName.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    this.toolsByName.set(tool.name, tool)
  }

  list(): Tool[] {
    return [...this.toolsByName.values()]
  }

  find(name: string): Tool | undefined {
    return this.toolsByName.get(name)
  }
}

export function createToolRegistry(tools: readonly Tool[] = []): ToolRegistry {
  return new ToolRegistry(tools)
}
