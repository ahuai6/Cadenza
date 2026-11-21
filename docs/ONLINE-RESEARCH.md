# G4R 在线音乐前置研究

对照 [Denza-Fork 参考文档](https://github.com/ahuai6/Denza-Fork/blob/7152ca59236ec7f753a7562e4ddeded7d0dcf39a/docs/DENZA-ONLINE-API.md) 和同一提交的源码。2026-11-22 核对 `custom` HEAD 为 `7152ca59236ec7f753a7562e4ddeded7d0dcf39a`（v3.2.9-denza.10），与固定参考无差异。本文把源码中有调用链、隔离测试有覆盖和公网现场可用分开记录。G4R 只研究接口，无登录、商业媒体下载或在线功能实现。

## 1. 平台能力与证据

| 来源 | Denza-Fork 源码中的能力 | 实际验证边界及 Cadenza 取舍 |
| --- | --- | --- |
| 网易云 | SDK 搜索、二维码登录、账户恢复、歌单分页、分档音频链接、YRC/LRC/译文/罗马音 | 查到完整适配调用链及模拟测试。SDK 为非官方接口封装，真实登录、配额、分区和各档授权待确认。 |
| QQ 音乐 | SDK 搜索、二维码登录、私人歌单分页、MP3 档与 FLAC 请求，直接获取 QRC 或 SDK 回退 | 源码明确拒绝原生 Hi-Res。直接歌词和 SDK 回退有模拟测试。音质、会话恢复与全量歌单需要后续经授权验证。 |
| 酷狗 | 社区 SDK 快照、设备注册、二维码和会话、私有／公开歌单、多个档位、KRC/LRC 和语言轨 | 有私有列表 ID、公开列表备选路径和测试。真实设备注册、权限、签名兼容及高档编码待确认。 |
| Apple 官方 | 官方目录和个人资料库接口。Denza 通过网页会话发现令牌，外部浏览器播放 | Apple 文档确认目录、用户授权的资料库与歌单以及 MusicKit 播放。Cadenza 评估正式开发者令牌和 MusicKit 授权机制，保留外部官方播放。受保护流不可供本地分析、导出或下载。 |
| LyricsFlow | 匿名第三方目录展开、歌词、独立文件服务 | 现场验证 OpenAPI、状态及匿名目录响应。文件服务自报解密链路，排除。目录优先用官方来源。歌词在来源与许可明确前保持关闭。 |
| LRCLIB | 精确匹配和搜索已用于独立歌词入口 | 公共搜索返回预期的 JSON 数组。升级 Cadenza 现有入口时保留逐行与纯文本的精度标识。 |
| AMLL TTML、QQ 换源 | 原参考中的生态和调研条目 | 无当前适配。AMLL 先核对所需曲目与使用许可，QQ 先对照真实契约和维护数据。 |

### 网易云、QQ、酷狗的调用契约

| 功能 | 网易云 | QQ 音乐 | 酷狗 |
| --- | --- | --- | --- |
| 搜索 | `cloudsearch`，`keywords/type=1/limit=30/offset`，取 `result.songs` | `getSearchByKey`，`key/t=0/n=30/p`，兼容 `data.song.list` 等层级 | `search`，`keywords/type=song/page/pagesize=30`，兼容 `data.lists/info/list` |
| 登录及恢复 | `login_qr_key` → `login_qr_check(key)`，800 过期、803 带 Cookie 成功，`login_status` 验证 `userId` | QR 经 `qrsig/ptqrtoken` 轮询，`refresh` 表示过期，验证 `getUserDetail` 的 `userid`。业务调用根据 SDK 接口注入 Cookie | `register_dev` 返回 `dfid`，设备标记与用户 `token/userid` 分开。QR 状态 0 过期、4 完成，用 `user_detail` 验证 |
| 歌单分页 | `user_playlist(uid)` 和 `playlist_track_all(id)`；`limit=100/offset`，看 `playlist/songs` 和 `total/more` | `getUserPlaylists(uin,limit,offset)` 与 `songListDetail(disstid,song_begin,song_num)`，处理 `cdlist`、`total_song_num` | `user_playlist` 的 `listid/global_collection_id` 分别保存。`playlist_track_all_new` 优先按私有 ID，存在公开 ID 时支持对应回退。`page/pagesize=100` |
| 请求音质 | `song_url_v1` 请求 `standard/exhigh/lossless/hires`，`song_download_url` 为现有同档备选，过滤试听 | `getMusicPlay(songmid,mediaId,quality)` 请求 `128/320/flac`，兼容嵌套 URL，并带限定 Referer。原生 `hires` 返回不可用 | `song_url(hash,album_id,album_audio_id,quality,free_part=0)` 请求 `128/320/flac/high`，结果编码依实际内容校验 |
| 歌词 | `lyric_new(id)` 优先 `yrc/ytlrc/yromalrc`，兼容 `lrc/tlyric/romalrc`，缺主轨时走 `lyric` | `musicu.fcg` 的 `music.musichallSong.PlayLyricInfo/GetPlayLyricInfo`，`songMID/songID/trans/roma`。`req_0.data` 的歌词字段可能是 QRC、普通 LRC 或编码文本。缺主轨回退 `getLyric` | `search_lyric(hash,keywords,duration)` 后按候选 `id/accesskey` 取 KRC；`language` 中的语言轨分开解析，失败再取 LRC |

固定依赖为网易云 SDK `4.41.1`、QQ SDK `2.6.0`、酷狗 MIT 源码快照 `1.6.3`，QRC 文本解包辅助函数来自 LRC-GET MIT `2cc0e67d`。`platforms.cjs` 在主进程统一封装和验证账户，`sdk-transport.cjs` 每平台复用 Worker，25 秒请求超时、60 秒空闲回收、连续 4 次挂起后重建。`online.cjs` 的 `collectPages` 检查重复页、提前结束和总数，最多 100 页，4 个歌单并发，全部到齐且账号仍相同才提交。服务没有已证实的固定配额。G5.5 对 429 尊重 `Retry-After`，凭据拒绝重新授权，超时与暂时失败限次退避。请求正常返回但缺少主路径字段应区分为空结果或协议变更。 [依赖清单](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/docs/online-dependencies.json) · [平台实现](https://github.com/ahuai6/Denza-Fork/tree/7152ca5923/electron/online/providers) · [分页与快照](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/electron/online.cjs)

公开 npm 仍显示上述网易云和 QQ 版本为最新。2026-11-22 仓库元数据表明 QQ 当前 SDK 最近推送于 9 月 29 日，Rain120 和 yakult-green-tea 分别于 11 月 3 日、11 月 20 日推送，均未归档。推送时间只能表明活动度。优先隔离更换能力，按搜索、登录态、歌单、歌词、取链分别比较确认后的授权方式、取消及分页边界。QQ QRC 处理对象限于歌词文本。非授权的匿名音频回退服务及会员限制绕行不进入候选。 [当前 QQ SDK](https://github.com/sansenjian/qq-music-api) · [Rain120](https://github.com/Rain120/qq-music-api) · [yakult-green-tea](https://github.com/yakult-green-tea/qq-music-api)

### Apple Music 官方与 LyricsFlow 的边界

- 官方目录按 `/v1/catalog/{storefront}/search` 使用 `term/types/limit/offset`。用户资料库按 `/v1/me/library/playlists` 与关系页请求，遵循官方 `next`、账户授权和地区。`l` 是元数据语言，`storefront` 是地区及目录范围。上传资源有个人资料库 ID，可能没有目录对应项。Denza 的 `apple-music.cjs` 从网页脚本发现开发者令牌，隔离窗口获取用户令牌并以 `/v1/me/storefront` 验证。Cadenza 应使用自己的签发服务或已授权集成，令牌只发往官方明确的主机，禁止从网页脚本抽取并复用他人令牌。Windows 播放到官方页面，MusicKit 内嵌另验平台与许可。 [Apple Music API](https://developer.apple.com/documentation/applemusicapi) · [MusicKit](https://developer.apple.com/musickit/) · [Apple 客户端源码](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/electron/apple-music.cjs)
- LyricsFlow 的 `/openapi.json` 返回 200、`application/json`、OpenAPI 3.1.0／服务 2.0.0，未声明通用安全方案。匿名 `/search` 返回 200，含 `results.songs.data` 与 `meta`。无匹配歌词探针 `/lyrics/by-metadata` 返回 404 和 JSON `error`，有结果的歌词正文与版权来源未实测。文档中的 `/lyrics` 接受目录 ID 与地区，元数据入口接受标题、艺人、专辑、时长毫秒与地区。Denza 客户端解析结构化响应，保留原生 TTML，并限制目录展开分页最多 2,000 首、同源继续。 [服务协议](https://api.trylyricsflow.com/openapi.json) · [Denza 客户端](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/electron/online/lyricsflow-audio.cjs)
- 服务 `/status` 确实返回 200，并自报音频、视频与解密处理能力。OpenAPI 针对文件路由的 `200` 只标示 JSON，未给出可信的音频二进制契约。本次仅核对协议与非媒体响应，没有请求文件、试听流或受保护音频。匿名可访问和上游代码许可证均无法证明音频或歌词的再分发权。Cadenza 不调用该文件与流服务。 [服务状态](https://api.trylyricsflow.com/status) · [Apple 开发者协议入口](https://developer.apple.com/support/terms/)

### 下载、歌词与写入经验

- `downloads.cjs` 用暂存文件、可取消下载、实际头部和 `music-metadata` 验证，支持失败再试、同档换源、按配置降档及中断导入重试。通常以响应头和流停滞分别计时，LyricsFlow 请求头等候可达 180 秒，活跃下载停滞上限 45 秒。`tag-worker.cjs` 复制暂存文件，再写 `tags.cjs` 的 LRC、专用 TTML、封面和基本字段。回读字段存在并核对时长，然后记录 SHA-256 和原子提交。时长相同仍可能改坏样本或其他标签，G5.5 沿用 G4R 的内容与非目标标签检查。 [下载与提交](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/electron/downloads.cjs) · [校验](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/electron/online/audio-validation.cjs) · [写标签](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/electron/online/tag-worker.cjs)
- Denza 的 `downloadLyricFormats()` 在 `interleave()` 后调用 `cleanBlankLyricRows()`。`translationLrc()` 将 TTML 临时转成 LRC 并清理，`mergeTranslations()` 输出时又清理一次。清理会移除空行、纯时间戳与 `//`；合并还可能重排、去重同时间戳行。这些路径不移植。可借鉴按行 ID 回填、按时间和原文匹配译文、保留读音、给位置猜测加提示。Denza 当前行 ID 以时间为主，新模型需要区分多个同起点的原词、和声或舞台行。`translation-service.cjs` 有 OpenAI、DeepSeek、兼容 HTTP 和 Codex 纯文本后端，响应按 ID 校验。测试中的假响应与临时音频只能证明客户端契约。 [下载歌词](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/src/lyrics/download.ts) · [译文匹配](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/src/lyrics/translation.ts) · [验证示例](https://github.com/ahuai6/Denza-Fork/blob/7152ca5923/tests/unit/online.test.ts)
- Cadenza 已有 LRCLIB 精确搜索和普通搜索，2026-11-22 公开搜索探针返回 `200 []`。后续将其置于共同歌词候选入口，按歌曲版本和时长区分。AMLL 的 TTML 库和 API 源码许可分别标示为 CC0-1.0 和 Apache-2.0。第三方歌词的使用仍按来源、权利及地区审查，保持原始歌词的计时精度。 [LRCLIB](https://lrclib.net/docs) · [AMLL 数据库](https://github.com/amll-dev/amll-ttml-db) · [AMLL API](https://github.com/amll-dev/amll-ttml-api)

## 2. G5 先确定持久化关系

| 记录 | 关键字段及规则 |
| --- | --- |
| `TrackId` | 一个可收藏、入队、编辑和统计的本地曲库条目。可关联多个 `RemoteTrackRef`。相同音频的其他条目仍独立。 |
| `AudioContentId` | 按明确版本的规则对完整音频负载计算 SHA-256。MP4 需理解样本表、编辑表及解码配置，覆盖实际音频样本顺序；G4R 的 `mdat` 安全校验仍独立存在。重采样、重编码或更换有效样本必须重新验证有关缓存。文件正在更换且身份未知时隔离旧分析。 |
| `RemoteTrackRef` | `provider + namespace + providerId`。账户私有命名空间加本地账户引用，Apple 的目录、地区可用性和用户资料库引用分开。名称、时长、ISRC、专辑和版本词只形成候选关联。支持现场、重制、翻唱及同名冲突。 |
| `RecordingMatch` | 两条引用的候选关系，记录证据、匹配置信度、人工选择和修订。不同平台的 ID 永不互相覆盖。 |
| `MediaVariant` 与 `MediaLease` | 档位与资源引用记录名义编码、实际探测编码、码率、采样率及权限。临时 URL、响应头、范围能力及失效时点只留在短期授权租约中，和请求代次绑定。 |
| `FileImport` 与 `FieldValue` | 下载原始来源、档位和校验摘要关联新旧 `TrackId`。标题等字段独立保存值、来源、匹配依据、来源修订和人工锁定。`metadataRev`、`lyricsRev`、`audioContentId` 各自推进。 |
| `PlaylistSnapshot` | `provider/account/playlist`、上次确认的远端修订／游标、有序条目及独立的条目出现 ID、完整性与同步时刻。未完成写入临时空间。只有同账户同事务的完整响应能更新本地可见快照并标记远端删除。 |

音频缓存键采用 `AudioContentId + algorithmVersion + parameters`，字幕、布局与视觉缓存按各自输入版本失效。下载取消或缓存清理时递增写入代次，校验过期的结果不得落盘。重要用户资料独立于缓存清理。G1 的启动事务仍管理应用拥有的目录，下载到用户选定位置的音乐、外置歌词及导出仍属于外部资产。4.0.1 起只用明确的数据结构迁移。

## 3. G5.5 按批建设

1. **来源与账户**。在 Electron 主进程实现适配器表，能力分搜索、读取列表、只读歌词、授权流、允许保存、外部打开。错误统一表达为权限不足、会话失效、内容不可用、无歌词、限速、协议变化或取消。凭据系统密钥库或 `safeStorage` 加密，失败时保持会话态或拒绝持久化。独立登录分区仅允许官方域，Renderer 只拿账户状态与不透明引用。退登取消所有任务、清除指定账户令牌和媒体租约。日志不记录 Cookie、授权头或带密钥的 URL。
2. **搜索、分页和匹配**。从 Cadenza 现有曲库检索、歌词查询及字段编辑入口接入。按平台验证结构，分开总超时和单页超时。检测重复页、游标跨域、长度矛盾、账户切换。增量同步只在上游具备稳定修订和删除语义时启用。首批先做只读目录、歌词和差异预览，再做已授权账户的歌单。多来源字段可单独应用，批量修改前展示差异，明确版本冲突并可撤销。
3. **授权播放与下载**。以受控媒体来源接入同一个 `PlaybackCoordinator`，通过受限协议交付浏览器可读流或已有原生解码。媒体地址不交给 UI，限制协议、主机、重定向、内容大小与请求头。支持 Range 的来源验证部分响应和 seek，短 URL 失效在当前租约内至多刷新一次。原生 Hi-Fi 优先接受已获许可的本地完整文件，远端原生范围解码另行验证。下载使用限流队列、同目录唯一暂存、完整性与实际编码校验、失败恢复、净化文件名和无覆盖提交。M4A 根据实际 codec 判为 AAC 或 ALAC。ALAC 只对获准的无保护源走 G4R 原生 PCM 能力，FLAC 和 MP3 维持现有解码链。保存、导出和分析分别校验授权。
4. **歌词与文本编辑基础**。原始歌词文档保留空行、纯时间戳、段落与未知扩展，以 `LyricsDocument` 的语义视图为 LRC、YRC、QRC、KRC、TTML 提供统一时间单位、稳定行标识、原词、和声、译文和读音轨。编辑操作只修改目标范围。查找、替换、选区、批量预览和撤销重做共用编辑事务。AI 只发送用户同意的原文行、必要上下文和目标语言。返回按行 ID 校验，重复段落需要时间或人工确认。仅写入用户选定的标签和轨道，原歌词来源和时间精度保留，写入后回读并校验音频内容。

任务优先级以播放和当前用户操作为先，网络同步与下载在预算内运行。G6 消费验证后的内容身份及 PCM 权限，G7 仍只接触歌词、统一时钟、分析和视觉合成接口。G8 仅导出可授权访问的音频与歌词。G9 将搜索、字段差异和歌词编辑自然融入「书页」，组件以状态和命令替换布局。验收先用假服务覆盖登录过期、分页缺失、取消、重复条目、档位不符、TTML 多轨和容器标签安全。真正启用每个来源前，再验证它的可用性、地区、配额、授权和隐私条款。
