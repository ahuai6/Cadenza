# Cadenza 文件地图

给第一次接手的人（或 Agent）：照下面的顺序读，半小时内能动手。每份文件只管一件事；改程式时顺手改它对应的文件。

## 先读（依序）

1. **`/CLAUDE.md`**：专案是什么、七个部分、最常用的指令、不可违反的几件事。
2. **[`DIRECTION.md`](DIRECTION.md)**：要变成什么、走到哪、接下来做什么、使用者已经决定过的事（不要再问、不要改回）。
3. **`.claude/skills/cadenza/SKILL.md`**：开发范式——分层规则、新增东西的固定流程、程式码规范、测试与发布流程。**它是规则，不是参考资料。**
4. **[`ARCHITECTURE.md`](ARCHITECTURE.md)**：模组、资料流、时间模型、登记表（扩充点）。

## 动手时查

| 要做的事 | 读 |
| --- | --- |
| 改节奏分析 | [`parts/rhythm.md`](parts/rhythm.md) |
| 改歌词解析、分词、翻译与读音 | [`parts/lyrics.md`](parts/lyrics.md) |
| 改排版、镜头、转场时机、清场 | [`parts/director.md`](parts/director.md) |
| 改画法、特效、背景、转场的样子 | [`parts/render.md`](parts/render.md) |
| 改 Session、重建、汇出、交接 | [`parts/engine.md`](parts/engine.md) |
| 改介面（经典）、设定页、指令 | [`parts/app.md`](parts/app.md)、[`DESIGN.md`](DESIGN.md) |
| 改空间介面 | [`SPACE.md`](SPACE.md) |
| 搬 Folia 的东西、跟上游更新 | [`FOLIA.md`](FOLIA.md) |
| 风格、外观、旋钮的结构 | [`STYLE-SYSTEM.md`](STYLE-SYSTEM.md) |
| 介面上的任何一个字 | [`COPY.md`](COPY.md)（词汇表；先查再用，没有就先加） |
| 跑测试、看对照数字 | [`TESTING.md`](TESTING.md) |
| 发布、依赖、资料相容、环境的坑、已知的债 | [`MAINTENANCE.md`](MAINTENANCE.md) |
| 每一版改了什么（写给使用者） | [`RELEASE.md`](RELEASE.md) |

## 其他

- [`design/`](design/)：设计原型的原始码（方向 B「书页」；说明在 `DESIGN.md` 第 9 节）。
- [`history/`](history/)：旧的审查（2.9.2）与需求核对（2.22.1），只作纪录，不代表现况。
- `NOTICE.md`（根目录）：第三方来源与授权。

## 文件的规则

- 文件一律用简体中文（发布说明 `RELEASE.md` 写给使用者，沿用繁体）；程式码、识别字、路径照原样。介面上的字以字典为准：`COPY.md` 的词汇表以简体书写，繁体介面用同一个词的繁体写法。
- 写「现况」与「为什么」，不写流水帐；流水帐在 `RELEASE.md`。
- 文件与程式不一致时，以程式为准并立刻改文件；设计规则（`DESIGN.md`）例外：先改文件再改程式。
- 新增一份文件就在这里加一列。
