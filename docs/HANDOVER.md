# Cadenza 开发交接

Cadenza 是以本地音乐为核心的播放器，提供曲库、歌单、队列、普通与 Hi-Fi 输出、桌面歌词、随音乐变化的特效歌词、空间玩法、歌词工坊及 MP4 导出。交接基准为 `refactor/4.0.0` 的 G8 提交 `d11dc47`，当时的开发版本为 `4.0.0-alpha.4`。G8 已提交其实现和测量记录，其中仍有未闭环的验收项。之后的工作按下文「接手后的阶段路线」推进。版本和运行时以 [package.json](../package.json) 与锁文件为准。

当前主运行环境是 Windows x64、Electron 45.1.0、React、TypeScript 和 Vite。普通输出使用 Web Audio，Hi-Fi 由 Rust/Symphonia/WASAPI 提供。二维音乐视觉使用 WebGL2、GPU 批次与局部 Canvas2D，空间场景使用 Three.js。神经推理采用 WebGPU 或桌面 ONNX 运行时，视频使用 WebCodecs 与 Mediabunny。Android 是未来目标，当前没有 Android 客户端。

## 入口与调用关系

| 模块 | 源码入口、职责与调用关系 | 深入阅读 |
| --- | --- | --- |
| Electron 主进程与 Renderer | [main.cjs](../electron/main.cjs) 管理单实例、资料生命周期、窗口和系统集成，加载 `dist-app/index.html`。桌面 [index.html](../index.html) 和网页 [web.html](../web.html) 都进入 [app/main.tsx](../src/app/main.tsx)，再挂载适用界面。 | [架构](ARCHITECTURE.md)、[应用](parts/app.md) |
| IPC 与本地资源 | Renderer 经 [bridge.ts](../src/app/bridge.ts) 调用 [preload.cjs](../electron/preload.cjs) 暴露的接口。主进程注册 `cadenza:`，由 [library.cjs](../electron/library.cjs) 按曲库条目、文件修订和授权范围提供媒体、封面、MV 等资源。资料目录与启动策略在 [profile.cjs](../electron/profile.cjs)。 | [架构](ARCHITECTURE.md)、[维护](MAINTENANCE.md) |
| 播放与媒体时间 | 界面和系统命令进入 [player.ts](../src/app/playback/player.ts)，由 [coordinator.ts](../src/app/playback/coordinator.ts) 管理队列、请求代次和输出交接。[outputs.ts](../src/app/playback/outputs.ts) 选择后端。普通路径在 [pcm-output.ts](../src/app/playback/pcm-output.ts) 把原生解码的 PCM 经 Worker 送进 [Web Audio 图](../src/engine/audio.ts) 的 AudioWorklet，Hi-Fi 路径从 [hifi.ts](../src/app/playback/hifi.ts) 和 [hifi-clock.ts](../src/app/playback/hifi-clock.ts) 接收原生事件和时间观测。视觉消费当前有效输出提供的歌曲时间。 | [引擎](parts/engine.md)、[G4R](G4R.md) |
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

在仓库根目录运行。需要 Node.js/npm，原生构建使用 Rust `x86_64-pc-windows-gnu` 与对应 GNU 工具链。桌面与浏览器测试另需可由 Node 解析的 Playwright，涉及媒体样本的套件按需准备 FFmpeg/FFprobe；经典界面与 Hi-Fi 桌面套件的素材需要 Python 的 NumPy 和 Pillow（MSYS2 安装与生成步骤见 [测试](TESTING.md#桌面测试素材)）。Windows PowerShell 如拦截 npm 的脚本入口，可使用 `npm.cmd` 和 `npx.cmd`。

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

全新 Windows 机器上的构建前提（2026-11 实测）：

- Rust 用 rustup 安装 `stable-x86_64-pc-windows-gnu`。`windows` crate 在 GNU 目标上需要完整的 `dlltool` 与 `as`。rustup 自带的 `self-contained/dlltool.exe` 缺汇编器，用 `llvm-ar` 冒充 `dlltool` 生成的程序启动即访问冲突。可用做法是装 MSYS2 并安装 `mingw-w64-ucrt-x86_64-toolchain`，构建时把 `C:\msys64\ucrt64\bin` 放在 PATH **末尾**，并设 `RUSTFLAGS=-C link-self-contained=yes`，只借用它的 `dlltool` 与 `as`，链接仍用 Rust 自带的 MinGW 运行库。
- 新版 npm 会拦截依赖的安装脚本。`npm ci` 后若缺 `node_modules/electron/dist`，运行 `node node_modules/electron/install.js` 补装（按包内 `checksums.json` 校验）。`onnxruntime-node` 的 Windows DirectML 二进制已在包内，被拦截的脚本不影响本地推理。
- 打包前 `node scripts/models.mjs` 下载并校验 WebGPU 权重；ONNX 权重由应用在用户请求时下载到资料目录。

按改动范围选择测试。命令中的截图目录需替换为实际路径。安装或首次运行开发构建前先读资料版本规则，桌面验证使用隔离 profile 与合成素材。可用 `CADENZA_TEST_EXE` 的脚本可指向同提交拆包 EXE。默认输出交接脚本使用模拟设备，`--real` 走真实 Windows 设备，硬件覆盖与证据边界分别记录。打包是本地操作，发布另按授权执行。 [测试入口与前置条件](TESTING.md) · [维护与发布规则](MAINTENANCE.md)

## 接手后的阶段路线

产品的核心是完整的本地播放体验，音乐分析是为播放服务的基础设施。阶段按对听感和使用体验的影响排序。每个阶段完成实现与对应测试后，在本机打包一个 alpha 版本（NSIS 安装包与便携版）交给用户试用，修完反馈再进入下一阶段。

| 阶段 | 目标 | 主要内容 |
| --- | --- | --- |
| 0 准备与基线 | 本机打包流程可用，用户先试用现状 | 检查工具链与模型；开发版跨版本保留资料（`alpha.5`）；打包 G8 基线 |
| 1 播放连续性 | 听感上没有断点和杂音 | 普通输出改为自建 PCM 管线，普通输出与 Hi-Fi 无缝续播；MP4 编码器延迟裁剪；Hi-Fi 时钟以原生时间戳为锚；切歌时画面与歌词的交接（alpha.6） |
| 2 曲库与数据 | 大曲库流畅，数据归属唯一 | 曲库索引增量持久化与增量推送；外观、预设、单曲选择、工坊项目迁回主进程存储；拆分 `player.ts` 的编排职责（从阶段 1 移来）；大曲库压力测试（alpha.7） |
| 3 分析不打扰播放 | 分析在后台完成，不抢播放与画面资源 | 分析数据不经界面主线程中转；统一工坊与曲库的分析管线；只做对体验有用的质量升级 |
| 4 视觉世界独立 | 各风格拥有自己的规划和生命周期 | 视觉世界接口；Folia 不再依附原生导演的规划；下一首场景随音频预读预先就绪；对照新的上游 Folia |
| 5 渲染路线 | 解决高分辨率长帧 | 先做原型与实测，由用户在「优化现有混合管线」和「建立 GPU 帧图」之间决定，再实施 |
| 6 界面整合 | 书页设计覆盖全局 | 全局布局、完整预设、空间与经典即时切换、特效歌词 16:10 |
| 7 收尾与发布准备 | 达到 4.0.0 正式版质量 | 工坊与导出遗留问题、文档重整、全量回归；用户批准后合入 `main` |

阶段 4 和阶段 6 动工前先给出接口设计请用户过目，阶段 5 由用户决定路线。

### 试用反馈与归属

| 来源 | 现象 | 根因 | 归属 |
| --- | --- | --- | --- |
| alpha.5 | 特效歌词内切歌时整个画面黑屏，音乐已经切过去 | `Engine.clear()` 置空会话后，渲染循环只清空画布；旧画面的淡出只在有会话时绘制，新会话就绪后又无过渡地出现。视觉构建要等音频准备完成后才开始 | 阶段 1 已修（alpha.6） |
| alpha.5 | 歌曲加载后，主页与正在播放页的歌词瞬间出现 | 歌词随异步加载到达，没有入场交接 | 阶段 1 已加入场（alpha.6），整体动效在阶段 6 |
| alpha.5 | 部分歌曲分析失败：速度与拍点不一致 | 神经网络路径的速度取 8 拍跨度间隔的中位数，校验取单拍间隔的中位数，有停顿或变速的歌两者可差 8%，正常结果被当成损坏数据 | 阶段 1 已修（alpha.6），旧失败记录自动重试 |
| alpha.6 | 特效歌词内拖动进度条或「上一首」回到开头后画面卡住不动 | 普通输出跳转时记下目标位置，新流开始发声后没有清除，时钟一直停在目标位置；之后暂停再继续还会跳回该位置 | 已修（alpha.6.1），回归见 `continuity-desktop.cjs` 与 `streaming-desktop.cjs` |
| alpha.6.1 | 连续切多首歌时特效歌词黑屏 | 第一次切歌保留了上一首的画面，新场景就绪前再切一次时已没有当前场景可截取，引擎丢掉了保留中的画面 | 阶段 2 已修（alpha.7），回归见 `continuity-desktop.cjs` |
| alpha.6 | 特效歌词内手动切歌时画面停顿约半秒 | 下一首的场景要等切过去后才开始构建，其间显示上一首的静止快照；新场景第一次绘制时现场创建图层与排版，出现一帧 100 ms 左右的长帧 | 阶段 3–4：随音频预读预先构建下一首场景，首帧准备移出显示帧 |
| alpha.6 | 仅神经网络模式下分鼓（HTDemucs）在本机原生推理失败，只得到拍点 | 待查 | 阶段 3 |
| alpha.5 | 仅神经网络模式下偶发 `neural engine unavailable` | 任意一个推理窗口失败就使整首失败，且失败后要等设置变化或手动重新识别才重试 | 阶段 3 |
| alpha.5 | 新歌和拖动后没有节奏响应，整曲完成后才明显叠化切换 | 流式交付只提供能量、频谱和零散拍点，导演规划仍基于空节奏构建，直到完整结果到达才重规划并叠化；解码不按跳转位置重排 | 阶段 3 |
| alpha.5 | 「后台任务」的「重新扫描并验证」看不出作用 | 它重扫文件夹并重试指纹失败，不重试面板列出的分析失败；与设置的「重新识别」（清除全部分析）职责不同 | 阶段 3 |
| alpha.5 | 界面不统一、排版、背景色、网格对齐 | — | 阶段 6 审查后处理 |

## 推荐阅读顺序

1. 先读本页和 [PRODUCT.md](PRODUCT.md)，再读 [ARCHITECTURE.md](ARCHITECTURE.md) 对照实际调用链。
2. 动手前看 [CLAUDE.md](../CLAUDE.md)、[项目 Skill](../.claude/skills/cadenza/SKILL.md) 和 [TESTING.md](TESTING.md)，之后按 [文档地图](README.md) 查模块细节。设计和预设分别看 [DESIGN.md](DESIGN.md) 与 [STYLE-SYSTEM.md](STYLE-SYSTEM.md)。
3. 按问题回查 [方向记录](DIRECTION.md)、各阶段报告与 [历史资料](history)。历史报告保留当时的环境、样本和证据。任务范围以用户当前授权为准，技术决策可通过源码和复现实验重新评估。

建议接手者按后续授权自行复核 G8 报告中的长曲跳转优先分析、完整神经分离的吞吐、Folia 全曲场景还原、GPU 长帧和高分辨率内存，以及超长作品的导出 PCM 占用。涉及输出设备时，分别验证图内信号、设备消费时间和物理端点，沿用已有观测口径。
