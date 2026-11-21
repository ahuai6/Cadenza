# 维护

发布、跟上游、依赖、数据与缓存、开发环境的坑。写给接手维护的人（或 Agent）。

## 本机开发与验收

### 4.0.0 重构期间

- 从保留完整历史的 G0 提交开始，G1–G9 在 `refactor/4.0.0` 上按独立授权开发。每个 Goal 在 Windows 本机构建、启动并完成对应测试后提交，只推送 `origin/refactor/4.0.0`。报告提交 SHA、GitHub 链接、实际验证和剩余问题，随后停在该阶段验收。
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

推送失败（网络）时以指数退避重试，最多四次。提交消息结尾带这个项目要求的署名行；**提交消息与代码里不写模型名称**。`release-notes` 工作流只在要重写旧版本的说明时手动执行。

## 跟上 Folia 上游

全部步骤在 `docs/FOLIA.md`。要点：

- 只改 `src/folia/upstream.json`（commit、要搬的文件、要抽出的声明、shim、修补），跑 `node scripts/folia-sync.mjs <checkout>`；`src/folia/vendor/` 是产生的，**不手改**。
- 同步脚本遇到未对应的 import、找不到的声明、不再吻合的修补会失败并列出来。
- 更新后跑 `FOLIA_UPSTREAM=<checkout> npx vitest run tests/unit/folia.test.ts`，再跑 `docs/TESTING.md` 的 Folia 对照，把数字更新到该文档的表。

## 依赖

- 一律跟最新稳定版，精确锁定（`package.json` 不用 `^`，`Cargo.toml` 用 `=`）；升级是一次明确的提交并跑完全部测试。上游改 API 就迁移，不留兼容垫片。例外：`@types/node` 跟 Electron 内置的 Node 主版本。
- 神经网络模型不进 git：`scripts/models.mjs` 依 `src/rhythm/neural/models.json` 的 SHA-256 下载并校验；桌面版的 ONNX 模型由用户在设置里下载。
- 字体全部 SIL OFL 1.1，`npm run build:app` 时由 `scripts/fonts.mjs` 复制进 `dist-app/fonts`；收录表用 `npm run fonts:coverage` 重烤，菜单预览图用 `npm run fonts:previews`。
- 设置纲要改了要跑 `npm run gen:settings`（单元测试会检查默认值档是否过期）。

## 数据、缓存与兼容

### 4.0.0 启动与数据断代

- `electron/profile-build.json` 记录发行阶段、数据代次和持久化结构版本。4.0.0 开发版在程序版本或数据代次变化时清空已知受管数据。同版本、同代次重复启动保留资料。正式版将阶段从 `development` 改为 `stable`，即使显示版本号与候选版相同，也会执行一次正式断代。
- 安装、便携及本地构建都使用同一个 Cadenza 应用数据根和旧版使用的单实例锁。先取得锁，再处理 `.cadenza-data/pending.json`。重置把已知受管项移入同卷的暂存目录，清理完成后才发布当前代次并打开应用服务。占用、链接、Windows 重解析点或中断时显示错误并停止，解决问题后重新启动会继续未完成的事务。
- 清理范围为已知的设置、曲库、应用内曲目资料、模型缓存和 Chromium 存储等。启动不会访问曲库索引指向的音乐目录来执行清理。根目录中未认领的项目、外部音乐、歌词、MV、导出和独立前代应用目录保留。发现冲突的外部模型目录或受管目录内的媒体文件时先停止。旧 Lyric Motion 自动导入已关闭。
- 4.0.1 起，从已完成正式断代的资料继续升级。程序版本变化保留设置、库和有效缓存。变更数据结构时登记明确且可重试的逐级迁移。存在旧资料且从未完成正式断代的用户必须先运行 4.0.0 正式版。全新安装可直接初始化。已初始化的正式资料拒绝被旧 4.0.0 开发版覆盖。
- `CADENZA_USER_DATA` 仅用于系统临时目录内的隔离测试资料，仍执行相同版本策略，并跳过开机启动和全局快捷键等系统集成。手动「清除所有数据」继续通过 `--reset-data` 走同一个安全流程。

### 当前曲库格式

- 当前节奏分析按曲目 ID 保存，曲库扫描用抽样的 `audioKey` 判断音频关系。分析数据有 `RHYTHM_VERSION`，提高版本可以使旧分析过期。完整音频身份与独立缓存登记属于后续 G5。
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
