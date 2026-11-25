# 纸间放映

纸间放映是一款本机运行的个人追番手账。用它查找番剧、管理观看进度、记录单集感想和撰写总评。番剧资料来自 [Bangumi](https://bgm.tv/)，个人记录保存在本机 SQLite 数据库。

- 按作品名、标签、年份和评分查找番剧，查看章节、角色和声优。
- 按集撰写 Markdown 笔记，记录观感和带时间戳的名场面，支持草稿自动保存和剧透遮罩。
- 独立保存作品评分和总评，回顾观看进度、笔记及本周放送。
- 在数据管理中导入或导出个人记录。

## 安装与启动

需要 Node.js 24 LTS、pnpm。使用归档导入时还需要系统的 tar 命令。将 .env.example 复制为 .env，按注释填入自己的 Bangumi 请求标识。令牌可选。

```sh
pnpm install --frozen-lockfile
node scripts/download-archive.mjs
pnpm dev
```

访问 [本机页面](http://127.0.0.1:5173/)。Windows 用户安装依赖并准备好资料后，也可双击 start.cmd 启动。默认 API 端口为 3001。

导入脚本下载并校验 Bangumi 官方归档，再将动画目录写入本地数据库。已有解压后的作品目录时，可运行 `pnpm import:archive path/to/subject.jsonlines`。也可用 `pnpm import:subject 400602` 单独导入作品。章节、角色等详情按需从 Bangumi 补充。

## 本机数据

默认数据库位于 `data/anime-note.sqlite`，海报缓存位于数据库旁的 `posters/`。两者会随使用和导入生成。仓库提供源码、迁移、测试和配置模板。本机数据库、个人备份、Bangumi 归档、海报缓存和 .env 由各安装环境独立维护。

当前版本为本机单用户应用。笔记的公开状态用于本机作品讨论区。服务仅监听本机，账号认证与公网部署尚未实现。

## 开发

前端使用 React、TypeScript、Vite 与 Tailwind CSS，后端使用 Node.js 和内置 SQLite。

```sh
pnpm test
pnpm build
```

详见 [后端说明](server/README.md) 和 [个人记录 API](server/PERSONAL_API.md)。

## 后续工作

- 重新设计 UI 和前端交互，逐步替换当前的暖纸色界面。
- 排查少数海报加载失败的情况，改善出错后的恢复体验。
- 继续梳理架构和模块边界，优化性能与维护流程。
