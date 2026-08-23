# 工作进度与交接文档 v2.0 · 阅读副驾（weread-copilot）

> 更新于 2026-08-24 · MVP 已全部交付后的状态交接
> 配套必读（按顺序）：
> 1. `docs/PRD.md` —— 产品需求 v1.2（功能定义、产品原则 P1-P3、决议日志全表）
> 2. `docs/decision-card-spec.md` —— 决策卡字段级设计与接口映射
> 3. 本文档 —— 工程现状、真实模式收尾任务书、二期方向

---

## 1. 项目是什么

**微信读书的"读书选择器 + 阅读痕迹作品化工具"**：把"评分 82%"翻译成"这本书配不配得上你此刻的目标、时间和已读背景"；把划线从收藏变成作品。不做读中问答（官方 AI问书已覆盖）。

## 2. 当前状态总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | 脚手架 + Key门 + 三维书架落地页（动态背景换色）+ 数据可视化 | ✅ 验收通过 |
| Phase 2 | 真实同步层（六阶段全量/增量/速度基线/阅读统计） | ✅ 验收通过 |
| Phase 3 | 选书决策页（意图→5选3→六块决策卡→闸门判定→档案） | ✅ 验收通过 |
| Phase 4 | 读后整理页（双框架回顾/跨书主题/札记导出） | ✅ 验收通过 |
| 真实模式 | 管道验证（伪造 key→真实网关 401）；**errcode 缺席 bug 已修待真实验证** | 🔶 收尾中（见 §7） |

- Git 快照：`64d102e`（P1-2）→ `7864085`（P3）→ `13461bc`（P4）；`gateway.ts` 的 errcode 修复未提交，验收后一并提交
- `npm run build` 零错误；dev 命令带端口自清理（`scripts/free-port.js`）
- 当前运行：用户自己起的 mock 模式 dev（8787/5173）。**接管后如需真实模式，先与用户确认再重启**

## 3. 微信读书 Skill —— API 权威文档（重要）

本项目的网关封装**唯一真相来源**是本地已安装的 skill：

```
C:\Users\Wenjie\.agents\skills\weread-skills\
├── SKILL.md         统一入口规范：POST https://i.weread.qq.com/api/agent/gateway
│                    Authorization: Bearer <wrk-key>；body 参数平铺 + skill_version "1.0.4"
├── search.md        /store/search（scope=10 电子书 / 13 书单 / 12 全文…）
├── book.md          /book/info、/book/chapterinfo、/book/getprogress
├── shelf.md         /shelf/sync（books+albums+mp 口径）
├── notes.md         /user/notebooks（lastSort 游标）、/book/bookmarklist、
│                    /review/list/mine（参数名小写 bookid）、bestbookmarks、readreviews
├── review.md        /review/list（reviewListType 0全部/1推荐/2不行/3最新/4一般；三层 review 嵌套）
├── readdata.md      /readdata/detail（mode weekly/monthly/annually/overall；时长单位秒）
└── discover.md      /book/recommend、/book/similar（count/maxIdx 必须显式传）
```

- **用法一（查口径）**：改任何网关相关代码前，先读对应 .md；字段语义冲突时以 skill 文档为准
- **用法二（直连调试）**：拿到用户 key 后可直接 curl 网关验证回包形状（`{"api_name":"/user/notebooks","count":100,"skill_version":"1.0.4"}` + Bearer 头）
- **注意**：`{"api_name":"/_list"}` 可枚举网关全部接口，用于发现文档未覆盖的能力（此前"我点赞的内容"就是不存在的，已核查）
- 用户 key 属敏感信息：只进服务端会话内存（P2 决议），**不得写入任何文件/文档/日志/仓库**

## 4. 技术栈与运行

| 项 | 内容 |
|---|---|
| 前端 | Vite + React 18 + TS + three@0.165；原生 CSS 变量体系；无 UI/chart 库 |
| 服务端 | Node 22 + Express(tsx) + better-sqlite3 + sharp |
| 命令 | `npm run dev`（mock 默认）；`WEREAD_MODE=real npm run dev`（真实模式，key 在浏览器 Key门输入）；`npm run build` |
| LLM | `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`（OpenAI 兼容）；未配置→degraded 规则态，卡面明示 |

## 5. 目录结构与数据库（现状）

```
server/src/
  index.ts          入口：会话 + shelf/stats/cover/sync 路由 + 错误中间件
  sessions.ts       会话表 + requireSession（多 router 复用）
  gateway.ts        网关客户端（13 薄方法；errcode 判断已修为"缺席=成功"）
  sync.ts           同步引擎（六阶段/增量/周分桶/速度基线/封面预处理）
  llm.ts            LLM 适配器三态（real/mock fixture/degraded）
  decide/           决策引擎：engine(编排)/gates(闸门)/themes(P1归纳)/rules/types
  review/           读后引擎：router/recall(单书回顾)/theme(跨书主题)，独立 Router 挂载
  palette.ts        主色提取 + 10 键调色板推导
  mock/             data(12书)/cover(SVG)/bookstore/reviews(三档书评)/gateway(内存网关)
  db.ts             8 张表 + schema 自愈（mock 旧库自动重建）
scripts/free-port.js  dev 启动前清 8787/5173 残留 node（tsx watch 崩溃遗留端口的顽疾）
web/src/
  pages/            Setup/Shelf/Decide/Review/Settings（全实现，Settings 为占位）
  shelf3d/          Three.js 书架（数据驱动铁律：零内容硬编码）
  theme.ts          焦点书调色板 → CSS 变量（720ms 过渡）
```

数据库 8 表见 PRD 附录 B + Phase 2 增列（shelf_snapshot.note_sort、user_settings.read_stats）。mock 播种锚点：12 本/读完5弃读2/划线270/想法67/基线369字分。

## 6. 已验收的关键机制（改动前先懂它们）

1. **数据驱动铁律**：3D 层零内容硬编码，书目/颜色/尺寸全部来自 `/api/shelf`
2. **动态背景**：焦点书 → 预计算调色板 → CSS 变量 720ms 过渡（同步时算好，渲染零开销）
3. **封面代理**：微信读书封面 CDN 无 CORS，必须走 `/api/cover/:bookId`（mock 生成 SVG / real 代理落盘）
4. **P1 证据规范**：决策卡主题阈值 `max(2,⌈15%×抽样⌉)`；读后回顾的 evidenceIds 逐一回查库表（已验 158/158）
5. **闸门判定**：封顶绝对（capped 时保底失效）→ LLM 闸门内裁量 → 置信度分级
6. **mock/real 结构对等**：同一落库路径、同一读取路径，UI 零模式感知

## 7. 当前任务：真实模式端到端收尾

**已完成的验证**：
- 管道通：伪造 key → 真实网关 HTTP 401（请求格式正确）
- 发现并修复真 bug #1：真实网关**成功回包没有 errcode 字段**，旧代码把"缺席"当错误（`网关返回错误：undefined`）。已改 `gateway.ts`：`typeof body.errcode === "number" && body.errcode !== 0` 才抛错。**该修复尚未被真实网关复验**（一次误测打到了 mock 服务上）

**下一步任务书（接管者执行）**：
1. 与用户确认后重启：`WEREAD_MODE=real npm run dev`（会杀掉用户当前 mock dev，先打招呼）
2. 用户在浏览器 Key门输 key（或经用户同意由你在会话 API 传入，key 找用户要，勿存储）
3. 盯 `GET /api/sync/progress` 六阶段走完；**逐阶段核对真实回包口径**，重点风险位：
   - `readingProgress` 值域（0-1 还是 0-100，代码已双态归一，需实证）
   - `/review/list/mine` 三层嵌套与 synckey 翻页
   - `/readdata/detail` 的 readTimes 秒级时间戳周分桶（已按 UTC+8 处理）
   - 封面 CDN 拉取与 sharp 解码（真实 jpg/png/webp）
4. 验证书架为用户真实书目：`/api/shelf` 书数/封面代理 200/调色板非回退色
5. 若某阶段报错：对照 §3 的 skill 文档定位字段差异，修复后在本文档记录"真实口径备忘"
6. 完成后 `git commit`（含 gateway.ts 修复）

**已知遗留**（不阻塞）：
- 浏览器点击自动化在本会话不可靠（内置浏览器宿主退化，三次复现）：读后页点书生成草稿、决策卡动作按钮两处 UI 点击待用户手验（API 已全验）
- 决策卡缓存为内存 Map（上限 30，重启失效）
- 主题检索 2-gram 打分召回不了同义词（"组织"≠"科层"）——二期升级点

## 8. 代码规范（验收标准）

1. 不防御性编程：错误统一冒泡到 Express 错误中间件 / 前端 toast
2. 结构清楚：文件职责单一，命名对齐 PRD 术语
3. 注释克制：只写算法选择/魔法数字/口径陷阱
4. mock/real 结构对等；数据驱动铁律不可破
5. UI 全中文、语气克制；引文衬线 + 暖黄荧光块是产品视觉记忆点
6. `npm run build` 零错误是底线；新路由写独立 Router 模块（review/router.ts 是范本）

## 9. 二期方向（PRD §7，按需启动）

复盘卡（预期vs现实，读 decision_record 回测）｜自画像（问题地图/轨迹卡/阅读信，允许适度解读但三条底线见 PRD 8.1）｜Notion/Obsidian 集成｜自动聚类主题建议｜书友对照层（视网关接口演进）｜书架瘦身批量卡｜书籍详情页（参考 docs/complete-shelf-v2.html 的打开书本形态）
