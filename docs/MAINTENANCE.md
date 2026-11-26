# 维护

歌词与 AI 上游按需核对单个协议，并用隔离的合成响应验证，不设构建前公网探测。 [维护与验收](G55-F.md)

发布、跟上游、依赖、数据与缓存、开发环境的坑。写给接手维护的人（或 Agent）。

## 本机开发与验收

### 按需调用的开发工具

工具只装在开发机用户目录，Cadenza 构建、运行和测试仍使用仓库自己的入口。安装前检查 Codex 的技能清单和 `codex mcp list`。复审用新启动的 Codex 服务扫描用户级技能、发现 MCP 并实际调用。已有会话若保留旧工具清单，重新载入会话。浏览器只打开隔离测试页和合成资料。本次复审的桌面运行时为 Electron 45.1.0、Chromium 156.0.8078.49、Node 24.22.1。

| 任务 | 已接入与验证 | 用法与边界 |
| --- | --- | --- |
| React 状态与开销 | `vercel-react-best-practices` 1.0.0 | 查阅订阅粒度、派生状态、热路径规则。Electron 不采用 Next.js 服务端策略。[上游](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) |
| React UI 组合 | `vercel-composition-patterns` 1.0.0 | 检查组件职责与可替换性。GPU 视觉组合沿用项目自己的配置、能力与渲染协议。[上游](https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns) |
| 焦点、键盘与无障碍 | `web-design-guidelines` 1.1.0 | 按页面抽查交互。方向 B「书页」继续作为设计基准。[上游](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) |
| Web API 与兼容性 | Modern Web Guidance CLI 1.0.1 与 `modern-web-guidance` | 已验证 `search "CSS animations and transitions"` 和 `retrieve motion`。按主题检索，新 API 先查项目锁定的 Electron/Chromium 行为。未来 Android WebView 单独核对。[官方入门](https://developer.chrome.com/docs/modern-web-guidance/get-started?hl=zh-cn) |
| 浏览器性能、网络与内存 | `chrome-devtools` Skill 和 Chrome DevTools MCP 1.13.0 | 已通过 Codex 打开隔离页、读结构、执行页面查询并采集 trace。使用 `--isolated --headless --no-usage-statistics --no-performance-crux --memory-debugging` 启动，按需使用内存工具。[官方仓库](https://github.com/ChromeDevTools/chrome-devtools-mcp) |
| 浏览器交互探索 | Playwright CLI 0.1.25 与 `playwright-cli` | 用户级 CLI 与 `install --skills=agents --global`。已验证隔离浏览器的快照、Tab 焦点和 Enter 激活。Electron 回归仍用项目的 Playwright 脚本。[上游](https://github.com/microsoft/playwright-cli) |
| G7 WebGL2 绘制诊断 | Spector.js MCP，工具版本 1.1.0，Spector.js 0.9.33，上游提交 `755e6a7` | 已在隔离 WebGL2 页面捕获绘制命令并读取 draw call。后续优先用它检查合成、绘制、纹理与 GL 状态。真实 GPU 执行时间、驱动、显存及 Folia 保真另验。[构建与工具文档](https://github.com/BabylonJS/Spector.js/blob/master/mcp/README.md) |

Vercel 的实际标识用 `npx skills add vercel-labs/agent-skills --list` 查询，再以 `--agent codex --global --skill` 安装指定项。Chrome DevTools Skill 来自同名官方仓库的 `skills/chrome-devtools`。Windows 的 MCP 可经 `cmd.exe /d /s /c npx.cmd --yes` 启动固定版本的包。Spector.js 在独立检出下安装并构建 `mcp/`，用上游锁定的 Playwright 安装 Chromium，使用根目录构建的 Spector bundle 或 MCP 文档所述 npm 回退，再用 `codex mcp add spector -- node <mcp/dist/index.js>` 注册。浏览器与调试器的安装留在用户目录。

### 官方技术资料索引

| 阶段 | 资料与用途 |
| --- | --- |
| G2–G3 播放与时钟 | [getOutputTimestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp) 与 [Web Audio 规范](https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp) 解释输出时间采样与外推。[MediaElementAudioSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaElementAudioSourceNode) 用于比较普通输出后端。[Electron protocol](https://www.electronjs.org/docs/latest/api/protocol) 用于核对自定义协议、流和范围请求。[Mediabunny](https://mediabunny.dev/guide/introduction) 用于评估解复用与流式媒体。 |
| G4 Windows 音频设备 | 流位置通过频率换算，设备位置和流延迟用于诊断。比较轮询、事件驱动与共享周期时，记录具体驱动、下溢和 CPU，并保留 USB DAC 锁定验证。[流时钟](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclock-getposition) · [设备时钟](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclock2-getdeviceposition) · [流延迟](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-getstreamlatency) · [独占流](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams) · [共享周期](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-iaudioclient3) · [无效设备恢复](https://learn.microsoft.com/en-us/windows/win32/coreaudio/recovering-from-an-invalid-device-error) |
| G5–G6 文件、身份和缓存 | [Symphonia](https://github.com/pdeljanov/Symphonia) 用于核对容器和音频载荷。[Node crypto](https://nodejs.org/api/crypto.html) 用于增量 SHA-256。[Electron app](https://www.electronjs.org/docs/latest/api/app) 用于资料路径、单实例和启动生命周期。[Windows 重解析点](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points) 用于路径安全检查。 |
| G7 WebGL2、PixiJS 与 Folia | PixiJS 8 [渲染器](https://pixijs.com/8.x/guides/components/renderers)、[滤镜](https://pixijs.com/8.x/guides/components/filters)、[性能](https://pixijs.com/8.x/guides/concepts/performance-tips) 和 [WebGL 工程实践](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)。先核对 Folia 锁定 API 与 Chromium 实测能力，再评估迁移。 |
| G8–G9 工坊、导出和界面 | [Mediabunny 写入媒体](https://mediabunny.dev/guide/writing-media-files)、[Playwright ElectronApplication](https://playwright.dev/docs/api/class-electronapplication)、[React 状态结构](https://react.dev/learn/choosing-the-state-structure) 与 [Electron 性能](https://www.electronjs.org/docs/latest/tutorial/performance)。用于帧输出、状态所有权、桌面端到端与性能诊断。 |

### 4.0.0 重构期间

- 从保留完整历史的 G0 提交开始，G1–G9 在 `refactor/4.0.0` 上按独立授权开发。每个 Goal 在 Windows 本机构建、启动并完成对应测试后提交，只推送 `origin/refactor/4.0.0`。报告提交 SHA、GitHub 链接、实际验证和剩余问题，随后停在该阶段验收。
- G4 和 G4R 使用 `4.0.0-alpha.4`，数据代次与结构版本仍为 1。`alpha.3` 应用资料会在首次运行 `alpha.4` 时按 G1 规则清理一次。G4R 只递增曲库内部标签扫描版本，保留应用资料。Electron 和原生程序一起构建，主进程在握手时检查原生时钟协议，ALAC 媒体源也需要更新后的原生程序。运行开发验证使用独立资料目录。 [G4R 复审记录](G4R.md)
- G5 保持同一程序版本及资料代次，单独迁移曲库索引到 v2。旧索引备份位于应用资料的 `library/db.v1.json`。身份索引和节奏缓存需要配套的原生程序。遇到损坏的索引时保留文件并显示错误，先核对备份及错误位置。 [内容身份与修订](IDENTITY.md)
- 阶段构建、运行和测试全部在本机。每次阶段开始核对仓库工作流的触发条件。当前 `release` 的自动触发只监听 `main`，另有手动入口，`preview` 与 `release-notes` 仅手动触发。保持工作流原样，重构期间不推送远端 `main` 或标签，不触发 Actions、预览或发布。
- G0–G9 全部完成、4.0.0 正式版本机通过验收且用户明确批准发布后，才合入并推送 `main`。阶段推送属当前 Goal 的收尾动作，下一 Goal 与正式发布各自独立授权。

### 常规维护

日常开发直接在本地 `main` 上进行。只有影响较大、需要独立测试的改动才临时开分支，验收通过后再合回 `main`。

先在用户的 Windows 本机构建并启动改好的版本，验证受影响的操作，再把本机可打开的版本交给用户体验。常规桌面开发首次检出或依赖变更后运行 `npm ci`，然后用 `npm run electron` 构建并启动。涉及原生音频或安装流程时，提供能覆盖对应功能的本机构建。用户确认本地版本后，再推送或手动触发 GitHub 构建。

需要 GitHub 预览包时，在本机验收后推送临时分支，在 Actions 中打开 `preview`，手动选择该分支运行。安装包和便携版在该次执行的 Artifacts 中下载。

## 发布

4.0.0 先满足上面的重构发布条件，再执行以下正式发布步骤。

1. 版本号改 `package.json` 与 `package-lock.json`（两处的 `version`）。
2. `docs/RELEASE.md` 最上面加一段 `## Cadenza x.y.z`：写给用户看，改了什么、为什么，不写实现细节。发布页的说明就是这一段（工作流只取这个版本自己的那一段）。
3. 跑完 `docs/TESTING.md` 的必过项目和改动对应的测试，完成本机验收。
4. 提交并推送 `main`（`git push origin main`）。`release` 工作流在 Windows 上跑类型检查和单元测试，构建桌面端、下载模型、编译 Rust 播放核心并打包，然后创建 `vX.Y.Z` 发布（安装包、blockmap、便携版）。同一个版本已有发布时会跳过构建与发布。
5. 等工作流完成，把发布页链接汇报给用户。

查状态（这个环境的 GitHub GraphQL 被挡，一律用 REST）：

```
gh api repos/ahuai6/Cadenza/actions/runs --jq '.workflow_runs[] | select(.name=="release") | [.id,.status,.conclusion] | @tsv' | head -3
gh api repos/ahuai6/Cadenza/releases/latest --jq '.tag_name+" "+(.assets|map(.name)|join(","))'
```

推送遇到网络错误时以指数退避重试，最多四次。提交消息写清实际改动与目的，提交消息与代码里不写模型名称。`release-notes` 工作流只在要重写旧版本的说明时手动执行。

## 跟上 Folia 上游

全部步骤在 `docs/FOLIA.md`。要点：

- 只改 `src/folia/upstream.json`（commit、要搬的文件、要抽出的声明、shim、修补），跑 `node scripts/folia-sync.mjs <checkout>`；`src/folia/vendor/` 是产生的，**不手改**。
- 同步脚本遇到未对应的 import、找不到的声明、不再吻合的修补会失败并列出来。
- 更新后跑 `FOLIA_UPSTREAM=<checkout> npx vitest run tests/unit/folia.test.ts`，再跑 `docs/TESTING.md` 的 Folia 对照，把数字更新到该文档的表。

## 依赖

- 采用通过验证的稳定版本，精确锁定（`package.json` 不用 `^`，`Cargo.toml` 用 `=`）。升级单独提交并检查行为、兼容性及性能。能保护已支持设备和格式的适配代码需说明原因、验证方法和退役条件。`@types/node` 跟 Electron 内置的 Node 主版本。
- 神经网络模型不进 git：`scripts/models.mjs` 依 `src/rhythm/neural/models.json` 的 SHA-256 下载并校验；桌面版的 ONNX 模型由用户在设置里下载。
- 字体全部 SIL OFL 1.1，`npm run build:app` 时由 `scripts/fonts.mjs` 复制进 `dist-app/fonts`；收录表用 `npm run fonts:coverage` 重烤，菜单预览图用 `npm run fonts:previews`。
- 设置纲要改了要跑 `npm run gen:settings`（单元测试会检查默认值档是否过期）。

## 数据、缓存与兼容

### 4.0.0 启动与数据断代

- `electron/profile-build.json` 记录发行阶段、数据代次和持久化结构版本。4.0.0 开发版在程序版本或数据代次变化时清空已知受管数据。同版本、同代次重复启动保留资料。正式版将阶段从 `development` 改为 `stable`，即使显示版本号与候选版相同，也会执行一次正式断代。
- 中断事务恢复也检查外部模型目录的配置路径与实际路径。若与待清理的原位置或事务隔离目录重叠，保留事务和文件，报告冲突并等待修正配置。
- 安装、便携及本地构建都使用同一个 Cadenza 应用数据根和旧版使用的单实例锁。先取得锁，再处理 `.cadenza-data/pending.json`。重置把已知受管项移入同卷的暂存目录，清理完成后才发布当前代次并打开应用服务。占用、链接、Windows 重解析点或中断时显示错误并停止，解决问题后重新启动会继续未完成的事务。
- 清理范围为已知的设置、曲库、应用内曲目资料、模型缓存和 Chromium 存储等。启动不会访问曲库索引指向的音乐目录来执行清理。根目录中未认领的项目、外部音乐、歌词、MV、导出和独立前代应用目录保留。发现冲突的外部模型目录或受管目录内的媒体文件时先停止。旧 Lyric Motion 自动导入已关闭。
- 4.0.1 起，从已完成正式断代的资料继续升级。程序版本变化保留设置、库和有效缓存。变更数据结构时登记明确且可重试的逐级迁移。存在旧资料且从未完成正式断代的用户必须先运行 4.0.0 正式版。全新安装可直接初始化。已初始化的正式资料拒绝被旧 4.0.0 开发版覆盖。
- `CADENZA_USER_DATA` 仅用于系统临时目录内的隔离测试资料，仍执行相同版本策略，并跳过开机启动和全局快捷键等系统集成。手动「清除所有数据」继续通过 `--reset-data` 走同一个安全流程。

### 当前曲库格式

- 节奏分析使用验证后的音频内容身份、`RHYTHM_VERSION` 和分析参数。曲库条目及其用户记录另有独立 ID。G5.5-A 的后台重试耗尽后，可通过重新扫描或重启再次验证同一文件。 [内容身份](IDENTITY.md)
- 每首歌的风格与外观存在用户数据里；`theme/style.ts` 的规范化会把旧格式转成新格式（例如 3.5.0 起镜头 id 是字符串、新增 `transFx`）。**新增字段一律可省略、有默认值**，不要让旧数据读不进来。
- 「我的风格」（`app/motions.ts`）存的是 `motionPart` 的字段；新增属于动态的字段时，也要加进 `motionPart` 与 `withSavedMotion`。
- 用户可在设置里「清除临时数据」与「清除所有数据」；两者的说明不写「缓存」（见 `COPY.md`）。

## 开发环境（云端容器）的坑

- **没有显卡**：浏览器用 SwiftShader 软件绘图。性能只能比相对变化；显卡情境偶尔遗失（对照脚本会重画）。
- **端到端测试要 X**：`Xvfb :99 -screen 0 1920x1080x24 &`，再以 `DISPLAY=:99` 执行。
- **磁盘配额**：写满时浏览器会直接崩溃、建置失败；`df` 的数字不可信。删掉不需要的大档（旧的 `release/`、对照截图、npm 缓存）就能恢复。
- **Folia checkout** 的 `node_modules` 不能在里面 `npm install`（git 依赖会失败并清空既有的套件）；照它的 lockfile 版本另外装好再放进去。
- 长时间的测试放背景跑并把输出写到文件；工作进程重启会中断它们，重跑即可。
- 只能在 Windows 实机确认的：Hi-Fi 独占输出、DirectML 推理、窗口与托盘行为、声音。汇报时明说没有验证。

## 已知的债

- `src/app/space/world.ts` 仍然很大、没有完整类型；改它之前先看 `SKILL.md` 第 3 节的结构，照将来的边界写。
- 主进程能力要改三处（`ipcMain.handle`、`preload.cjs`、`bridge.ts`），还没有由一份契约产生。
- 播放控制（上一首、循环方式）与快捷键还没进指令登记表。
- 旧的审查与核对（`docs/history/`）只作纪录，不代表现况。
