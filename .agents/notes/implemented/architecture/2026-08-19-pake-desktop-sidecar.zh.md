# Agent Note：使用随应用打包的 Web sidecar 构建 Pake 桌面外壳

Status: implemented

[English](2026-08-19-pake-desktop-sidecar.md) | 中文

## 问题

DeepSeek Harness 需要一种可直接启动的桌面产物，但不应因此产生第二套应用架构。构建后的前端不是独立静态站点：`dsh web` 负责注入启动数据、提供 API、维护 WebSocket 连接、组合插件和持久化 Session。因此，只让 Pake 指向前端产物会打包出一个无法运行产品的页面；在桌面外壳中重做这些服务，则会把行为拆散到两套传输和两条组合路径中。

## 决定

桌面应用保持现有 Web 组合不变，并把它作为本地 sidecar 运行。Pake 打包的静态文档通过 Pake 已有的 Tauri Shell 插件启动随应用提供的官方 Node.js 可执行文件。该进程以 `dsh web --host 127.0.0.1 --port 0` 运行打包后的 `@deepseek-ai/dsh` 入口，由操作系统选择空闲的回环端口。启动页从服务现有的 ready 日志行中取得地址，并在占满窗口的 frame 中显示。

仓库构建脚本固定 Pake、Node.js 版本及各平台压缩包的 checksum。脚本先执行官方 client 构建，再打包发布流程使用的同一组 npm package family，计算从 `@deepseek-ai/dsh` 可达的本地 dependency、optional dependency 和 peer dependency 闭包，只把该闭包装入应用资源。随后，Pake 把 Node 可执行文件作为 Tauri sidecar，把 npm 闭包作为普通资源一起打包。Pake 3.15.7 添加生成后的应用图标时会替换已有的资源映射，因此暂存步骤会执行一次与该版本绑定的精确 JavaScript 替换，把图标合并进映射；如果固定的语句发生变化或出现多次，构建会直接失败。因此，最终应用运行的是构建后的发布产物，而不是 TypeScript 源码或仓库已安装的依赖树。

在 macOS 上，Tauri 会使用应用的 entitlement 文件重新签名随包 sidecar。Pake 的空 entitlement 文件会移除官方 Node.js 签名中的权限，导致 V8 无法分配可执行代码内存。因此，桌面 bundle 会选择一份纳入仓库管理的 entitlement 文件，允许 JIT 编译、可执行内存和原生 Node 模块加载。正常运行 Harness 不需要上游二进制中的调试器附加权限和动态加载器环境变量权限，所以该文件不会包含这两项权限。

本地启动页始终保留为顶层文档。这样它可以负责展示启动过程与失败状态，也不用把不可预知的端口声明为顶层导航目标。一个独立的 Tauri capability 只允许该本地文档按固定入口路径后缀以及固定的 `web`、host、port 参数启动指定的随包 sidecar。从回环地址返回的 Harness 页面不会获得这项权限。Pake 的普通远程 capability 允许回环页面使用现有 Web UI 所需的 Tauri 集成。Tauri Shell 插件会记录已启动的子进程，并在应用退出时终止它们。

## 影响

桌面用户与浏览器用户会经过同一套 Web API、WebSocket 传输、插件组合、Session 存储、profile 初始化和用户配置。系统中不存在桌面专用的后端协议或兼容层。应用自身带有 Node.js 和第一方 npm package；用户数据仍位于 DeepSeek Harness 的常规 home 目录，因为 sidecar 以用户 home 目录作为工作目录启动。

每种受支持的操作系统和 CPU 架构都必须在对应平台构建原生产物，仓库不执行交叉编译。Pake/Tauri 的构建前置条件只用于生成应用，运行生成后的产物不需要这些工具。DeepSeek Harness 与已披露依赖、Pake 及其产物例外条款、随包 Node.js 发行版的许可证都会进入应用资源。生成的构建 manifest 会记录外壳版本、Node.js 版本、目标 triple、包含的第一方 package 闭包、输出文件和警告。

frame 是有意保留的应用边界：启动页可以观察文档加载和 sidecar 退出，但不会为 Harness 页面增加第二条状态通道。未来如需桌面原生功能，应继续通过现有 Harness 扩展点贡献插件，或定义完整的 capability seam；产品行为不应放进启动页。

## 曾考虑的替代方案

- **只打包构建后的前端**：它没有注入的启动数据、API、WebSocket 服务、插件组合和持久化，因此无法运行 DeepSeek Harness。
- **让 Pake 窗口直接跳转到动态服务地址**：这会丢弃本地启动文档，使启动失败难以呈现，还需要动态顶层导航策略，而不是单一的回环 frame 来源。
- **要求用户另行安装 Node.js 或提前启动 `dsh web`**：这种产物不能直接运行，行为还会依赖宿主机的运行时版本和安装状态。
- **fork Pake 的 Rust 应用来监管服务**：现有 Tauri Shell 插件已经能启动 sidecar，并在退出时终止已登记的子进程；Rust fork 只会重复生命周期代码，不会增加必需的不变量。
- **用 Tauri 重写后端**：这会重复现有插件运行时与线上接口，维护成本和行为偏差都最大。
