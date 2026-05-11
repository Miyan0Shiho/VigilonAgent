import { useCallback, useRef } from 'react'

/**
 * Returns a stable callback whose implementation always points at the latest
 * handler. This mirrors the behavior we need from `useEffectEvent` without
 * depending on renderer support for the React 19 dispatcher API.
 */
export function useStableEvent<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  return useCallback((...args: TArgs) => handlerRef.current(...args), [])
}
