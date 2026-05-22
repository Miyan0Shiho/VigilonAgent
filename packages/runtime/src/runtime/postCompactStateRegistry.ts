import type {
  CompactRouteMetadata,
  PostCompactCleanupAction,
  PostCompactCleanupMetadata,
  PostCompactCleanupOperation,
  PostCompactCleanupPolicy,
  PostCompactCleanupTarget,
  RuntimeStateScope,
} from './contracts.js'

export type RuntimeStateResource = {
  target: PostCompactCleanupTarget
  scope: RuntimeStateScope
  action: PostCompactCleanupAction
  policy: PostCompactCleanupPolicy
  reason: string
  clearedSignal?: string
  count?: () => number
  clear?: () => void
}

export class PostCompactStateRegistry {
  readonly #resources: RuntimeStateResource[] = []

  register(resource: RuntimeStateResource): void {
    this.#resources.push(resource)
  }

  run(): PostCompactCleanupMetadata {
    const operations: PostCompactCleanupOperation[] = []
    const cleared: string[] = []

    for (const resource of this.#resources) {
      const beforeCount = resource.count?.()
      if (resource.action === 'cleared') {
        resource.clear?.()
      }
      const afterCount = resource.count?.()
      const operation: PostCompactCleanupOperation = {
        target: resource.target,
        scope: resource.scope,
        action: resource.action,
        policy: resource.policy,
        reason: resource.reason,
      }
      if (beforeCount !== undefined) operation.beforeCount = beforeCount
      if (afterCount !== undefined) operation.afterCount = afterCount
      operations.push(operation)
      if (resource.clearedSignal) cleared.push(resource.clearedSignal)
    }

    return {
      required: operations.length > 0,
      completed: true,
      cleared,
      operations,
    }
  }
}

export function createPostCompactStateRegistry(options: {
  route: CompactRouteMetadata
  lspOpenFileState?: Set<string>
  readFileState?: Map<unknown, unknown>
}): PostCompactStateRegistry {
  const scope = compactScopeForQuerySource(options.route.querySource)
  const registry = new PostCompactStateRegistry()

  registry.register({
    target: 'context-window',
    scope,
    action: 'scheduled',
    policy: 'rebuild-after-compact',
    clearedSignal: 'context-window-rebuild-required',
    reason: 'model context window must be rebuilt from the compact boundary',
  })
  registry.register({
    target: 'content-replacement-window',
    scope,
    action: 'scheduled',
    policy: 'rebuild-after-compact',
    clearedSignal: 'content-replacement-pending-window',
    reason: 'large tool-result replacement window must be recalculated after compact',
  })
  registry.register({
    target: 'capability-replay',
    scope,
    action: 'scheduled',
    policy: 'replay-after-compact',
    clearedSignal: 'capability-replay-required',
    reason: 'capability and runtime-state replay is required on the first post-compact request',
  })

  if (options.lspOpenFileState) {
    registry.register({
      target: 'lsp-open-file-state',
      scope,
      action: 'cleared',
      policy: 'rebuild-after-compact',
      reason: 'LSP open-file cache is model-context scoped and can be rebuilt from disk',
      count: () => options.lspOpenFileState?.size ?? 0,
      clear: () => options.lspOpenFileState?.clear(),
    })
  }

  if (options.readFileState) {
    registry.register({
      target: 'read-file-state',
      scope,
      action: 'preserved',
      policy: 'preserve-safety-state',
      reason: 'read-before-write safety state must survive compact',
      count: () => options.readFileState?.size ?? 0,
    })
  }

  registry.register({
    target: 'compact-state',
    scope,
    action: 'cleared',
    policy: 'discard-after-boundary',
    clearedSignal:
      scope === 'main'
        ? 'main-thread-compact-state'
        : 'agent-scoped-compact-state',
    reason:
      scope === 'main'
        ? 'main-thread compact state cleared after boundary insertion'
        : 'agent-scoped compact state cleared after boundary insertion',
  })

  return registry
}

function compactScopeForQuerySource(querySource: CompactRouteMetadata['querySource']): RuntimeStateScope {
  if (querySource.startsWith('agent:')) return querySource as `agent:${string}`
  return 'main'
}
