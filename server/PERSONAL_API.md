# 个人数据接口（本地单用户）

所有 `/api/me` 接口由服务端固定使用 `local-user`，客户端不能指定 userId。已有用户外键为将来多用户做准备，目前没有登录认证，也不能部署到公网。作品与章节必须使用真实资料库内部 ID；不存在的引用不会自动猜测或关联。

## 笔记

| 方法   | 路径                                  | 用途                                                                   |
| ------ | ------------------------------------- | ---------------------------------------------------------------------- |
| POST   | `/api/me/notes`                       | 新建草稿，允许空白和同集多条记录                                       |
| GET    | `/api/me/notes`                       | 查询自己的未删除笔记；支持 subjectId、episodeId、scope、q、page、limit |
| GET    | `/api/me/notes/:id`                   | 返回元信息、最新草稿和当前发布版本                                     |
| PUT    | `/api/me/notes/:id/draft`             | 自动保存草稿，使用 expectedVersion 防止覆盖                            |
| POST   | `/api/me/notes/:id/publish`           | 显式保存/发布记录，新增不可变历史版本                                  |
| GET    | `/api/me/notes/:id/history`           | 查看发布历史，仅笔记所有者                                             |
| POST   | `/api/me/notes/:id/unpublish`         | 立即撤回公开展示，草稿转为私密                                         |
| DELETE | `/api/me/notes/:id`                   | 软删除，撤回展示，保留记录                                             |
| GET    | `/api/me/trash`                       | 回收站元信息，包括恢复所需的当前 version                               |
| POST   | `/api/me/notes/:id/restore`           | 恢复删除笔记；默认私密，不重新公开                                     |
| GET    | `/api/catalog/:subjectId/impressions` | 作品公开感想；默认不返回含剧透正文/名场面                              |

创建：

```json
{
  "subjectId": "subject_实际ID",
  "episodeId": "bgm-episode-实际章节ID",
  "scope": "episode",
  "body": "这集的演出……",
  "feeling": "good",
  "scenes": [{ "time": "12:35", "text": "长镜头的留白" }],
  "isPublic": false,
  "idempotencyKey": "客户端生成的请求UUID"
}
```

`scope` 可为 episode / overall；overall 不绑定 episodeId，不使用单集观感或名场面。观感可为 null 或 awful / weak / fair / good / masterpiece，分别对应烂透了 / 不太行 / 一般 / 好看 / 神回。字段默认私密。正文最多100000字，名场面最多50条、每条1000字；编辑草稿允许名场面描述暂时为空，发布时必须完整。

创建支持幂等键：相同键、相同内容重复提交返回同一笔记；键复用为不同内容返回409。自动保存示例：

```json
{ "expectedVersion": 1, "body": "修改的正文", "isPublic": true }
```

保存返回新的 version，前端下一次写入必须采用该值。过期版本返回409，应提示用户重新加载并处理差异，不能静默覆盖。草稿不接受 spoiler 字段，响应中始终为 null；公开发布示例：

```json
{ "expectedVersion": 2, "spoiler": true }
```

私密发布不要求剧透声明，公开发布每次都必须传明确布尔值。发布后仍保留草稿，不会自动创建另一条笔记。删除、恢复、撤回也需要 `{ "expectedVersion": 当前版本 }`。

新界面的两个打分入口均调用独立 ratings 接口，点击立即保存，不创建总评。发布文字时可传 `ratingSnapshot: 1..10` 保存本次主动打分的快照，它不会写入评分历史；未传时沿用旧总评的快照，新总评使用当前评分。兼容旧客户端的 `score: 1..10` 仍原子写入一次评分，新前端不使用该参数。

草稿与历史版本支持 `title`，最多200字。`q` 同时检索标题、正文和名场面；`view=index` 仅返回标题及元信息，不返回全文和名场面，全文通过单条笔记接口获取。名场面时间可为空，支持中文/全角冒号、紧凑数字、`MM:SS` 与 `H:MM:SS`，服务端规范化保存。保存有内容的单集感受会在同一事务内将本集及同类型此前尚无进度的章节标记为已看。手动标记的「未看」会保留，收藏状态独立。

JSON备份格式现为版本2，保存标题及评分快照；版本1旧备份仍可恢复。

笔记列表支持 `view=subjects`，按作品分组分页。组内记录可按 `scope=episode` 或 `scope=overall` 及关键词过滤，返回作品信息、`noteCount` 和 `latestNoteAt`。选择作品后，可按 `subjectId` 查询记录，再展开全文。

公开列表默认 `hidden:true` 且完全省略含剧透记录的 body/feeling/scenes，避免只在 CSS 中隐藏。用户主动展开时请求 `?includeSpoilers=true`。不会返回草稿、私密记录或旧的已撤回发布版本。分页默认20，最多100。

## 追番与评分

| 方法 | 路径                                       | 正文/结果                             |
| ---- | ------------------------------------------ | ------------------------------------- |
| GET  | `/api/me/subjects/:id/progress`            | 收藏状态、逐集状态、最近100条观看事件 |
| PUT  | `/api/me/subjects/:id/collection`          | `{ "status": "doing" }`               |
| PUT  | `/api/me/subjects/:id/episodes/:episodeId` | `{ "watched": true }`                 |
| GET  | `/api/me/subjects/:id/ratings`             | current 与完整评分历史                |
| POST | `/api/me/subjects/:id/ratings`             | `{ "score": 9 }`，整数1–10            |

收藏状态 wish / doing / done / hold / dropped；null 取消收藏，不删除笔记或进度。单集由未看变已看时新增观看事件；重复发送已看不会重复记录，改回未看后再次手动标为已看，可形成重看事件。手动标记只覆盖指定集的显式状态，补齐此前集数时会保留手动标记的「未看」。进度、收藏和评分彼此独立，不自动联动完结状态。

整体评分与整体文字感想是独立资源：文字仍走 scope=overall 的笔记接口；不评分的感想不会清除既有评分。整体评分目前只追加，不提供历史评分编辑/删除接口。

## 备份恢复

| 方法 | 路径                     | 用途                                                          |
| ---- | ------------------------ | ------------------------------------------------------------- |
| GET  | `/api/me/backup`         | 下载个人 JSON 备份，包含私密内容和历史                        |
| GET  | `/api/me/backup/status`  | 自动备份状态，返回 `enabled`、`file`、`lastSuccess`、`error` |
| POST | `/api/me/backup/restore` | `{ "backup": 备份对象, "dryRun": true }` 预检；false 实际恢复 |

```sh
node --env-file-if-exists=.env server/personal-cli.mjs export
node --env-file-if-exists=.env server/personal-cli.mjs restore data/backups/实际文件.json --dry-run
node --env-file-if-exists=.env server/personal-cli.mjs restore data/backups/实际文件.json
```

备份包括收藏、进度、观看事件、笔记草稿、发布历史、软删除记录、评分历史，以及恢复引用所需的作品/章节最小元数据。不会备份整套Bangumi资料或账号令牌，也不是旧前端 localStorage 导出格式。

恢复规则：

- 可恢复到空库；作品/章节通过 Bangumi ID 重新映射，本地缺少时补最小资料，不覆盖已有完整资料。
- 恢复后的所有笔记均私密，不自动激活备份中的公开发布指针；保留历史剧透声明和历史文本。
- 同内容已存在则跳过；不同内容返回409，整个事务回滚，不覆盖本地编辑。即使是同一份备份，如果本地笔记仍公开，也可能因“恢复默认私密”产生冲突，不会自动撤回本地记录。
- 支持 dryRun，在事务中校验后回滚，确认引用、格式和冲突都可恢复。
- HTTP恢复最大16MiB，最多100000条记录；更大文件使用CLI（记录上限仍适用）。备份是明文JSON，包含私密笔记。
- CLI 导出默认创建新文件并拒绝覆盖已有文件。自动备份通过 `PERSONAL_BACKUP_DIR` 启用，使用同一种 JSON 格式。服务启动时检查，运行期间每 15 分钟检查一次。上次成功距今满 24 小时才更新单份备份，通过恢复预检并完成写入后才替换上一份。

## 验证

回归测试覆盖资料检索、迁移、放送缓存、笔记/评分隔离、标题与历史快照、公开版本隔离、冲突/幂等、软删除、个人权限及新旧备份恢复。
