# 桌面应用

[English](README.md) | 中文

桌面构建使用 [Pake](https://github.com/tw93/Pake) 将现有 DeepSeek Harness Web 应用打包成原生应用。它不会替换 Web 服务，也不会复制一套通信协议：一个很小的本地启动页会在操作系统分配的回环端口上启动随应用打包的 `dsh web` 运行时，再在应用窗口中显示该服务。

## 构建

请先安装仓库依赖，以及当前平台上 Pake/Tauri 所需的原生构建环境。Rust 必须通过 `rustup` 可用；macOS 还需要 Xcode Command Line Tools，Linux 和 Windows 则需要 [Pake 开发指南](https://github.com/tw93/Pake/blob/main/DEVELOPMENT.md)列出的平台依赖。

在仓库根目录运行：

```sh
pnpm install
pnpm run desktop:build
```

该命令会构建整个 workspace，打包从 `@deepseek-ai/dsh` 可达的 npm 发布依赖图，下载经过 checksum 校验且版本固定的 Pake 与 Node.js，并把原生产物和 `desktop-build.json` 写入 `dist/desktop/`。命令只为当前操作系统和 CPU 架构构建；需要支持多个目标平台时，应分别在对应平台运行，而不是交叉编译。

需要指定某种原生格式时，可以把 Pake 的 target 选项继续传入。例如，在 macOS 上只生成应用包：

```sh
pnpm run desktop:build -- --targets app
```

构建产生的暂存文件和下载缓存位于 `.artifacts/desktop/` 与 `.cache/desktop/`。它们不是源码产物，可以在两次构建之间删除。

## 运行方式

应用包含四部分：

1. Pake 的 Tauri 外壳，以及 [`launcher/`](launcher/) 中的静态启动页。
2. 注册为 Tauri sidecar 的官方 Node.js 可执行文件。
3. 位于应用资源目录中的 `@deepseek-ai/dsh` npm 运行时依赖闭包。
4. 由 `dsh web` 启动且保持不变的 Web UI、API、WebSocket 传输、Session 持久化与插件组合。

应用启动时，静态页面会使用固定参数启动 sidecar，等价于：

```sh
node <bundled-resource>/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js web \
  --host 127.0.0.1 --port 0
```

启动页只接受该进程打印出的回环地址，并在占满窗口的 frame 中加载它。启动页始终保留为顶层文档，因此能报告启动失败，也能发现服务意外退出。应用退出时，Tauri 会终止已登记的 sidecar。

## 安全与分发

进程启动权限只授予打包后的本地启动页，并且只允许按上述固定参数运行一个随应用提供的 sidecar。由本地服务返回的 Harness 页面拥有应用所需的普通 Pake Web 权限，但不能调用 sidecar 启动权限。

在 macOS 上，Tauri 会使用 Node.js 和原生 Node 模块所需的 JIT、可执行内存与 library validation entitlement 为应用和 sidecar 签名。仓库内受审计的 entitlement 列表有意排除了上游 Node 二进制中的调试器附加权限和动态加载器环境变量权限。

构建会把 DeepSeek Harness 的许可证与第三方声明、Pake 的许可证与产物例外条款，以及 Node.js 的许可证复制到应用资源中。Pake、Node.js 的版本和压缩包 checksum 固定在 [`../../scripts/desktop/build-pake.ts`](../../scripts/desktop/build-pake.ts)；每次构建的 `desktop-build.json` 会记录版本、目标平台、运行时包闭包、输出路径与 Pake 警告。
