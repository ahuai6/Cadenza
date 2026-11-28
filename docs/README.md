# Cadenza 文档地图

第一次接手从 [开发交接](HANDOVER.md) 开始。此页保留完整的按需索引。

## 先读

1. [开发交接](HANDOVER.md) 和 [产品](PRODUCT.md)，了解当前范围、源码入口和开发命令。
2. [架构](ARCHITECTURE.md)，对照实际依赖、状态所有权与时间模型。
3. [开发入口](../CLAUDE.md)、[项目 Skill](../.claude/skills/cadenza/SKILL.md) 与 [测试](TESTING.md)，了解日常工作约定。
4. [方向记录](DIRECTION.md) 和各阶段报告，按问题回查决策背景与验证条件。

## 动手时查

| 要做的事 | 读 |
| --- | --- |
| 改节奏分析 | [`parts/rhythm.md`](parts/rhythm.md) |
| 改歌词解析、分词、翻译与读音 | [`parts/lyrics.md`](parts/lyrics.md) |
| 改排版、镜头、转场时机、清场 | [`parts/director.md`](parts/director.md) |
| 改画法、特效、背景、转场的样子 | [`parts/render.md`](parts/render.md) |
| 改 Session、重建、导出、交接 | [`parts/engine.md`](parts/engine.md) |
| 改界面（经典）、设置页、指令 | [`parts/app.md`](parts/app.md)、[`DESIGN.md`](DESIGN.md) |
| 改空间界面 | [`SPACE.md`](SPACE.md) |
| 搬 Folia 的东西、跟上游更新 | [`FOLIA.md`](FOLIA.md) |
| 风格、外观、旋钮的结构 | [`STYLE-SYSTEM.md`](STYLE-SYSTEM.md) |
| 界面上的任何一个字 | [`COPY.md`](COPY.md)（词汇表；先查再用，没有就先加） |
| 跑测试、看对照数字 | [`TESTING.md`](TESTING.md) |
| 重跑 3.6.0 基线、核对 G0 记录 | [`BASELINE-3.6.0.md`](BASELINE-3.6.0.md) |
| 发布、依赖、数据兼容、环境的坑、已知的债 | [`MAINTENANCE.md`](MAINTENANCE.md) |
| G4 复审、ALAC 音频和内嵌歌词兼容 | [`G4R.md`](G4R.md) |
| G5 曲库索引迁移、音频身份与缓存 | [`IDENTITY.md`](IDENTITY.md) |
| G5.5-F 歌词服务、AI 与资料清理 | [`G55-F.md`](G55-F.md) |
| 日常、编辑模式、歌词辅助与空间玩法 | [`PRODUCT.md`](PRODUCT.md) |
| 每一版改了什么（写给用户） | [`RELEASE.md`](RELEASE.md) |

## 其他

- [`design/`](design/)：方向 B「书页」的设计原型。实施规范见 `DESIGN.md`。
- [`history/`](history/)：旧的审查（2.9.2）与需求核对（2.22.1），只作纪录，不代表现况。
- `NOTICE.md`（根目录）：第三方来源与授权。

## 文档的规则

- 文档一律用简体中文与大陆惯用词（界面、设置、队列、导出、默认、视频……），发布说明 `RELEASE.md` 也一样；代码、标识符、路径照原样。界面上实际显示的字以字典 `src/i18n/dict.json` 为准，繁体界面的对应用字见 `COPY.md` 开头的对照表。
- 写「现况」与「为什么」，不写流水帐；流水帐在 `RELEASE.md`。
- 文档与程序不一致时，以程序为准并立刻改文档；设计规则（`DESIGN.md`）例外：先改文档再改程序。
- 新增一份文档就在这里加一列。
