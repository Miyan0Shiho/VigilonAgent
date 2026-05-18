import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js';

export const ToolSearchTool: Tool = {
  name: 'ToolSearch',
  description: 'Searches for available tools by name or description. Use this when you need a capability that is not currently in your tool pool.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query (e.g., "git", "file manipulation", "mcp")' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const { query } = input as { query: string };
    const lowercaseQuery = query.toLowerCase();
    
    const deferredTools = context.tools.list().filter(t => t.deferred);
    const matches = deferredTools.filter(t => 
      t.name.toLowerCase().includes(lowercaseQuery) || 
      t.description.toLowerCase().includes(lowercaseQuery)
    );

    if (matches.length === 0) {
      return ok(`No deferred tools found matching "${query}".`);
    }

    const results = matches.map(t => {
      return `Tool: ${t.name}\nDescription: ${t.description}\n` +
             `To use this tool, you can now call it directly in your next turn. ` +
             `Its schema has been "materialized" for you.`;
    }).join('\n\n');

    return ok(`Found ${matches.length} matching deferred tools:\n\n${results}`, {
      discoveredTools: matches.map(t => t.name)
    });
  },
};

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata };
}
