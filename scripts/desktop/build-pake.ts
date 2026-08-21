/**
 * Build the desktop application from the current workspace: pack the published
 * dsh dependency closure, install it beside a pinned Node runtime, stage a
 * pinned Pake template, and let Pake/Tauri produce the native artifact.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { isEntry, capture, run } from '../release/process.ts'

/** Pake release used as the desktop shell source. */
export const PAKE_VERSION = '3.15.7'
/** Node release embedded as the dsh sidecar runtime. */
export const DESKTOP_NODE_VERSION = '24.18.0'

const PAKE_ARCHIVE = `pake-cli-${PAKE_VERSION}.tgz`
const PAKE_URL = `https://registry.npmjs.org/pake-cli/-/${PAKE_ARCHIVE}`
const PAKE_SHA256 = '3fea5e929effcddded6ef2fb6fc7bdc49c32f560697b338013733d95b42b0e7d'
const ENTRY_PACKAGE = '@deepseek-ai/dsh'
const SIDECAR_NAME = 'binaries/dsh-sidecar'
const MACOS_ENTITLEMENTS = 'dsh-node-entitlements.plist'
const PAKE_RESOURCE_ASSIGNMENT = '            tauriConf.bundle.resources = [iconInfo.path];'
const PAKE_RESOURCE_MERGE = `            tauriConf.bundle.resources = {
                ...tauriConf.bundle.resources,
                [iconInfo.path]: iconInfo.path,
            };`

/** One native build host and its official Node distribution. */
export interface DesktopPlatform {
  /** Node's process.platform value. */
  readonly platform: NodeJS.Platform
  /** Node's process.arch value. */
  readonly arch: string
  /** Rust target suffix required by Tauri externalBin. */
  readonly targetTriple: string
  /** Official Node archive filename. */
  readonly nodeArchive: string
  /** SHA-256 from Node's signed SHASUMS256.txt. */
  readonly nodeSha256: string
  /** Root directory created when the archive is extracted. */
  readonly nodeDirectory: string
  /** Node executable inside the extracted distribution. */
  readonly nodeExecutable: string
  /** Executable suffix expected by this host. */
  readonly executableSuffix: string
  /** Pake platform bundle configuration filename. */
  readonly pakePlatformConfig: string
}

const DESKTOP_PLATFORMS: readonly DesktopPlatform[] = [
  {
    platform: 'darwin',
    arch: 'arm64',
    targetTriple: 'aarch64-apple-darwin',
    nodeArchive: `node-v${DESKTOP_NODE_VERSION}-darwin-arm64.tar.gz`,
    nodeSha256: 'e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1',
    nodeDirectory: `node-v${DESKTOP_NODE_VERSION}-darwin-arm64`,
    nodeExecutable: 'bin/node',
    executableSuffix: '',
    pakePlatformConfig: 'tauri.macos.conf.json',
  },
  {
    platform: 'darwin',
    arch: 'x64',
    targetTriple: 'x86_64-apple-darwin',
    nodeArchive: `node-v${DESKTOP_NODE_VERSION}-darwin-x64.tar.gz`,
    nodeSha256: 'dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080',
    nodeDirectory: `node-v${DESKTOP_NODE_VERSION}-darwin-x64`,
    nodeExecutable: 'bin/node',
    executableSuffix: '',
    pakePlatformConfig: 'tauri.macos.conf.json',
  },
  {
    platform: 'linux',
    arch: 'arm64',
    targetTriple: 'aarch64-unknown-linux-gnu',
    nodeArchive: `node-v${DESKTOP_NODE_VERSION}-linux-arm64.tar.xz`,
    nodeSha256: '58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6',
    nodeDirectory: `node-v${DESKTOP_NODE_VERSION}-linux-arm64`,
    nodeExecutable: 'bin/node',
    executableSuffix: '',
    pakePlatformConfig: 'tauri.linux.conf.json',
  },
  {
    platform: 'linux',
    arch: 'x64',
    targetTriple: 'x86_64-unknown-linux-gnu',
    nodeArchive: `node-v${DESKTOP_NODE_VERSION}-linux-x64.tar.xz`,
    nodeSha256: '55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742',
    nodeDirectory: `node-v${DESKTOP_NODE_VERSION}-linux-x64`,
    nodeExecutable: 'bin/node',
    executableSuffix: '',
    pakePlatformConfig: 'tauri.linux.conf.json',
  },
  {
    platform: 'win32',
    arch: 'arm64',
    targetTriple: 'aarch64-pc-windows-msvc',
    nodeArchive: `node-v${DESKTOP_NODE_VERSION}-win-arm64.zip`,
    nodeSha256: 'f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01',
    nodeDirectory: `node-v${DESKTOP_NODE_VERSION}-win-arm64`,
    nodeExecutable: 'node.exe',
    executableSuffix: '.exe',
    pakePlatformConfig: 'tauri.windows.conf.json',
  },
  {
    platform: 'win32',
    arch: 'x64',
    targetTriple: 'x86_64-pc-windows-msvc',
    nodeArchive: `node-v${DESKTOP_NODE_VERSION}-win-x64.zip`,
    nodeSha256: '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821',
    nodeDirectory: `node-v${DESKTOP_NODE_VERSION}-win-x64`,
    nodeExecutable: 'node.exe',
    executableSuffix: '.exe',
    pakePlatformConfig: 'tauri.windows.conf.json',
  },
]

/**
 * Resolve one supported native build host.
 * @param platform - Node platform value.
 * @param arch - Node architecture value.
 * @returns The pinned Pake/Node build facts.
 */
export function desktopPlatform(platform: NodeJS.Platform, arch: string): DesktopPlatform {
  const match = DESKTOP_PLATFORMS.find(candidate => candidate.platform === platform && candidate.arch === arch)
  if (match === undefined) throw new Error(`desktop build: unsupported host ${platform}/${arch}`)
  return match
}

/** Minimal packed manifest fields needed to compute the runtime closure. */
export interface PackedManifest {
  readonly name: string
  readonly version: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

/** One local tarball and the manifest it carries. */
export interface PackedArtifact {
  readonly tarball: string
  readonly manifest: PackedManifest
}

/**
 * Select the local package closure reachable from the shipped dsh executable.
 * @param packed - All locally packed dsh, vendor, and native entry artifacts.
 * @param entry - Root package whose runtime is embedded.
 * @returns Reachable artifacts in stable package-name order.
 */
export function runtimeClosure(
  packed: ReadonlyMap<string, PackedArtifact>,
  entry = ENTRY_PACKAGE,
): PackedArtifact[] {
  const selected = new Set<string>()
  const visit = (name: string): void => {
    if (selected.has(name)) return
    const artifact = packed.get(name)
    if (artifact === undefined) {
      if (name === entry) throw new Error(`desktop build: packed entry ${entry} is missing`)
      return
    }
    selected.add(name)
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      for (const dependency of Object.keys(artifact.manifest[section] ?? {})) visit(dependency)
    }
  }
  visit(entry)
  return [...selected].sort().map(name => packed.get(name) as PackedArtifact)
}

/** Bundle fields added to Pake's platform configuration. */
export interface DesktopBundlePatch {
  readonly externalBin: readonly string[]
  readonly resources: Readonly<Record<string, string>>
  readonly macOS?: Readonly<Record<string, unknown>>
}

/**
 * Build the Pake bundle fields that carry the Node executable and npm runtime.
 * @param bundle - Pake's platform-specific bundle configuration.
 * @param platform - Native operating system being assembled.
 * @returns Fields merged over Pake's native platform bundle.
 */
export function desktopBundlePatch(
  bundle: Readonly<Record<string, unknown>>,
  platform: NodeJS.Platform,
): DesktopBundlePatch {
  const patch: DesktopBundlePatch = {
    externalBin: [SIDECAR_NAME],
    resources: { 'resources/': '' },
  }
  if (platform !== 'darwin') return patch

  const macOS = bundle.macOS
  if (macOS === null || typeof macOS !== 'object' || Array.isArray(macOS)) {
    throw new Error('desktop build: Pake macOS bundle configuration is missing')
  }
  return {
    ...patch,
    macOS: { ...macOS, entitlements: MACOS_ENTITLEMENTS },
  }
}

/**
 * Keep configured bundle resources when Pake adds its generated application
 * icon. Pake 3.15.7 otherwise replaces the complete resource mapping.
 * @param source - contents of Pake's compiled CLI entry.
 * @returns CLI source with the pinned assignment replaced exactly once.
 */
export function preservePakeBundleResources(source: string): string {
  const first = source.indexOf(PAKE_RESOURCE_ASSIGNMENT)
  if (first === -1 || source.indexOf(PAKE_RESOURCE_ASSIGNMENT, first + 1) !== -1) {
    throw new Error('desktop build: pinned Pake resource assignment changed')
  }
  return `${source.slice(0, first)}${PAKE_RESOURCE_MERGE}${source.slice(first + PAKE_RESOURCE_ASSIGNMENT.length)}`
}

/**
 * Capability available only to Pake's local launcher document. Remote Harness
 * pages do not receive process-spawn authority.
 * @returns Tauri capability JSON.
 */
export function desktopSidecarCapability(): Record<string, unknown> {
  return {
    $schema: '../gen/schemas/desktop-schema.json',
    identifier: 'dsh-desktop-sidecar',
    description: 'Starts the bundled DeepSeek Harness Web runtime from the local launcher.',
    webviews: ['pake'],
    permissions: [{
      identifier: 'shell:allow-spawn',
      allow: [{
        name: SIDECAR_NAME,
        sidecar: true,
        args: [
          { validator: String.raw`.*[\\/]runtime[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js` },
          'web',
          '--host',
          '127.0.0.1',
          '--port',
          '0',
        ],
      }],
    }],
  }
}

const root = resolve(import.meta.dirname, '../..')
const artifactsRoot = resolve(root, '.artifacts/desktop')
const cacheRoot = resolve(root, '.cache/desktop')

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`desktop build: ${path} is not a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function download(url: string, destination: string, expectedSha256: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true })
  if (existsSync(destination) && sha256(destination) === expectedSha256) return
  rmSync(destination, { force: true })
  const response = await fetch(url)
  if (!response.ok) throw new Error(`desktop build: ${url} returned HTTP ${String(response.status)}`)
  const temporary = `${destination}.partial-${String(process.pid)}`
  writeFileSync(temporary, Buffer.from(await response.arrayBuffer()))
  const actual = sha256(temporary)
  if (actual !== expectedSha256) {
    rmSync(temporary, { force: true })
    throw new Error(`desktop build: checksum mismatch for ${basename(destination)}: ${actual}`)
  }
  renameSync(temporary, destination)
}

function extract(archive: string, destination: string, stripComponents = false): void {
  mkdirSync(destination, { recursive: true })
  const args = ['-xf', archive, '-C', destination]
  if (stripComponents) args.push('--strip-components=1')
  run('tar', args)
}

function packedManifest(tarball: string): PackedManifest {
  const parsed: unknown = JSON.parse(capture('tar', ['-xOzf', tarball, 'package/package.json']))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`desktop build: ${tarball} has no object manifest`)
  }
  const manifest = parsed as Partial<PackedManifest>
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`desktop build: ${tarball} manifest lacks name/version`)
  }
  return manifest as PackedManifest
}

function packWorkspace(packRoot: string): Map<string, PackedArtifact> {
  const dsh = join(packRoot, 'dsh')
  const vendor = join(packRoot, 'vendor')
  const native = join(packRoot, 'native')
  run('pnpm', ['run', 'release:pack', '--family', 'dsh', '--out', dsh], { cwd: root })
  run('pnpm', ['run', 'release:pack', '--family', 'vendor', '--out', vendor], { cwd: root })
  rmSync(native, { recursive: true, force: true })
  mkdirSync(native, { recursive: true })
  run('pnpm', ['--dir', 'native/landlock-run', 'run', 'build:ts'], { cwd: root })
  run('pnpm', [
    '--dir',
    'native/landlock-run/packages/entry',
    'pack',
    '--pack-destination',
    native,
  ], { cwd: root })

  const packed = new Map<string, PackedArtifact>()
  for (const directory of [dsh, vendor, native]) {
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()) {
      const tarball = join(directory, filename)
      const manifest = packedManifest(tarball)
      if (packed.has(manifest.name)) throw new Error(`desktop build: duplicate packed package ${manifest.name}`)
      packed.set(manifest.name, { tarball, manifest })
    }
  }
  return packed
}

function installRuntime(runtimeRoot: string, packed: ReadonlyMap<string, PackedArtifact>): string[] {
  rmSync(runtimeRoot, { recursive: true, force: true })
  mkdirSync(runtimeRoot, { recursive: true })
  const closure = runtimeClosure(packed)
  const dependencies = Object.fromEntries(closure.map(artifact => [
    artifact.manifest.name,
    pathToFileURL(artifact.tarball).href,
  ]))
  writeJson(join(runtimeRoot, 'package.json'), {
    name: 'dsh-desktop-runtime',
    version: '0.0.0',
    private: true,
    dependencies,
  })
  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--omit=dev',
  ], {
    cwd: runtimeRoot,
    env: { ...process.env, npm_config_cache: join(cacheRoot, 'npm') },
  })
  rmSync(join(runtimeRoot, 'node_modules/.package-lock.json'), { force: true })
  writeJson(join(runtimeRoot, 'package.json'), {
    name: 'dsh-desktop-runtime',
    version: '0.0.0',
    private: true,
  })
  return closure.map(artifact => artifact.manifest.name)
}

function copyDeepSeekIcons(pakeRoot: string): void {
  const tauri = join(pakeRoot, 'src-tauri')
  cpSync(join(tauri, 'icons/deepseek.icns'), join(tauri, 'icons/icon.icns'))
  cpSync(join(tauri, 'png/deepseek_256.ico'), join(tauri, 'png/icon_256.ico'))
  cpSync(join(tauri, 'png/deepseek_32.ico'), join(tauri, 'png/icon_32.ico'))
  cpSync(join(tauri, 'png/deepseek_512.png'), join(tauri, 'png/icon_512.png'))
  cpSync(join(tauri, 'png/deepseek_512.png'), join(tauri, 'icons/icon.png'))
}

function patchPake(pakeRoot: string, platform: DesktopPlatform): void {
  const tauri = join(pakeRoot, 'src-tauri')
  const platformPath = join(tauri, platform.pakePlatformConfig)
  const platformConfig = readJson(platformPath)
  const bundle = platformConfig.bundle
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error(`desktop build: ${platformPath} has no bundle object`)
  }
  const bundleConfig = bundle as Record<string, unknown>
  platformConfig.bundle = {
    ...bundleConfig,
    ...desktopBundlePatch(bundleConfig, platform.platform),
  }
  if (platform.platform === 'darwin') {
    cpSync(
      join(root, 'apps/desktop/macos-entitlements.plist'),
      join(tauri, MACOS_ENTITLEMENTS),
    )
  }
  writeJson(platformPath, platformConfig)

  const defaultCapabilityPath = join(tauri, 'capabilities/default.json')
  const defaultCapability = readJson(defaultCapabilityPath)
  const remote = defaultCapability.remote
  if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) {
    throw new Error(`desktop build: ${defaultCapabilityPath} has no remote object`)
  }
  const urls = (remote as { urls?: unknown }).urls
  if (!Array.isArray(urls) || !urls.every(value => typeof value === 'string')) {
    throw new Error(`desktop build: ${defaultCapabilityPath} has invalid remote.urls`)
  }
  defaultCapability.remote = { ...remote, urls: [...urls, 'http://127.0.0.1:*'] }
  writeJson(defaultCapabilityPath, defaultCapability)
  writeJson(join(tauri, 'capabilities/dsh-desktop-sidecar.json'), desktopSidecarCapability())
  const cliPath = join(pakeRoot, 'dist/cli.js')
  writeFileSync(cliPath, preservePakeBundleResources(readFileSync(cliPath, 'utf8')))
  copyDeepSeekIcons(pakeRoot)
}

async function stagePake(stageRoot: string, platform: DesktopPlatform): Promise<string> {
  const archive = join(cacheRoot, PAKE_ARCHIVE)
  await download(PAKE_URL, archive, PAKE_SHA256)
  const pakeRoot = join(stageRoot, 'pake-cli')
  rmSync(pakeRoot, { recursive: true, force: true })
  extract(archive, pakeRoot, true)
  patchPake(pakeRoot, platform)
  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--legacy-peer-deps',
  ], {
    cwd: pakeRoot,
    env: { ...process.env, npm_config_cache: join(cacheRoot, 'npm') },
  })
  return pakeRoot
}

async function stageNode(pakeRoot: string, platform: DesktopPlatform, stageRoot: string): Promise<void> {
  const archive = join(cacheRoot, platform.nodeArchive)
  await download(
    `https://nodejs.org/dist/v${DESKTOP_NODE_VERSION}/${platform.nodeArchive}`,
    archive,
    platform.nodeSha256,
  )
  const extracted = join(stageRoot, 'node')
  rmSync(extracted, { recursive: true, force: true })
  extract(archive, extracted)
  const distribution = join(extracted, platform.nodeDirectory)
  const source = join(distribution, platform.nodeExecutable)
  const binaries = join(pakeRoot, 'src-tauri/binaries')
  mkdirSync(binaries, { recursive: true })
  const destination = join(
    binaries,
    `dsh-sidecar-${platform.targetTriple}${platform.executableSuffix}`,
  )
  cpSync(source, destination)
  if (platform.platform !== 'win32') chmodSync(destination, 0o755)

  const licenses = join(pakeRoot, 'src-tauri/resources/licenses')
  mkdirSync(join(licenses, 'node'), { recursive: true })
  cpSync(join(distribution, 'LICENSE'), join(licenses, 'node/LICENSE'))
}

function stageLicenses(pakeRoot: string): void {
  const licenses = join(pakeRoot, 'src-tauri/resources/licenses')
  mkdirSync(join(licenses, 'deepseek-harness'), { recursive: true })
  mkdirSync(join(licenses, 'pake'), { recursive: true })
  cpSync(join(root, 'LICENSE'), join(licenses, 'deepseek-harness/LICENSE'))
  cpSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(licenses, 'deepseek-harness/THIRD_PARTY_NOTICES.md'))
  cpSync(join(pakeRoot, 'LICENSE'), join(licenses, 'pake/LICENSE'))
  cpSync(join(pakeRoot, 'LICENSE-EXCEPTION'), join(licenses, 'pake/LICENSE-EXCEPTION'))
}

interface PakeOutput {
  readonly path: string
  readonly sizeBytes: number
  readonly format: string
}

interface PakeResult {
  readonly ok: boolean
  readonly name: string
  readonly platform: string
  readonly arch: string
  readonly outputs: readonly PakeOutput[]
  readonly warnings: readonly string[]
  readonly error: { readonly code: string; readonly message: string; readonly hint?: string } | null
}

function runPake(pakeRoot: string, configPath: string, outputRoot: string, targets?: string): PakeResult {
  const args = [join(pakeRoot, 'dist/cli.js'), '--config', configPath, '--json']
  if (targets !== undefined) args.push('--targets', targets)
  const result = spawnSync(process.execPath, args, {
    cwd: outputRoot,
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  if (result.error !== undefined) throw result.error
  let parsed: PakeResult
  try {
    parsed = JSON.parse(result.stdout) as PakeResult
  } catch {
    throw new Error(`desktop build: Pake returned non-JSON stdout:\n${result.stdout}`)
  }
  if (result.status !== 0 || !parsed.ok) {
    const detail = parsed.error === null
      ? `exit ${String(result.status)}`
      : `${parsed.error.code}: ${parsed.error.message}${parsed.error.hint === undefined ? '' : ` (${parsed.error.hint})`}`
    throw new Error(`desktop build: Pake failed: ${detail}`)
  }
  if (parsed.outputs.length === 0) throw new Error('desktop build: Pake reported success without an output')
  return parsed
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv[0] === '--') argv.shift()
  const { values } = parseArgs({
    args: argv,
    options: {
      targets: { type: 'string' },
      output: { type: 'string' },
    },
    allowPositionals: false,
  })
  const platform = desktopPlatform(process.platform, process.arch)
  const outputRoot = resolve(root, values.output ?? 'dist/desktop')
  const stageRoot = join(artifactsRoot, `${platform.platform}-${platform.arch}`)
  rmSync(stageRoot, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true })
  mkdirSync(outputRoot, { recursive: true })

  run('pnpm', ['run', 'build'], { cwd: root })
  const packed = packWorkspace(join(stageRoot, 'packs'))
  const pakeRoot = await stagePake(stageRoot, platform)
  const runtimeRoot = join(pakeRoot, 'src-tauri/resources/runtime')
  const runtimePackages = installRuntime(runtimeRoot, packed)
  await stageNode(pakeRoot, platform, stageRoot)
  stageLicenses(pakeRoot)

  const baseConfig = readJson(join(root, 'apps/desktop/pake.json'))
  const rootManifest = readJson(join(root, 'package.json'))
  const version = rootManifest.version
  if (typeof version !== 'string') throw new Error('desktop build: package.json has no version')
  const configPath = join(stageRoot, 'pake.json')
  writeJson(configPath, {
    ...baseConfig,
    url: resolve(root, 'apps/desktop/launcher'),
    appVersion: version,
  })

  const result = runPake(pakeRoot, configPath, outputRoot, values.targets)
  const manifestPath = join(outputRoot, 'desktop-build.json')
  writeJson(manifestPath, {
    schemaVersion: 1,
    appVersion: version,
    pakeVersion: PAKE_VERSION,
    nodeVersion: DESKTOP_NODE_VERSION,
    targetTriple: platform.targetTriple,
    runtimePackages,
    outputs: result.outputs,
    warnings: result.warnings,
  })
  console.log(`desktop build: ${String(result.outputs.length)} artifact(s); manifest ${manifestPath}`)
}

if (isEntry(import.meta.url)) await main()
