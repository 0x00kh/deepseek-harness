import { describe, expect, it } from 'vitest'
import {
  desktopBundlePatch,
  desktopPlatform,
  desktopSidecarCapability,
  preservePakeBundleResources,
  runtimeClosure,
  DESKTOP_WORKSPACE_BUILD_ARGS,
  type PackedArtifact,
} from './build-pake.ts'

function artifact(
  name: string,
  fields: Partial<PackedArtifact['manifest']> = {},
): PackedArtifact {
  return {
    tarball: `/packs/${name}.tgz`,
    manifest: { name, version: '1.0.0', ...fields },
  }
}

describe('desktop Pake assembly', () => {
  it('builds the official client profile before release packing', () => {
    expect(DESKTOP_WORKSPACE_BUILD_ARGS).toEqual(['run', 'build:official'])
  })

  it('maps native hosts to the Node and Tauri sidecar names', () => {
    expect(desktopPlatform('darwin', 'arm64')).toMatchObject({
      targetTriple: 'aarch64-apple-darwin',
      nodeExecutable: 'bin/node',
    })
    expect(desktopPlatform('win32', 'x64')).toMatchObject({
      targetTriple: 'x86_64-pc-windows-msvc',
      executableSuffix: '.exe',
    })
    expect(() => desktopPlatform('freebsd', 'x64')).toThrow('unsupported host freebsd/x64')
  })

  it('selects runtime dependencies, optional dependencies, and local peers only', () => {
    const packed = new Map<string, PackedArtifact>([
      ['@deepseek-ai/dsh', artifact('@deepseek-ai/dsh', {
        dependencies: { '@deepseek-ai/runtime': '1.0.0', external: '1.0.0' },
        optionalDependencies: { '@deepseek-ai/optional': '1.0.0' },
        peerDependencies: { '@deepseek-ai/cordis': '1.0.0' },
      })],
      ['@deepseek-ai/runtime', artifact('@deepseek-ai/runtime', {
        dependencies: { '@deepseek-ai/transitive': '1.0.0' },
      })],
      ['@deepseek-ai/transitive', artifact('@deepseek-ai/transitive')],
      ['@deepseek-ai/optional', artifact('@deepseek-ai/optional')],
      ['@deepseek-ai/cordis', artifact('@deepseek-ai/cordis')],
      ['@deepseek-ai/unrelated', artifact('@deepseek-ai/unrelated')],
    ])

    expect(runtimeClosure(packed).map(entry => entry.manifest.name)).toEqual([
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh',
      '@deepseek-ai/optional',
      '@deepseek-ai/runtime',
      '@deepseek-ai/transitive',
    ])
  })

  it('keeps process authority on the local launcher and fixes every sidecar argument', () => {
    expect(desktopBundlePatch({}, 'linux')).toEqual({
      externalBin: ['binaries/dsh-sidecar'],
      resources: { 'resources/': '' },
    })
    expect(desktopBundlePatch({
      macOS: { hardenedRuntime: true, signingIdentity: '-' },
    }, 'darwin')).toEqual({
      externalBin: ['binaries/dsh-sidecar'],
      resources: { 'resources/': '' },
      macOS: {
        hardenedRuntime: true,
        signingIdentity: '-',
        entitlements: 'dsh-node-entitlements.plist',
      },
    })
    expect(() => desktopBundlePatch({}, 'darwin')).toThrow(
      'Pake macOS bundle configuration is missing',
    )
    expect(desktopSidecarCapability()).toMatchObject({
      webviews: ['pake'],
      permissions: [{
        identifier: 'shell:allow-spawn',
        allow: [{
          name: 'binaries/dsh-sidecar',
          sidecar: true,
          args: [expect.any(Object), 'web', '--host', '127.0.0.1', '--port', '0'],
        }],
      }],
    })
    expect(desktopSidecarCapability()).not.toHaveProperty('remote')
  })

  it('preserves staged resources when Pake adds the generated icon', () => {
    const assignment = '            tauriConf.bundle.resources = [iconInfo.path];'
    const patched = preservePakeBundleResources(`before\n${assignment}\nafter`)

    expect(patched).toContain('...tauriConf.bundle.resources')
    expect(patched).toContain('[iconInfo.path]: iconInfo.path')
    expect(patched).not.toContain(assignment)
    expect(() => preservePakeBundleResources('assignment moved')).toThrow(
      'pinned Pake resource assignment changed',
    )
    expect(() => preservePakeBundleResources(`${assignment}\n${assignment}`)).toThrow(
      'pinned Pake resource assignment changed',
    )
  })
})
