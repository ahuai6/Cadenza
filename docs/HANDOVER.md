# Cadenza 开发交接

Cadenza 是以本地音乐为核心的播放器，提供曲库、歌单、队列、普通与 Hi-Fi 输出、桌面歌词、随音乐变化的特效歌词、空间玩法、歌词工坊及 MP4 导出。交接基准为 `refactor/4.0.0` 的 G8 提交 `d11dc47`，开发版本为 `4.0.0-alpha.4`。G8 已提交其实现和测量记录，其中仍有未闭环的验收项。版本和运行时以 [package.json](../package.json) 与锁文件为准。

当前主运行环境是 Windows x64、Electron 45.1.0、React、TypeScript 和 Vite。普通输出使用 Web Audio，Hi-Fi 由 Rust/Symphonia/WASAPI 提供。二维音乐视觉使用 WebGL2、GPU 批次与局部 Canvas2D，空间场景使用 Three.js。神经推理采用 WebGPU 或桌面 ONNX 运行时，视频使用 WebCodecs 与 Mediabunny。Android 是未来目标，当前没有 Android 客户端。

## 入口与调用关系

| 模块 | 源码入口、职责与调用关系 | 深入阅读 |
| --- | --- | --- |
| Electron 主进程与 Renderer | [main.cjs](../electron/main.cjs) 管理单实例、资料生命周期、窗口和系统集成，加载 `dist-app/index.html`。桌面 [index.html](../index.html) 和网页 [web.html](../web.html) 都进入 [app/main.tsx](../src/app/main.tsx)，再挂载适用界面。 | [架构](ARCHITECTURE.md)、[应用](parts/app.md) |
| IPC 与本地资源 | Renderer 经 [bridge.ts](../src/app/bridge.ts) 调用 [preload.cjs](../electron/preload.cjs) 暴露的接口。主进程注册 `cadenza:`，由 [library.cjs](../electron/library.cjs) 按曲库条目、文件修订和授权范围提供媒体、封面、MV 等资源。资料目录与启动策略在 [profile.cjs](../electron/profile.cjs)。 | [架构](ARCHITECTURE.md)、[维护](MAINTENANCE.md) |
| 播放与媒体时间 | 界面和系统命令进入 [player.ts](../src/app/playback/player.ts)，由 [coordinator.ts](../src/app/playback/coordinator.ts) 管理队列、请求代次和输出交接。[outputs.ts](../src/app/playback/outputs.ts) 选择后端。普通路径在 [media-output.ts](../src/app/playback/media-output.ts) 把媒体元素接入 [Web Audio 图](../src/engine/audio.ts)，Hi-Fi 路径从 [hifi.ts](../src/app/playback/hifi.ts) 和 [hifi-clock.ts](../src/app/playback/hifi-clock.ts) 接收原生事件和时间观测。视觉消费当前有效输出提供的歌曲时间。 | [引擎](parts/engine.md)、[G4R](G4R.md) |
| Rust 原生音频 | [audio.cjs](../electron/audio.cjs) 管理原生进程与 IPC。[main.rs](../native/cadenza-audio/src/main.rs) 是原生入口，[player.rs](../native/cadenza-audio/src/player.rs) 管播放， [output.rs](../native/cadenza-audio/src/output.rs) 管设备及缓冲，[clock.rs](../native/cadenza-audio/src/clock.rs) 将设备观测映射到媒体位置。媒体时间的实测依据随输出后端不同，物理 DAC 延迟需独立验证。 | [G4R](G4R.md)、[测试](TESTING.md) |
| 曲库、身份与缓存 | [library.cjs](../electron/library.cjs) 管扫描、用户资料、后台索引与缓存。 [audio-identity.cjs](../electron/audio-identity.cjs) 调用原生 [identity.rs](../native/cadenza-audio/src/identity.rs) 识别音频内容。曲目条目身份独立于内容身份，重复内容可共享分析，用户编辑仍按条目保存。 | [内容身份](IDENTITY.md)、[G5.5-R](G55-R.md) |
| 后台任务与音乐分析 | [playback/analysis.ts](../src/app/playback/analysis.ts) 调用曲库的任务接口，按内容修订提交。[rhythm/index.ts](../src/rhythm/index.ts) 和 [file-analysis.worker.ts](../src/rhythm/file-analysis.worker.ts) 处理 DSP、分块和渐进交付，[neural/index.ts](../src/rhythm/neural/index.ts) 与 [inferHost.cjs](../electron/inferHost.cjs) 连接 Beat This!、HTDemucs 和可用运行时。[RhythmMap](../src/rhythm/map.ts) 按媒体时间向视觉提供分析结果。 | [节奏](parts/rhythm.md)、[G6](G6.md)、[G8](G8.md) |
| 歌词与 AI | [src/lyrics](../src/lyrics) 负责歌词模型、解析及多轨结构，[tag-lyrics.cjs](../electron/tag-lyrics.cjs) 处理标签写入。[lyric-service.cjs](../electron/lyric-service.cjs) 与 [ai-lyrics.cjs](../electron/ai-lyrics.cjs) 提供按需联网查询及翻译。译文先进入可审核草稿，按目标字段保存。 | [歌词](parts/lyrics.md)、[服务](G55-F.md) |
| 视觉 Session 与 GPU | [session.ts](../src/engine/session.ts) 组织歌词、分析、样式和规划，[engine.ts](../src/engine/engine.ts) 建立时间与帧输入，[renderer.ts](../src/render/renderer.ts) 按图层合成，[gpu.ts](../src/render/gpu.ts) 处理字形和图集。 | [引擎](parts/engine.md)、[渲染](parts/render.md)、[G7](G7.md) |
| 原生导演、Folia 与风格世界 | [src/director](../src/director) 负责原生排版、镜头和转场规划。[render/engines.ts](../src/render/engines.ts) 选择独立风格世界，Folia 的 [风格执行层](../src/folia/engines) 与 [Pixi 兼容层](../src/folia/pixi) 运行自己的场景。上游版本及本地补丁由 [upstream.json](../src/folia/upstream.json) 和 [同步脚本](../scripts/folia-sync.mjs) 管理。 | [导演](parts/director.md)、[Folia](FOLIA.md) |
| 风格与预设 | [theme/style.ts](../src/theme/style.ts) 定义风格数据和默认值，[preset-choice.ts](../src/app/preset-choice.ts) 连接实际日常选择。[风格执行层](../src/render/engines.ts) 决定能力、镜头归属及公共效果槽位。完整风格应用、局部外观与运动覆盖、个人和单曲配置仍需区分。 | [风格系统](STYLE-SYSTEM.md) |
| 空间玩法 | [SpaceShell.tsx](../src/app/space/SpaceShell.tsx) 与 [world.ts](../src/app/space/world.ts) 管展馆、交互及空间音频路由，共用曲库、播放协调和命令。当前仍从已有启动路径进入。 | [空间](SPACE.md)、[产品](PRODUCT.md) |
| 工坊与导出 | [project.ts](../src/app/workshop/project.ts) 管独立工坊项目与时钟。 [export.ts](../src/engine/export.ts) 用快照、独立引擎及固定帧时间执行同一套渲染，[export-file.cjs](../electron/export-file.cjs) 管桌面输出的暂存与提交。 | [引擎](parts/engine.md)、[G8](G8.md) |

其他常用位置包括 `src/app/views`（经典界面）、`src/text`（字体与分词）、`src/i18n`（文案）、`scripts`（构建及上游维护）、`tests`（单元、桌面、性能与基线）和 `docs`。构建产物在 `dist-app`、`dist-web`、`dist-harness` 及 `release`。

## 产品与工程边界

- 正常播放始终有最高资源优先级。音乐分析不能阻塞起播，分析与 GPU 视觉引擎优先于工坊和导出。播放时钟推进歌曲时间，节奏提供拍点与特征。
- 优先沿用已有身份、任务和缓存基础设施。派生缓存适合小文件化，按真实依赖精确失效，充分复用有效数据，并和用户资料分开清理。
- 各风格拥有自己的导演、镜头和视觉世界，共享音乐理解、渲染资源及时间契约。Folia 的维护以理解和还原上游原生行为为起点，再做有依据的改良。特效歌词默认 **16:10**，用户已保存的比例继续生效。空间属于同一个播放器的玩法。
- 在线音乐厅及在线音乐播放、下载、音乐平台账号业务已经取消。在线歌词搜索、官方 Sign in with ChatGPT、OpenAI API、DeepSeek API 和兼容 API 仍是有效功能，按用户操作及相应授权使用。 [产品边界](PRODUCT.md) · [服务实现](G55-F.md)

## 在 Windows 开发与验证

在仓库根目录运行。需要 Node.js/npm，原生构建使用 Rust `x86_64-pc-windows-gnu` 与对应 GNU 工具链。桌面与浏览器测试另需可由 Node 解析的 Playwright，涉及媒体样本的套件按需准备 FFmpeg/FFprobe。Windows PowerShell 如拦截 npm 的脚本入口，可使用 `npm.cmd` 和 `npx.cmd`。

~~~powershell
npm ci
npm run typecheck
npm test
npm run build:native
npm run build:app
npm run electron
node tests/desktop.cjs <截图目录>
node tests/product-desktop.cjs
node tests/rhythm-analysis-desktop.cjs --progressive --watch
node tests/output-handoff-desktop.cjs
npx vite build --mode harness
node tests/render.cjs export exportMode exportCancel
npm run build:web
npm run dist:win -- --publish never
~~~

按改动范围选择测试。命令中的截图目录需替换为实际路径。安装或首次运行开发构建前先读资料版本规则，桌面验证使用隔离 profile 与合成素材。可用 `CADENZA_TEST_EXE` 的脚本可指向同提交拆包 EXE。默认输出交接脚本使用模拟设备，`--real` 走真实 Windows 设备，硬件覆盖与证据边界分别记录。打包是本地操作，发布另按授权执行。 [测试入口与前置条件](TESTING.md) · [维护与发布规则](MAINTENANCE.md)

## 推荐阅读顺序

1. 先读本页和 [PRODUCT.md](PRODUCT.md)，再读 [ARCHITECTURE.md](ARCHITECTURE.md) 对照实际调用链。
2. 动手前看 [CLAUDE.md](../CLAUDE.md)、[项目 Skill](../.claude/skills/cadenza/SKILL.md) 和 [TESTING.md](TESTING.md)，之后按 [文档地图](README.md) 查模块细节。设计和预设分别看 [DESIGN.md](DESIGN.md) 与 [STYLE-SYSTEM.md](STYLE-SYSTEM.md)。
3. 按问题回查 [方向记录](DIRECTION.md)、各阶段报告与 [历史资料](history)。历史报告保留当时的环境、样本和证据。任务范围以用户当前授权为准，技术决策可通过源码和复现实验重新评估。

建议接手者按后续授权自行复核 G8 报告中的长曲跳转优先分析、完整神经分离的吞吐、Folia 全曲场景还原、GPU 长帧和高分辨率内存，以及超长作品的导出 PCM 占用。涉及输出设备时，分别验证图内信号、设备消费时间和物理端点，沿用已有观测口径。
