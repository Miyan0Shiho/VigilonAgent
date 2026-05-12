import { describe, expect, it } from 'vitest'
import {
  shouldCheckAnthropicMetrics,
  shouldFetchClaudeAiMcpConfigs,
  shouldRunRipgrepStartupProbe,
  isCustomApiGatewayMode,
  shouldPrefetchOfficialMcpRegistry,
  shouldUseAnthropicStartupFlow,
} from './utils/startupMode'

describe('startupMode', () => {
  it('treats third-party gateways as custom API mode', () => {
    expect(isCustomApiGatewayMode(undefined)).toBe(false)
    expect(isCustomApiGatewayMode('https://api.anthropic.com')).toBe(false)
    expect(isCustomApiGatewayMode('https://api.deepseek.com/v1')).toBe(true)
  })

  it('keeps Anthropic startup flow only for first-party endpoints', () => {
    expect(shouldUseAnthropicStartupFlow(undefined)).toBe(true)
    expect(shouldUseAnthropicStartupFlow('https://api.anthropic.com')).toBe(
      true,
    )
    expect(
      shouldUseAnthropicStartupFlow('https://api-staging.anthropic.com'),
    ).toBe(true)
    expect(shouldUseAnthropicStartupFlow('https://api.deepseek.com/v1')).toBe(
      false,
    )
  })

  it('disables official Anthropic MCP registry prefetch for third-party gateways', () => {
    expect(shouldPrefetchOfficialMcpRegistry(undefined)).toBe(true)
    expect(shouldPrefetchOfficialMcpRegistry('https://api.anthropic.com')).toBe(
      true,
    )
    expect(
      shouldPrefetchOfficialMcpRegistry('https://api.deepseek.com/v1'),
    ).toBe(false)
  })

  it('disables claude.ai MCP fetches for third-party gateways', () => {
    expect(shouldFetchClaudeAiMcpConfigs(undefined)).toBe(true)
    expect(shouldFetchClaudeAiMcpConfigs('https://api.anthropic.com')).toBe(
      true,
    )
    expect(shouldFetchClaudeAiMcpConfigs('https://api.deepseek.com/v1')).toBe(
      false,
    )
  })

  it('disables Anthropic org telemetry checks for third-party gateways', () => {
    expect(shouldCheckAnthropicMetrics(undefined)).toBe(true)
    expect(shouldCheckAnthropicMetrics('https://api.anthropic.com')).toBe(true)
    expect(shouldCheckAnthropicMetrics('https://api.deepseek.com/v1')).toBe(
      false,
    )
  })

  it('disables the ripgrep startup probe for third-party gateways', () => {
    expect(shouldRunRipgrepStartupProbe(undefined)).toBe(true)
    expect(shouldRunRipgrepStartupProbe('https://api.anthropic.com')).toBe(
      true,
    )
    expect(shouldRunRipgrepStartupProbe('https://api.deepseek.com/v1')).toBe(
      false,
    )
  })
})
