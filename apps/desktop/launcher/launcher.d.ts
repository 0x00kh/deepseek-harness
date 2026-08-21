/** Extract the loopback URL printed by the assembled Web runtime. */
export function extractReadyUrl(output: string): string | undefined

/** Keep a short diagnostic suitable for the startup card. */
export function latestDiagnostic(output: string): string

/** Build the fixed Shell plugin request used to start the bundled runtime. */
export function sidecarSpawnRequest(entry: string, workingDirectory: string): {
  program: string
  args: string[]
  options: { cwd: string; sidecar: true }
}
