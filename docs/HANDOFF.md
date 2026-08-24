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
| v1.3 视觉迭代 | 真实同步环、完成门控、中性外壳、封面原色 | 🔶 自动检查通过；真实 done 视觉待复验 |
| 真实模式 | 已有真实个人数据落库；Key 入口与上游 401 错误态已在浏览器验证 | 🔶 待重新输入有效 Key 后完成 done 视觉与完整旅程终验 |

- 关键 Git 快照：`125a968`（Key 门安全）→ `99e2575`（书评缓存）→ `4551d14`（非空 Key 校验）→ `6e59649`（认证错误诊断）→ `c56ebd3`（访问口令）→ `613a496`（同步隔离）→ `ab58182`（决策历史）→ `c7f8813`（F2.1 单书回顾）→ `9fbad6c`（v1.3 视觉实现基线）→ `121e3c5`（错误态双动作）；本轮 F1/F2 口径与回顾映射修复随当前阶段提交。
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

## 7. 当前任务：真实 done 视觉与完整用户旅程终验

**已完成的验证**：
- 真实本地库已确认存在个人书架、划线、想法与统计落库；本交接不记录其中的书名、原文或其他个人阅读内容。
- 浏览器已验证：输入任意非空 Key 可进入站内；真实上游 401 会显示同步失败，不会把用户踢回 Key 门。
- 本轮修正前浏览器复现了错误态“更换 Key”实际只 reload 的缺陷；修正后代码已拆为“重试同步”和“更换 Key”两个动作，但仍需用新 Key 做浏览器复验。
- 本次真实终验又发现三类口径问题：相似接口只有基础书目信息、部分真实评分以十分之一百分制返回、书目信息字数为 0 但章节目录有字数；另发现读后整理列表把 SQLite 的 snake_case 行直接当成前端对象，导致单书回顾使用了错误的 bookId。现已在候选最终页补拉缺失的 `/book/info` 详情（单本失败诚实降级），统一评分归一化，决策卡复用章节字数回退，并显式映射回顾列表契约字段。
- 新增离线真实形状检查覆盖 `867 → 86.7`、旧缓存读取修复、新缓存规范化写入、章节字数预计时长、相似详情补全/单本失败，以及 snake_case 回顾列表映射后用 bookId 生成单书回顾；这些不是新的真实 Gateway 验证。
- 离线/fixture：全部 `npm run check:*`、`npm run build`、视觉/F2.2/F2.3 回归与隐私扫描通过。

**仍待监督验收**：
1. 用户在新版错误态点击“更换 Key”，重新输入有效 Key，确认旧会话失效、sid 清理并回到 Setup。
2. 用新会话让真实同步走到 `phase=done`，确认中心环消失并进入真实书架；确认封面原色、焦点书切换与克制背景变化。
3. 完成真实用户旅程：书架落地页、动态主题、真实阅读统计、选书决策、读后整理、设置；并复验刷新恢复、退出、导出、删除与访问口令。
4. 服务端 watch 变更可能使开发态内存会话失效；需要监督让用户重新输入 Key，再复验新版 done 视觉、F1/F2 修复与完整用户旅程。
5. 上述真实浏览器终验尚未完成；mock、离线 fixture 和既有错误态验证不能替代它。

当前 5173/8787 预览服务由监督保持运行，本阶段不要求重启。

**已知遗留**（不阻塞本阶段）：
- 内置浏览器点击自动化此前不稳定，读后页生成草稿与决策卡动作仍需监督人工点击确认。
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
