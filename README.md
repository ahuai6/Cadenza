# Cadenza

Cadenza 是一套功能完整的个人音乐库播放器：音乐库管理、高保真输出与音量平衡、节奏分析、多格式歌词（逐字、和声、翻译、读音）、随节奏运镜的特效歌词、歌词工坊与视频导出、桌面歌词，以及可以走动的空间界面。前身是 Lyric Motion，这一版从头重构。

- **音乐库**：扫描你选定的文件夹，读取标签、封面与同名 `.lrc`。编辑模式可以修改歌曲信息和使用本地图片覆盖封面。歌词可按需联网搜索，TTML 编辑可使用 AI 翻译辅助。
- **播放**：支持播放列表与四种播放模式。随机播放会加权，播放次数少的歌更容易被选中。另有 Hi-Fi 输出（WASAPI 独占、比特完美）。
- **正在播放**：背景直接由引擎绘制，用的是这首歌的封面与节奏；歌词逐字浮起。
- **特效歌词**：从正在播放页无缝交接，封面和歌词会飞入画面。外观（背景、颜色、字体）与风格（排版、镜头、转场）任意搭配，每首歌各自绑定，也可以绑定 MV。除了 Cadenza 自己的六种风格，还有移植自 Folia 的商籁、凝彩与五种背景。
- **空间界面**：同一个播放器的另一种走法——可以走动的展馆，空中的歌词、收音机、聆听室的六声道。
- **歌词工坊**：独立的项目，可以导出 MP4（WebCodecs）。
- **网页版**：`dist-web/web.html` 是单一 HTML 文件，内含完整的歌词工坊。

本程序严格遵守各平台的授权与 DRM。流式平台加密的文件（`.ncm`、`.qmc*`、`.kgm` 等）只会列出，并标示为「受平台保护」，绝不解密、不播放。

4.0.0 开发分支支持无保护 ALAC/M4A。普通播放使用按需解码，Hi-Fi 直接读取原文件。工坊和导出也可使用 ALAC 音频。 [格式与验证记录](docs/G4R.md#b-alac扫描与写入验证)

## 架构

所有文档从 [`docs/README.md`](docs/README.md)（文档地图）开始；架构总览在 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，开发范式在 `.claude/skills/cadenza/SKILL.md`。

```
core → rhythm（节奏 SDK）→ director（规划）／folia（Folia 风格）→ render（绘制与特效插件）→ engine（时钟、Session、交接、导出）→ app（界面：经典与空间）
lyrics / text / theme / i18n 为叶子模块
```

- **播放协调**（`src/app/playback`）：队列、播放意图和输出由统一状态机管理。普通输出与 Hi-Fi 各自准备音频，歌词、节奏和视觉规划在后台接入。
- **节奏 SDK**（`src/rhythm`）：做起音侦测、速度、拍点、小节与强拍、重拍分级、反拍与抢拍、段落、Drop 与 Build。分析在 Worker 中进行，结果以 `RhythmAnalysis` 带版本缓存。查询接口是 `RhythmMap`，弹簧信号由 `Signals` 提供。
  - 拍点有两个引擎：
    - **神经网络**（Beat This! 与 HTDemucs，在 GPU 上执行，移植自 Folia）；
    - **内置**（没有可用的 GPU 时自动使用）。
  - 两者输出同一份 `RhythmAnalysis`，详见 `docs/ARCHITECTURE.md`。
- **Director**：歌曲加载时一次规划版面、镜头路径、转场与片头。播放时只按时间求值，所以预览、预读和导出画出的画面完全一致。
- **特效**：在 `src/render/effects` 注册（id、图层、参数定义、`draw`）。界面会依参数定义自动产生控制项。
- **界面动态**：多部件的动画都由同一个弹簧进度驱动，可以随时反向，不会卡在半途。

## 开发

```sh
npm install
npm run typecheck && npm test            # 单元测试（节奏、歌词、Director）
npm run build:app                        # 桌面界面 → dist-app（含全部字体，可离线使用）
npm run build:web                        # 网页版工坊 → dist-web/web.html
npx vite build --mode harness && node tests/render.cjs   # 绘制测试（主题、裁剪、性能、导出）
xvfb-run -a node tests/desktop.cjs <截图文件夹>          # 桌面端到端测试
xvfb-run -a node tests/space.cjs <截图文件夹>            # 空间界面端到端测试
node tests/hifi.cjs && xvfb-run -a node tests/desktop-hifi.cjs   # Hi-Fi（模拟 DAC）
node scripts/models.mjs                  # 神经网络节奏引擎的模型 → models/（按 SHA-256 校验）
node tests/neural.cjs                    # 神经网络引擎端到端（真实模型，WebGPU；无显卡时用 SwiftShader）
npm run dist:win                         # Windows 安装包与便携版（release/，含模型）
```

各套测试的内容与 Folia 对照在 [`docs/TESTING.md`](docs/TESTING.md)；发布流程在 [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md)。

Hi-Fi 输出是 `native/cadenza-audio`（Rust）。在 Linux 上可用 `x86_64-pc-windows-gnu` 交叉编译。

### 依赖与兼容性

- **升级前验证**：优先采用受维护的稳定版，按实际 Windows、Electron 和音视频工作流验证新版本。升级收益与平台兼容决定何时采用。
- **精确锁定**：版本一律写死（`package.json` 不用 `^`，`Cargo.toml` 用 `=`）。升级是一次明确的提交，并跑完上面全部测试。
- **API 变动**：需要迁移时验证受影响功能；保留有兼容依据和退役条件的适配。`@types/node` 跟随 Electron 内置的 Node 主版本。

## 授权

Cadenza 以 **GNU AGPL-3.0**（AGPL-3.0-only）发布，全文见 [`LICENSE`](LICENSE)。

- **源代码义务**：再发布本程序或其修改版，或通过网络提供服务时，都必须以同一授权公开完整源代码。
- **第三方来源**：神经网络节奏引擎移植自 [Folia](https://github.com/chthollyphile/folia-major)（AGPL-3.0）；模型权重 Beat This!（CPJKU）与 HTDemucs（Meta）皆为 MIT 授权。详见 [`NOTICE.md`](NOTICE.md)。
