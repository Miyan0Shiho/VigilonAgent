type CompleteTrustAcceptanceArgs = {
  isHomeDir: boolean
  setSessionTrustAccepted: (accepted: boolean) => void
  persistProjectTrust: () => void
  onDone: () => void
  logFailure: (error: unknown) => void
}

/**
 * Trust must unlock the current session even when persistence fails.
 * Otherwise the user stays stuck on the trust screen because ~/.claude.json
 * could not be updated, despite explicitly accepting the workspace.
 */
export function completeTrustAcceptance({
  isHomeDir,
  setSessionTrustAccepted,
  persistProjectTrust,
  onDone,
  logFailure,
}: CompleteTrustAcceptanceArgs): void {
  setSessionTrustAccepted(true)

  if (!isHomeDir) {
    try {
      persistProjectTrust()
    } catch (error) {
      logFailure(error)
    }
  }

  onDone()
}
