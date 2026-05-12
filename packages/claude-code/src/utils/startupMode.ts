const FIRST_PARTY_ANTHROPIC_HOSTS = new Set([
  'api.anthropic.com',
  'api-staging.anthropic.com',
])

/**
 * Third-party gateways reuse the Anthropic-compatible API surface, but they do
 * not support Anthropic's startup-only flows such as OAuth, GrowthBook gates,
 * Grove, or channel entitlement checks.
 */
export function isCustomApiGatewayMode(
  baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL,
): boolean {
  if (!baseUrl) {
    return false
  }

  try {
    const host = new URL(baseUrl).host
    return !FIRST_PARTY_ANTHROPIC_HOSTS.has(host)
  } catch {
    return true
  }
}

export function shouldUseAnthropicStartupFlow(
  baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL,
): boolean {
  return !isCustomApiGatewayMode(baseUrl)
}

export function shouldPrefetchOfficialMcpRegistry(
  baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL,
): boolean {
  return shouldUseAnthropicStartupFlow(baseUrl)
}

export function shouldFetchClaudeAiMcpConfigs(
  baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL,
): boolean {
  return shouldUseAnthropicStartupFlow(baseUrl)
}

export function shouldCheckAnthropicMetrics(
  baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL,
): boolean {
  return shouldUseAnthropicStartupFlow(baseUrl)
}

export function shouldRunRipgrepStartupProbe(
  baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL,
): boolean {
  return shouldUseAnthropicStartupFlow(baseUrl)
}
