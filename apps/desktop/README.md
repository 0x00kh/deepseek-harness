# Desktop application

English | [中文](README.zh.md)

The desktop build packages the existing DeepSeek Harness Web application as a native application with [Pake](https://github.com/tw93/Pake). It does not replace the Web server or duplicate its protocol: a small local launcher starts the bundled `dsh web` runtime on an operating-system-assigned loopback port, then displays that server in the application window.

## Build

Install the repository dependencies and the native prerequisites required by Pake/Tauri for the current platform. Rust must be available through `rustup`; macOS also requires Xcode Command Line Tools, while Linux and Windows require the platform packages listed in [Pake's development guide](https://github.com/tw93/Pake/blob/main/DEVELOPMENT.md).

From the repository root, run:

```sh
pnpm install
pnpm run desktop:build
```

The command builds the workspace, packs the npm release graph reachable from `@deepseek-ai/dsh`, downloads checksum-pinned Pake and Node.js releases, and writes the native artifacts plus `desktop-build.json` to `dist/desktop/`. It builds for the current operating system and CPU architecture; use the same command on each target platform rather than cross-compiling.

Pake target selection can be forwarded when a specific native format is needed. For example, macOS can emit only the application bundle with:

```sh
pnpm run desktop:build -- --targets app
```

Generated staging files and downloads live under `.artifacts/desktop/` and `.cache/desktop/`. They are not source artifacts and may be removed between builds.

## Runtime model

The application contains four parts:

1. Pake's Tauri shell and the static launcher in [`launcher/`](launcher/).
2. An official Node.js executable registered as a Tauri sidecar.
3. The built npm runtime closure of `@deepseek-ai/dsh` under the application resources.
4. The unchanged Web UI, API, WebSocket transport, session persistence, and plugin composition started by `dsh web`.

At launch, the static document starts the sidecar with fixed arguments equivalent to:

```sh
node <bundled-resource>/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js web \
  --host 127.0.0.1 --port 0
```

The launcher accepts only the loopback URL printed by that process and loads it in a full-window frame. Keeping the launcher as the top document lets it report startup failures and observe an unexpected server exit. Tauri terminates registered sidecars when the application exits.

## Security and distribution

The process-spawn capability belongs only to the packaged local launcher and permits one bundled sidecar with the fixed argument list above. The remotely served Harness page receives the ordinary Pake Web capabilities needed by the application, but it cannot invoke the sidecar spawn permission.

On macOS, Tauri signs the application and its sidecar with the JIT, executable-memory, and library-validation entitlements required by Node.js and native Node modules. The checked-in entitlement list intentionally omits debugger attachment and dynamic-loader environment-variable permissions from the upstream Node binary.

The build copies the DeepSeek Harness license and third-party notices, Pake's license and output exception, and Node.js's license into the application resources. Pake and Node.js versions and archive checksums are pinned in [`../../scripts/desktop/build-pake.ts`](../../scripts/desktop/build-pake.ts); `desktop-build.json` records the versions, target, runtime package closure, output paths, and Pake warnings for each build.
