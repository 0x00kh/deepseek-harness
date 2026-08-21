# Agent Note: Pake desktop shell with a bundled Web sidecar

Status: implemented

English | [中文](2026-08-19-pake-desktop-sidecar.zh.md)

## Problem

DeepSeek Harness needs a directly launchable desktop artifact without creating a second application architecture. The built frontend is not a standalone static site: `dsh web` injects its boot data, serves the API, owns the WebSocket connection, composes plugins, and persists sessions. Pointing Pake only at the frontend output would therefore package a page that cannot run the product. Reimplementing those services in the desktop shell would split behavior across two transports and two composition paths.

## Decision

The desktop application keeps the existing Web assembly intact and treats it as a local sidecar. A static document packaged by Pake starts an official bundled Node.js executable through Pake's existing Tauri Shell plugin. That executable runs the packed `@deepseek-ai/dsh` entry as `dsh web --host 127.0.0.1 --port 0`; the operating system selects an unused loopback port. The launcher accepts the URL from the server's existing ready line and displays it in a full-window frame.

The Pake release, Node.js release, and platform archives are checksum-pinned by the repository build script. The script first builds the workspace, packs the same npm package families used for release, computes the local dependency, optional-dependency, and peer-dependency closure reachable from `@deepseek-ai/dsh`, and installs only that closure in the application resources. Pake then bundles the Node executable as a Tauri sidecar and the npm closure as ordinary resources. Pake 3.15.7 replaces an existing resource mapping when it adds the generated application icon, so the staging step applies an exact, version-bound JavaScript replacement that merges the icon into the mapping; the build fails if the pinned statement changes or occurs more than once. The resulting application therefore runs built release artifacts rather than TypeScript source or the repository's installed dependency tree.

On macOS, Tauri re-signs bundled sidecars with the application's entitlement file. An empty Pake entitlement file removes the permissions from the official Node.js signature and prevents V8 from allocating executable code memory. The desktop bundle therefore selects a checked-in entitlement file that permits JIT compilation, executable memory, and loading native Node modules. It omits the upstream binary's debugger attachment and dynamic-loader environment-variable permissions because normal Harness execution does not require them.

The local launcher remains the top document. This gives it ownership of startup and failure presentation, and avoids admitting an unpredictable port as a top-level navigation target. A dedicated Tauri capability grants only that local document permission to spawn the named bundled sidecar with the exact entry path suffix and fixed `web`, host, and port arguments. The Harness page served from loopback does not receive this capability. Pake's normal remote capability admits loopback pages so the existing Web UI can use its intended Tauri integrations. Tauri's shell plugin records spawned children and terminates them during application exit.

## Consequences

Desktop and browser users exercise the same Web API, WebSocket transport, plugin composition, session storage, profile initialization, and user configuration. No desktop-specific backend protocol or compatibility layer exists. The application is self-contained with respect to Node.js and first-party npm packages, while user data continues to live under the normal DeepSeek Harness home directory because the sidecar starts with the user's home directory as its working directory.

Native artifacts must be built on each supported operating system and architecture. The repository does not cross-compile them. Pake/Tauri build prerequisites are required only for producing the application, not for running the generated artifact. Licenses for DeepSeek Harness, its disclosed dependencies, Pake and its output exception, and the bundled Node.js distribution travel in the application resources. The generated build manifest records the exact shell version, Node.js version, target triple, included first-party package closure, output files, and warnings.

The frame is a deliberate application boundary: the launcher can observe document load and sidecar exit, but it does not add a second state channel into the Harness page. If a future desktop feature needs native behavior, it should remain a plugin contribution on an existing Harness extension point or define a complete capability seam; it should not place product behavior in the launcher.

## Alternatives considered

- **Package only the built frontend** — it lacks injected boot data, the API, the WebSocket server, plugin composition, and persistence, so the result cannot run DeepSeek Harness.
- **Navigate the Pake window directly to the dynamic server URL** — this discards the local startup document, makes startup failures opaque, and requires dynamic top-level navigation policy instead of a single loopback frame source.
- **Require a separately installed Node.js or a separately started `dsh web` process** — this is not a directly runnable application and makes behavior depend on the host's runtime version and installation state.
- **Fork Pake's Rust application to supervise the server** — the existing Tauri Shell plugin already starts sidecars and terminates registered children on exit, so a Rust fork would duplicate lifecycle code without adding a required invariant.
- **Reimplement the backend in Tauri** — this duplicates the existing plugin runtime and wire surfaces, producing the largest maintenance and behavioral divergence.
