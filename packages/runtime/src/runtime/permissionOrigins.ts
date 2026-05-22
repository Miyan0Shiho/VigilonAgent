import type {
  PermissionOrigin,
  PermissionOriginSummary,
  PermissionRequest,
  TranscriptEvent,
} from './contracts.js'

type PermissionEvent = Extract<TranscriptEvent, { type: 'permission' }>

type Counter = {
  count: number
  allowed: number
  denied: number
}

type AgentCounter = Counter & {
  origin: PermissionOrigin
  tools: Set<string>
}

export function withToolPermissionOrigin(
  origin: PermissionOrigin | undefined,
  toolName: string,
): PermissionOrigin {
  return {
    ...(origin ?? {
      agentId: 'main',
      agentRole: 'main' as const,
    }),
    toolName,
  }
}

export function buildPermissionOriginSummary(
  events: readonly TranscriptEvent[],
): PermissionOriginSummary {
  const actions = new Map<PermissionRequest['action'], Counter>()
  const risks = new Map<PermissionRequest['risk'], Counter>()
  const agents = new Map<string, AgentCounter>()
  const tools = new Map<string, Counter>()
  const resolutionSources = new Map<string, number>()
  let totalRequests = 0
  let allowed = 0
  let denied = 0
  let latest: PermissionOriginSummary['latest']

  for (const event of events) {
    if (event.type !== 'permission') continue
    const permissionEvent = event as PermissionEvent
    const eventAllowed = permissionEvent.decision.allowed
    totalRequests += 1
    if (eventAllowed) allowed += 1
    else denied += 1

    incrementCounter(actions, permissionEvent.request.action, eventAllowed)
    incrementCounter(risks, permissionEvent.request.risk, eventAllowed)

    const origin = permissionEvent.request.origin ?? permissionEvent.decision.origin
    if (origin) {
      const agentKey = [
        origin.agentRole,
        origin.agentId,
        origin.parentAgentId ?? '',
      ].join('\0')
      let agent = agents.get(agentKey)
      if (!agent) {
        agent = {
          origin,
          tools: new Set<string>(),
          count: 0,
          allowed: 0,
          denied: 0,
        }
        agents.set(agentKey, agent)
      }
      incrementMutableCounter(agent, eventAllowed)
      if (origin.toolName) agent.tools.add(origin.toolName)
      if (origin.toolName) {
        incrementCounter(tools, origin.toolName, eventAllowed)
      }
    }

    const resolutionSource = permissionEvent.decision.resolution?.source ?? 'unknown'
    resolutionSources.set(
      resolutionSource,
      (resolutionSources.get(resolutionSource) ?? 0) + 1,
    )
    latest = {
      timestamp: permissionEvent.timestamp,
      action: permissionEvent.request.action,
      subject: permissionEvent.request.subject,
      risk: permissionEvent.request.risk,
      allowed: eventAllowed,
      reason: permissionEvent.decision.reason,
      ...(origin ? { origin } : {}),
      ...(permissionEvent.request.policy ? { policy: permissionEvent.request.policy } : {}),
    }
  }

  return {
    totalRequests,
    allowed,
    denied,
    actions: sortCounters(actions).map(([action, counter]) => ({
      action,
      ...counter,
    })),
    risks: sortCounters(risks).map(([risk, counter]) => ({
      risk,
      ...counter,
    })),
    agents: [...agents.values()]
      .sort((left, right) => compareCounterThenKey(
        left,
        right,
        `${left.origin.agentRole}:${left.origin.agentId}:${left.origin.parentAgentId ?? ''}`,
        `${right.origin.agentRole}:${right.origin.agentId}:${right.origin.parentAgentId ?? ''}`,
      ))
      .map(agent => ({
        agentId: agent.origin.agentId,
        agentRole: agent.origin.agentRole,
        ...(agent.origin.parentAgentId ? { parentAgentId: agent.origin.parentAgentId } : {}),
        count: agent.count,
        allowed: agent.allowed,
        denied: agent.denied,
        tools: [...agent.tools].sort(),
      })),
    tools: sortCounters(tools).map(([toolName, counter]) => ({
      toolName,
      ...counter,
    })),
    resolutionSources: [...resolutionSources.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([source, count]) => ({ source, count })),
    ...(latest ? { latest } : {}),
  }
}

export function renderPermissionOriginSummary(
  summary: PermissionOriginSummary,
): string[] {
  if (summary.totalRequests === 0) return ['permissions=none']
  const agentSummary = summary.agents
    .map(agent => {
      const parent = agent.parentAgentId ? `<-${agent.parentAgentId}` : ''
      const tools = agent.tools.length ? ` tools=${agent.tools.join(',')}` : ''
      return `${agent.agentRole}:${agent.agentId}${parent} count=${agent.count} allow=${agent.allowed} deny=${agent.denied}${tools}`
    })
    .join('; ')
  const actionSummary = summary.actions
    .map(action => `${action.action}:${action.count}`)
    .join(',')
  const latest = summary.latest
    ? `latest=${summary.latest.action}:${summary.latest.allowed ? 'allow' : 'deny'}:${summary.latest.subject}`
    : undefined
  return [
    `permissions=${summary.totalRequests} allow=${summary.allowed} deny=${summary.denied}`,
    actionSummary ? `permissionActions=${actionSummary}` : undefined,
    agentSummary ? `permissionOrigins=${agentSummary}` : undefined,
    latest,
  ].filter((line): line is string => Boolean(line))
}

function incrementCounter<K>(
  map: Map<K, Counter>,
  key: K,
  allowed: boolean,
): void {
  let counter = map.get(key)
  if (!counter) {
    counter = { count: 0, allowed: 0, denied: 0 }
    map.set(key, counter)
  }
  incrementMutableCounter(counter, allowed)
}

function incrementMutableCounter(counter: Counter, allowed: boolean): void {
  counter.count += 1
  if (allowed) counter.allowed += 1
  else counter.denied += 1
}

function sortCounters<K extends string>(map: Map<K, Counter>): Array<[K, Counter]> {
  return [...map.entries()].sort((left, right) =>
    compareCounterThenKey(left[1], right[1], left[0], right[0]),
  )
}

function compareCounterThenKey(
  left: Counter,
  right: Counter,
  leftKey: string,
  rightKey: string,
): number {
  return right.count - left.count || leftKey.localeCompare(rightKey)
}
