export function normalizeAnthropicBaseUrl(
  baseUrl: string | undefined,
): string | undefined {
  if (!baseUrl) {
    return baseUrl
  }

  try {
    const url = new URL(baseUrl)
    url.pathname = url.pathname.replace(/\/v1\/?$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  } catch {
    return baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')
  }
}
