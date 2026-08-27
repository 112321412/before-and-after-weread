# 工作进度与交接文档 v2.1 · 阅读副驾（weread-copilot）

> 更新于 2026-08-24 · MVP 代码收口与视觉迭代后的状态交接
> 配套必读（按顺序）：
> 1. `docs/PRD.md` —— 产品需求 v1.3 评审稿（功能定义、产品原则 P1-P3、决议日志全表；视觉迭代实现记录另列）
> 2. `docs/decision-card-spec.md` —— 决策卡字段级设计与接口映射
> 3. 本文档 —— 工程现状、真实模式收尾任务书、二期方向

---

## 1. 项目是什么

**微信读书的"读书选择器 + 阅读痕迹作品化工具"**：把"评分 82%"翻译成"这本书配不配得上你此刻的目标、时间和已读背景"；把划线从收藏变成作品。不做读中问答（官方 AI问书已覆盖）。

## 2. 当前状态总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | 脚手架、BYOK 会话、三维/静态书架与阅读数据 | ✅ 代码与自动检查通过 |
| Phase 2 | 六阶段真实同步、增量同步、阅读速度基线与 F2.1 单书回顾 | ✅ 代码与自动检查通过 |
| Phase 3 | 选书决策、历史档案、元数据复用与 30 天书评缓存 | ✅ 代码与自动检查通过 |
| Phase 4 | 跨书主题、札记导出、设置/数据控制与访问口令 | ✅ 代码与自动检查通过 |
| v1.3 视觉迭代 | 真实同步环、完成门控、中性外壳、封面原色 | ✅ 自动检查与真实 done 视觉边界通过 |
| 真实模式 | 真实完整用户旅程已由浏览器终验；写路径按数据保护约束未触发 | ✅ 真实完整旅程通过；写路径由自动化检查覆盖 |

- 关键 Git 快照：`125a968`（Key 门安全）→ `99e2575`（书评缓存）→ `4551d14`（非空 Key 校验）→ `6e59649`（认证错误诊断）→ `c56ebd3`（访问口令）→ `613a496`（同步隔离）→ `ab58182`（决策历史）→ `c7f8813`（F2.1 单书回顾）→ `9fbad6c`（v1.3 视觉实现基线）→ `121e3c5`（错误态双动作）→ `fc0adb1`（真实口径与回顾列表修复）；本轮真实浏览器终验已通过。
- `npm run check:*` 全部通过，`npm run build` 零错误；视觉检查还覆盖 F2.2/F2.3 回归，新增真实形状与回顾列表映射检查。dev 命令带端口自清理（`scripts/free-port.js`）。
- 当前运行：监督已启动的预览服务（5173/8787），本轮不重启、不终止。

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
| 命令 | `npm run dev`（mock 默认）；真实模式：PowerShell `$env:WEREAD_MODE='real'; npm run dev` / POSIX `WEREAD_MODE=real npm run dev`（Key 在浏览器 Key 门输入）；`npm run build` |
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
  db.ts             8 张表 + 只做原地 additive migration（旧数据保留）
scripts/free-port.js  dev 启动前清 8787/5173 残留 node（tsx watch 崩溃遗留端口的顽疾）
web/src/
  pages/            Setup/Shelf/Decide/Review/Settings（全实现）
  shelf3d/          Three.js 书架（数据驱动铁律：零内容硬编码）
  shelfState.ts     同步阶段、环形进度与书架/统计可见性门控
  theme.ts          焦点书调色板 → shelf hero 局部 CSS 变量（720ms 过渡）
scripts/check-visual-iteration.ts 视觉门控、主题作用域、F2.2/F2.3 回归检查
```

数据库 8 表见 PRD 附录 B + Phase 2 增列（shelf_snapshot.note_sort、user_settings.read_stats）。mock 播种锚点：12 本/读完5弃读2/划线270/想法67/基线369字分。

## 6. 已验收的关键机制（改动前先懂它们）

1. **数据驱动铁律**：3D 层零内容硬编码，书目/颜色/尺寸全部来自 `/api/shelf`
2. **动态背景**：焦点书 → 预计算调色板 → shelf hero 局部 CSS 变量 720ms 过渡；应用外壳保持稳定中性令牌
3. **封面代理**：微信读书封面 CDN 无 CORS，必须走 `/api/cover/:bookId`（mock 生成 SVG / real 代理落盘）
4. **P1 证据规范**：决策卡主题阈值 `max(2,⌈15%×抽样⌉)`；读后回顾的 evidenceIds 逐一回查库表，自动检查保障证据原文不可被编辑改写
5. **闸门判定**：封顶绝对（capped 时保底失效）→ LLM 闸门内裁量 → 置信度分级
6. **mock/real 结构对等**：同一落库路径、同一读取路径，UI 零模式感知
7. **同步可见性**：同步环只消费真实 `SyncProgress`；`phase=done`、书架载入且统计成功后才显示下滑入口和阅读数据
8. **错误态会话动作**：`重试同步`只刷新当前会话；`更换 Key`复用 `destroySession` + `clearSid` 后回到 Setup，不复用失败会话

## 7. 真实完整用户旅程终验与当前边界

本次真实完整用户旅程终验已通过；写操作按数据保护约束未触发，以下写路径以自动化检查作为验收证据。

**已完成的真实浏览器验证**：
- 真实书架全量同步完成：真实书目、阅读统计、个人速度基线、封面切换与 v1.3 视觉边界通过；本交接不记录书名、原文、统计具体数值或其他个人阅读内容。
- 真实选书通过：意图解析、5 本候选与最多选择 3 本、相似书详情补全、评分归一化、三张决策卡、非零预计时长与横向对比均通过。
- 真实读后通过：GET 列表 → 点击单书 → 生成真实回顾，阅读轨迹、划线、想法与跨书主题整理均通过。
- 我的待读空态与设置页真实会话/同步/剧透/数据控制入口通过。
- 为保护用户数据，本次浏览器终验未触发“现在读 / 放入待读 / 排除”、剧透写入、导出、删除、退出等写操作；这些路径已有自动化检查覆盖。
- 此前的认证错误态与“更换 Key”动作问题已完成修复，并在用户重新输入 Key 后完成真实链路复验。
- 离线/fixture：全部 `npm run check:*`、`npm run build`、视觉/F2.2/F2.3 回归与隐私扫描通过；离线真实形状检查不替代真实 Gateway 验证。

**当前合理边界**：
- 未配置 LLM 时，决策卡与读后整理保持规则降级态；这是预期降级，不代表真实同步失败。
- 本轮真实浏览器已完成只读点击旅程与入口状态；上述写路径继续以自动化检查作为验收证据，避免改动用户数据。

当前 5173/8787 预览服务由监督保持运行，本阶段不要求重启。

**已知遗留**（不阻塞本阶段）：
- 决策卡缓存为内存 Map（上限 30，重启失效）。
- 主题检索 2-gram 打分召回不了同义词——二期升级点。

## 8. 代码规范（验收标准）

1. 不防御性编程：错误统一冒泡到 Express 错误中间件 / 前端 toast
2. 结构清楚：文件职责单一，命名对齐 PRD 术语
3. 注释克制：只写算法选择/魔法数字/口径陷阱
4. mock/real 结构对等；数据驱动铁律不可破
5. UI 全中文、语气克制；引文衬线 + 暖黄荧光块是产品视觉记忆点
6. `npm run build` 零错误是底线；新路由写独立 Router 模块（review/router.ts 是范本）

## 9. 二期方向（PRD §7，按需启动）

复盘卡（预期vs现实，读 decision_record 回测）｜自画像（问题地图/轨迹卡/阅读信，允许适度解读但三条底线见 PRD 8.1）｜Notion/Obsidian 集成｜自动聚类主题建议｜书友对照层（视网关接口演进）｜书架瘦身批量卡｜书籍详情页（参考 docs/complete-shelf-v2.html 的打开书本形态）
