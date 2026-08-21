const READY_URL_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/
const SIDECAR_NAME = 'binaries/dsh-sidecar'

/**
 * Extract the loopback URL printed by the assembled Web runtime.
 * @param {string} output Complete or partial sidecar stdout.
 * @returns {string | undefined} The ready URL once the line is complete.
 */
export function extractReadyUrl(output) {
  return READY_URL_PATTERN.exec(output)?.[1]
}

/**
 * Keep a short diagnostic suitable for the startup card.
 * @param {string} output Sidecar stderr accumulated so far.
 * @returns {string} The last non-empty line, bounded for the UI.
 */
export function latestDiagnostic(output) {
  const line = output.split(/\r?\n/).map(part => part.trim()).filter(Boolean).at(-1) ?? ''
  return line.length <= 240 ? line : `${line.slice(0, 237)}…`
}

/**
 * Build the fixed Shell plugin request used to start the bundled runtime.
 * @param {string} entry Absolute path to the bundled dsh entry.
 * @param {string} workingDirectory User home directory for the Web profile.
 * @returns {{ program: string, args: string[], options: { cwd: string, sidecar: true } }} Spawn request without its event channel.
 */
export function sidecarSpawnRequest(entry, workingDirectory) {
  return {
    program: SIDECAR_NAME,
    args: [entry, 'web', '--host', '127.0.0.1', '--port', '0'],
    options: { cwd: workingDirectory, sidecar: true },
  }
}

/** Start the bundled Harness server and reveal its Web UI. */
async function start() {
  const shell = document.querySelector('.shell')
  const status = document.querySelector('#startup-status')
  const detail = document.querySelector('#startup-detail')
  const retry = document.querySelector('#retry')
  const frame = document.querySelector('#harness')
  if (!(shell instanceof HTMLElement)
    || !(status instanceof HTMLElement)
    || !(detail instanceof HTMLElement)
    || !(retry instanceof HTMLButtonElement)
    || !(frame instanceof HTMLIFrameElement)) {
    throw new Error('Desktop launcher markup is incomplete.')
  }

  retry.addEventListener('click', () => { window.location.reload() })

  const tauri = window.__TAURI__
  if (tauri?.path === undefined
    || tauri.shell?.Command === undefined) {
    status.textContent = 'This launcher must run inside the desktop application.'
    detail.textContent = 'Build and open the Pake application instead of opening index.html in a browser.'
    shell.dataset.state = 'failed'
    return
  }

  const entry = await tauri.path.resolveResource(
    'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
  )
  const workingDirectory = await tauri.path.homeDir()
  const request = sidecarSpawnRequest(entry, workingDirectory)
  const command = tauri.shell.Command.sidecar(
    request.program,
    request.args,
    request.options,
  )

  let stdout = ''
  let stderr = ''
  let ready = false
  let childStarted = false

  const fail = (message, diagnostic = '') => {
    shell.dataset.state = 'failed'
    status.textContent = message
    detail.textContent = diagnostic || 'Open the application again after correcting the problem.'
    retry.hidden = childStarted
  }

  command.stdout.on('data', (chunk) => {
    stdout += String(chunk)
    const url = extractReadyUrl(stdout)
    if (url === undefined || ready) return
    ready = true
    status.textContent = 'Opening DeepSeek Harness…'
    detail.textContent = url
    frame.addEventListener('load', () => {
      frame.hidden = false
      shell.dataset.state = 'ready'
    }, { once: true })
    frame.src = url
  })

  command.stderr.on('data', (chunk) => {
    stderr += String(chunk)
    const diagnostic = latestDiagnostic(stderr)
    if (!ready && diagnostic !== '') detail.textContent = diagnostic
  })

  command.on('error', (error) => {
    childStarted = false
    fail('The local agent runtime could not start.', latestDiagnostic(String(error)))
    retry.hidden = false
  })

  command.on('close', ({ code, signal }) => {
    childStarted = false
    const suffix = signal === null
      ? `exit code ${String(code)}`
      : `signal ${String(signal)}`
    fail('The local agent runtime stopped.', latestDiagnostic(stderr) || `The process ended with ${suffix}.`)
    frame.hidden = true
    retry.hidden = false
  })

  const child = await command.spawn()
  childStarted = true
  detail.textContent = `Local runtime process ${String(child.pid)} is starting.`

  window.setTimeout(() => {
    if (ready || shell.dataset.state === 'failed') return
    status.textContent = 'DeepSeek Harness is still starting…'
    detail.textContent = latestDiagnostic(stderr)
      || 'A first launch may need extra time to initialize local files.'
  }, 15_000)
}

if (typeof document !== 'undefined') {
  start().catch((error) => {
    const shell = document.querySelector('.shell')
    const status = document.querySelector('#startup-status')
    const detail = document.querySelector('#startup-detail')
    const retry = document.querySelector('#retry')
    if (shell instanceof HTMLElement) shell.dataset.state = 'failed'
    if (status instanceof HTMLElement) status.textContent = 'The desktop application could not start.'
    if (detail instanceof HTMLElement) detail.textContent = latestDiagnostic(String(error))
    if (retry instanceof HTMLButtonElement) retry.hidden = false
  })
}
