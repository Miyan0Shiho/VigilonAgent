type HeaderBag =
  | Headers
  | Record<string, string | null | undefined>
  | undefined

type HeaderCarrier = {
  headers?: HeaderBag
}

export function getHeaderValue(
  source: HeaderCarrier | undefined,
  headerName: string,
): string | null {
  const headers = source?.headers
  if (!headers) {
    return null
  }

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(headerName)
  }

  const normalizedName = headerName.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return value ?? null
    }
  }

  return null
}

export function getHeaderNames(source: HeaderCarrier | undefined): string[] {
  const headers = source?.headers
  if (!headers) {
    return []
  }

  if (typeof (headers as Headers).forEach === 'function') {
    const names: string[] = []
    ;(headers as Headers).forEach((_, key) => names.push(key))
    return names
  }

  return Object.keys(headers)
}
