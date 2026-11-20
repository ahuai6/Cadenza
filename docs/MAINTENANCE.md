# 维护

发布、跟上游、依赖、数据与缓存、开发环境的坑。写给接手维护的人（或 Agent）。

## 发布

1. 版本号改 `package.json` 与 `package-lock.json`（两处的 `version`）。
2. `docs/RELEASE.md` 最上面加一段 `## Cadenza x.y.z`：写给用户看，改了什么、为什么，不写实现细节。发布页的说明就是这一段（工作流只取这个版本自己的那一段）。
3. 跑完 `docs/TESTING.md` 的必过项目，以及改到的部分对应的测试。
4. 提交，推到 `space-mode`（触发 `preview` 工作流：在 Windows 上建置，产物留在那次执行的 Artifacts，不发布）。
5. 快转推到 `main`：`git push origin space-mode:main`。`release` 工作流在 Windows 上跑类型、单元测试、建置、下载模型、编译 Rust 播放核心、打包，然后创建 `vX.Y.Z` 发布（安装包、blockmap、便携版）。同一个版本已经有发布时会略过，所以**没改版本号的推送不会重新发布**。
6. 等工作流完成，把发布页链接汇报给用户。

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

- 节奏分析与响度以**音频本体的哈希**为键（`electron/library.cjs` 的 `audioKey`），改标签、改名、搬移都不会重新分析。分析的格式有版本（`RHYTHM_VERSION`）；改了分析的输出就提高版本，旧缓存会被当成过期重新分析。
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
