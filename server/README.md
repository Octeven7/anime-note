# 后端：资料库与个人记录

个人笔记、发布、评分、观看进度及备份恢复接口见 [个人数据 API](PERSONAL_API.md)。

当前数据库结构为 v12，新增正篇放送日期索引。完整归档提供章节、角色、声优、制作关系和 Wiki 字段，覆盖范围随导入的快照而变。用 `GET /api/health` 查询当前条目数。`detailCount` 只统计标记为完整的 API 详情。归档导入的详情也可在本地展示。

Node.js 24 LTS + 内置 SQLite，零新增服务端第三方运行依赖。数据库：`data/anime-note.sqlite`，由迁移自动建立；资料搜索使用本地 FTS5 trigram，1–2 字中文词回退转义后的 LIKE。当前仅允许本机使用，尚未实现账号认证，不得开放到公网。

## 启动与验证

```sh
# 同时启动前端 5173 / API 3001
node scripts/dev.mjs
# 或独立运行 API
node --env-file-if-exists=.env server/index.mjs
# 后端测试
node --test server/*.test.mjs
# 对实际数据库执行完整性、外键、FTS关联与样例查询检查
node --env-file-if-exists=.env server/verify.mjs
```

在用户本机终端运行；网络隔离沙箱的监听端口可能无法被本机浏览器访问。端口冲突直接报错，均仅监听 127.0.0.1。前端开发服务将 `/api` 转发到后端。

`.env` 已被 Git 忽略。用 `.env.example` 初始化其他环境；Bangumi 请求标识设置为实际开发者 ID，令牌可选且仅留在服务端，不返回浏览器。当前公开条目实测无需 token。

## 数据导入

支持全局代理配置的 Node 版本（Windows 上使用 Node 24.14 或更新版本）可读取 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY`。Windows 在没有显式代理时尝试读取系统对 Bangumi API 和图片域名的代理设置，本机回环地址始终直连。

```sh
# 指定真实条目，分页导入全部章节类型及角色/声优/制作人员关系
node --env-file-if-exists=.env server/import.mjs subject 400602 328609
# 下载官方归档，验证 SHA-256，导入动画及关联资料
node scripts/download-archive.mjs
# 从已下载的 ZIP 离线导入
pnpm import:archive-full
# 只导入已解压的作品目录（支持 gzip）
node --env-file-if-exists=.env server/import.mjs archive path/to/subject.jsonlines
```

官方归档下载器需要系统 `tar`（Windows 自带）；不会将书籍/音乐/游戏等作品导入动画库。下载内容与数据库均写入被忽略的 `data/` 目录。下载归档约 432 MiB，需为解压文件、索引和数据库预留数 GiB 磁盘空间。

两种导入均逐行读取。仅导入作品目录时每批 500 条，完整 ZIP 导入时按数据集每批 1,000 条。失败时保留已提交批次并记录错误。重跑会重新扫描快照，并按 Bangumi ID 更新或补齐资料。新快照中消失的条目会保留，以保护已有用户记录的关联。

完整导入保留动画及其关联的归档记录，并将章节、角色、声优、主要制作人员和可解析的 Wiki 字段写入详情使用的表。已有的 API 详情、章节 ID 和个人记录会保留。归档的标签和图片覆盖有限，可以手动更新作品或指定标签。

## API

### 海报加载与缓存

- 浏览时按需读取和填充磁盘缓存。另可手动运行[热门海报下载工具](../POSTER-ADDRESSES.md#下载热门海报)，它使用同一份磁盘缓存。前5张立即加载，其他由IntersectionObserver在视口附近300px触发。图片通过可取消fetch读取，先decode再展示，卸载取消请求与重试。
- 默认全局并发6（环境变量 `POSTER_CONCURRENCY`，范围1—16），后台最多2；前台可用满总并发，同级FIFO，后台等待上限8。保守地不允许后台借满全部位置，避免无法抢占的已启动后台任务堵住前台。保留兼容预取接口，但每次只接收最多4个实际任务，界面不再自动调用。
- 请求合并带需求方计数，最后一个需求方取消时移除等待任务或中止下载；不取消仍被其他请求使用的共享任务。排队预算15秒，排队及运行总预算25秒，单网络阶段10秒。旧缓存7天后可先返回并低优先级更新。缓存JSON格式不变，改用临时文件+rename原子替换。
- `poster_sources` 记录地址解析状态/时间及负缓存期限，解析出的URL写回subjects.image_url。旧地址403/404/410或类型不符只重新解析一次；no_icon_subject默认图识别为无图、404负缓存24小时。前台临时失败冷却5秒，后台失败冷却至少30秒，但前台可重试后台失败一次；上游429/503依Retry-After全局暂停新下载。
- 所有错误继续使用原本已有的no-store。临时错误返回502/503与Retry-After及X-Poster-Status，确认无图404；前端最多自动重试2次，尊重冷却、增加抖动，重试并发最多2。手动重试不再增加retry查询串。原地址403重解析后仍失败时不贸然判断永久无图。
- `Server-Timing` 提供poster_queue/resolve/ttfb/body/disk/cache（实际经过的阶段）；`GET /api/posters/diagnostics` 提供最近1000个任务的有界进程内诊断，不保存上游URL或个人笔记。前端记录totalMs/decodeMs/nextHopProtocol，成功图片容器data-poster-*可检查。decode完成不是精确屏幕绘制时间，缓存响应中的计时头可能是历史值。

| 方法与路径                                           | 含义                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/health`                                    | 数据库版本、总条目数、可检索数、完整详情数、最近归档导入状态 |
| `GET /api/catalog`                                   | 搜索本地资料及已保存的标签索引 |
| `GET /api/catalog/:internalId`                       | 读取本地作品、章节、人物关系及数据来源 |
| `POST /api/integrations/bangumi/subjects/:bangumiId` | 显式获取作品及关联资料，返回本地内部 ID 和详情               |
| `POST /api/integrations/bangumi/subjects/:bangumiId/refresh` | 按范围刷新本地已有的公开动画，逐项返回结果 |

搜索参数：`q`、`year`、`quarter=1..4`、`minScore=0..10`、`maxScore=0..10`（闭区间，最多一位小数）、`minVotes`（浏览默认100，带关键词搜索默认不限人数，显式0不限人数）、重复 `tag`（AND）、`category`（TV/OVA/剧场版/WEB等名称、代码或数字ID）、`sort=score/date/votes/name`、`page`、`limit=1..100`。季度按首播日期划分，不代表跨季在播集合。排序有稳定的 ID 次序；未评分数值可为 null。默认排除 R18。

详情和放送表的 `totalEpisodes` 取自资料中明确填写的总话数。详情页的已收录话数来自本地正篇章节条数。放送表从具有有效日期、且日期不晚于日本当地今天的已收录正篇章节中选择最近一话。

放送表的 `otherReleases` 按所选季度内的放送日期列出剧场版、集中上线、分批上线和分段复播。剧场版按条目首映日归类，集中上线和分批上线按正篇章节日期归类。电视动画在两段有周播日期记录的章节之间间隔至少四周时，会补充一条复播记录。分批上线可跨季度显示。

## 细分类与标签补全

### 社区评分缓存

`subject_ratings` 保存1至10分人数、人数总和、评分总和、来源、同步时间与错误状态；升级从现有归档/详情缓存回填。API分布必须完整、非负整数且与总人数一致，否则保留旧数据。归档重导入不会降级覆盖已有API评分分布。

`sort=score` 现按未四舍五入均分降序，再按人数和ID稳定排序；缺少分布的旧条目暂回退显示分数。显示与分数区间筛选仍使用一位小数社区分数，默认人数100。响应增加 `score_exact`、`rating_distribution`、`rating_updated_at`；该排序不声称复刻官方rank。

目录和详情使用已保存的评分。详情刷新接口接受 `{"section":"all"}`，也可选择 `metadata`、`ratings`、`episodes`、`characters` 或 `staff`。返回 `results`，每项含 `section`、`ok`，成功项另含 `source`。全量刷新允许部分成功，失败项保留已有资料。同作品同范围的并发请求合并。批量更新可使用 `pnpm sync:metadata`。

数据库版本7保留归档、详情API、标签查询各自的标签快照；归档更新不再清掉更丰富的API标签。数字分类按官方定义转换为规范名称，响应的 `category` 另含数字ID与稳定代码，前端暂不添加分类筛选控件。

```sh
# 从现有原始缓存修复细分类及可恢复的标签
pnpm catalog:repair
# 分页补全指定标签对应的全部公开非R18动画，原子替换该标签查询索引
pnpm sync:tags 党争
# 热门优先，逐条持久化检查点；重复运行跳过7天内成功的条目
pnpm sync:metadata --limit=50
# 逐条读取全库非R18作品的详情元数据（耗时长，不会自动执行）
pnpm sync:metadata --all
```

按标签检索直接查询本地。运行 `pnpm sync:tags <标签>` 可显式更新官方标签名单。分页失败时保留旧索引，搜索摘要不会覆盖作品详情。已保存的官方标签查询以其成员集合为准，多个标签取交集，再应用本地评分等筛选。

官方归档导出代码最多保留每部作品11个普通用户标签，公共标签另行保存；详情API可返回更多，但不等于所有用户打过的全部标签关系。当前机制补全的是API实际返回的数据与特定标签搜索的完整分页结果，不能据此承诺全站原始标签关系已全部导入。详情批量同步只读取作品元数据，不重复读取全部章节与人物关系。401/403/429时停止批次，其余失败记录后继续，可重跑。

例：

```text
/api/catalog?q=芙莉莲
/api/catalog?year=2023&quarter=4&minScore=8&minVotes=100&tag=奇幻&sort=score
```

导入 POST 使用 `Content-Type: application/json`，正文 `{}` 或 `{"refresh":true}`。24 小时内完整详情默认读缓存；强制刷新失败时返回已有完整缓存及 `stale:true`，没有缓存返回 502。所有上游请求串行限速、15 秒超时；这里 1.1 秒间隔是本项目的保守策略，不是声称官方固定配额。暂不自动重试 429，以免扩大流量；后续可依据 Retry-After 增加任务级退避。

## 模型与权限边界

### API 缓存与完整归档

v9 的 API 缓存和展示用资料采用精简结构：角色只保存图片地址，姓名/ID独立存储，CV通过关联表保留；人物只保存ID和姓名。制作岗位仅保留动画制作、制作、原作、导演、总导演、系列构成、脚本、人物设定、角色设计、音乐。章节保留结构化ID/集号/类型/标题/日期，payload不再重复保存正文。作品缓存保留展示与修复必需字段、结构化infobox；原始归档wiki字符串不再保留，别名与标签以现有索引保留。metadata同步表只记录同步状态，不再复制作品payload。评分分布独立保留。

v11 的完整归档导入另用 `archive_records` 保存相关原始归档行，用 `archive_infoboxes` 保存解析后的字段，并将章节、人物关系和别名写入对应业务表。展示字段的精简与原始归档行的保存分别管理。

- `subjects.id` 是内部 ID，`bangumi_id` 是唯一外部映射；上游刷新不会更改内部 ID。
- 资料、章节、标签、角色/人物与声优关系单独存储；原始详情和获取时间另外缓存。
- 用户表、收藏、观看事件、笔记、版本、评分历史已建表，并已接入前端。旧版 localStorage 通过数据页显式预检迁移；不会把演示ID直接当作真实作品/章节ID。
- 同一集允许多条笔记；章节与作品采用复合外键，禁止跨作品错误关联。
- 自动保存更新独立草稿；发布生成不可变版本，公开区只读取明确发布的当前版本。修改草稿不会更新公开正文；每次公开发布必须重新提交剧透声明。
- 整体评分单独追加保存、1–10 整数；API 取最新评分，单集观感不能自动生成整体评分。连续评分采用递增的服务端时间，避免同毫秒写入及备份恢复后次序颠倒。
- 本机 API 检查 Host 与 Origin，不设置宽泛 CORS；这是本地防护，不是多用户授权系统。
- 尚未实现生产部署、账号认证、上游删除/合并迁移、下载任务调度。SQLite 不是网页浏览器中的 localStorage；个人数据备份恢复现已实现。

## 官方依据

- [Bangumi API 定义](https://github.com/bangumi/server/blob/master/openapi/v0.yaml)
- [官方归档字段和更新说明](https://github.com/bangumi/Archive)
- [User-Agent 建议](https://github.com/bangumi/api/blob/master/docs-raw/user%20agent.md)
- [版权与开发者平台协议](https://bgm.tv/about/copyright)

数据库内的资料需保留来源、获取时间，展示时链接原条目；用户原创笔记与外部资料分开管理。完整资料的使用、删除和后续公开服务仍须遵守上游协议。
