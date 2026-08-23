# 工作进度与交接文档 · 阅读副驾（weread-copilot）

> 版本 v1.0 · 2026-08-23 · 交接用途：供新接手的 Agent 在不打断现有进程的情况下继续开发
> 配套必读（按顺序）：
> 1. `docs/PRD.md` —— 产品需求 v1.2（功能定义、产品原则 P1-P3、页面布局与三维书架方案、决议日志全表）
> 2. `docs/decision-card-spec.md` —— 选书决策卡字段级设计与接口映射
> 3. 本文档 —— 工程现状、已完成内容、协作红线、下一步任务书

---

## 1. 项目是什么

一句话：**微信读书的"读书选择器 + 阅读痕迹作品化工具"**——把"评分 82%"翻译成"这本书配不配得上你此刻的目标、时间和已读背景"；把划线从收藏变成作品。不做读中问答（官方 AI问书已覆盖）。

主线三段：读前决策（MVP）→ 读后整理（MVP）→ 阅读自画像（二期）。

## 2. 技术栈与运行

| 项 | 内容 |
|---|---|
| 前端 | Vite + React 18 + TypeScript + three@0.165；原生 CSS（CSS 变量驱动动态调色板）；无 UI 库、无 chart 库（图表手写 SVG） |
| 服务端 | Node 22 + Express（tsx 直接跑 TS）+ better-sqlite3 + sharp（封面主色提取） |
| 端口 | 前端 5173（Vite，`/api` 代理到 8787）、服务端 8787 |
| 命令 | `npm install && npm run dev`（concurrently 同时起前后端）；`npm run build`（双 tsc + Vite 构建，验收基线） |
| 模式 | `WEREAD_MODE=mock`（默认，12 本虚构书演示）/ `WEREAD_MODE=real`（走真实微信读书网关，需用户输 wrk- key） |
| LLM | 环境变量 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`（OpenAI 兼容端点；`server/src/llm.ts` 由 Phase 3 进行中实现，三态：real / mock fixture / degraded 规则降级） |

**注意**：开发服务以 `tsx watch` + Vite HMR 运行，改文件会自动热重载——不需要重启进程；请勿随意杀掉 8787/5173 的进程（另一工作流依赖它）。

## 3. 目录结构与文件职责（截至交接时）

```
weread/
├── docs/                      PRD.md / decision-card-spec.md / 本文档 / complete-shelf-v2.html(参考)
├── server/src/
│   ├── index.ts               Express 入口：会话路由、/api/shelf、/api/stats、/api/cover、
│   │                          /api/sync/progress、错误统一中间件（唯一 try/catch 汇聚点）
│   ├── gateway.ts             微信读书网关客户端：createGateway(key) 工厂 + callGateway 单入口
│   │                          （自动注入 skill_version "1.0.4"/Bearer/参数平铺/errcode 抛错）+ 薄方法
│   ├── sync.ts                同步引擎：全量六阶段（notebooks/shelf/notes/covers/readdata/baseline，
│   │                          阶段权重进度）、增量（note_sort 对比）、周分桶（UTC+8 周一起点）、
│   │                          速度基线（中位数，425 回退）、封面预处理、并发原语 mapWithConcurrency(≤8)
│   ├── db.ts                  SQLite 8 张表建库 + mock 播种 + 封面缓存目录
│   ├── palette.ts             主色提取（sharp 32×48 中心加权量化）→ 10 键调色板推导（纯函数）；
│   │                          暖色锚点防失真；书名哈希回退色
│   ├── llm.ts                 LLM 适配器（Phase 3 进行中）
│   └── mock/
│       ├── data.ts            12 本虚构中文书（在读/读完/弃读/想读混合）+ 划线/想法模板池 + 周时长
│       ├── cover.ts           SVG 封面动态生成（768×1152，书名排版+每书配色）
│       └── gateway.ts         实现 GatewayClient 接口的内存网关（回包结构活文档 + 自检夹具）
├── web/src/
│   ├── App.tsx / router.ts    hash 路由 + 会话门（无有效会话强制 SetupPage）
│   ├── api.ts                 前端 API 封装（sid 存取、401 处理）
│   ├── theme.ts               焦点书调色板 → :root CSS 变量批量 setProperty（720ms 过渡交给 CSS）
│   ├── pages/                 SetupPage（Key门+进度轮询/mock 2s动画）、ShelfPage（3D书架+第二屏统计四件）、
│   │                          DecidePage/ReviewPage/SettingsPage（占位，Phase 3/4 替换）
│   ├── shelf3d/               ShelfScene.ts（Three.js：RoundedBox 书体/木质搁板/滚轮0.14s吸附/LRU纹理40/
│   │                          虚拟化±8/±2预取/主题色渲染循环1-exp(-dt*5.5)趋近）、StaticShelf.tsx（降级网格）、
│   │                          textures.ts（Canvas纹理/edgeShade/木纹/书脊）
│   └── styles/                global.css（CSS变量体系）+ shelf.css
└── server/data/               weread.db + covers/（运行时生成，可删；mock 会自动重播种）
```

## 4. 数据库 Schema（8 张表，Phase 2 后现状）

```
user_settings     vid、spoiler_level、read_stats(JSON: weeklyMinutes/monthMinutes)
book_cache        book_id、title、author、meta、cover_proxy_path、cover_remote_url、
                  cover_cache_file、dominant_color、palette(JSON 10键)、fetched_at
review_cache      （已建表，尚未使用——Phase 3 书评缓存落点）
highlight         vid、book_id、chapter_uid、mark_text、range、create_time
thought           vid、book_id、content、abstract(对应划线原文)、range、create_time
shelf_snapshot    vid、book_id、progress、finished、abandoned、read_minutes、last_read_at、
                  finished_at、archive(自建书单名)、sort、note_sort(增量对比位)、sync_time
speed_baseline    vid、words_per_minute、basis(own_median|estimated)、updated_at
decision_record   id、vid、created_at、goal_type、topic、card(JSON快照)、verdict、
                  gate_hits、action、action_time  （Phase 3 写入侧实现中，建表已有）
```

mock 播种值（验收锚点）：12 本书、读完 5/弃读 2、划线 270/想法 67、周分桶 [291,364,348,297,283] 分钟、本月 928 分钟、速度基线 369.46 字/分（own_median）。

## 5. 已验收完成的工作

### Phase 1 ✅（脚手架 + Key门 + 三维书架落地页）
- Key 配置门：输 key 验证 / "演示模式进入"免 key；进度条（mock 2s 动画）
- 落地页：Three.js 三维木质书架（数据驱动——书名/颜色/调色板/尺寸全部来自 `/api/shelf`，3D 层零内容硬编码）；滚轮/拖拽/箭头横滑+吸附；**焦点书切换 → 封面主色调色板 → CSS 变量 → 背景 720ms 过渡**（实测验证：深藏青→深赭棕）；纹理 LRU 40 + 虚拟化 ±8 + 相邻预取；reduced-motion/WebGL 失败降级静态网格
- 顶部导航四页（书架/选书决策/读后整理/设置）+ 同步状态圆点
- 第二屏数据四件：周时长 SVG 柱状图（含"本月累计"）、读完/弃读、划线/想法、最近决策（空态文案）
- 参考实现只取手法（材质/edgeShade/吸附/换色机制），内容层（写死书目/手工调色板/程序封面）全部替换为接口驱动

### Phase 2 ✅（真实同步层）
- 网关 8 个薄方法：notebooks(count=100+lastSort 游标)/bookmarks/mine(**参数名 `bookid` 小写**)/readdata/bookInfo/bookProgress(shelf/similar 见 gateway)
- 全量同步六阶段（后台执行 + `/api/sync/progress` 轮询协议 {phase,current,total,percent}，400ms 轮询）
- 增量同步：`/api/shelf`（real）时笔记本概览 note_sort 对比，只重拉变化的书
- 速度基线：最近读完 ≤5 本（progress=100 且时长>30min 且 wordCount>0）字/分钟中位数
- mock 网关（`mock/gateway.ts`）：回包结构活文档 + 空跑自检夹具（Phase 2 自检 11 项全过）
- **验收数字全部核对一致**（见第 4 节锚点）

## 6. 进行中：Phase 3（另一 Agent 正在做，⚠️ 冲突红线）

**负责范围**：LLM 适配器（llm.ts）、db schema 自愈、网关补齐（/store/search、/review/list 三档、/book/chapterinfo、/book/bestbookmarks、/book/similar）、mock 书评 fixture、决策引擎 `server/src/decide/`、决策 API（/api/decide/intent、/api/decide/candidates、/api/decide/card、/api/decision）、DecidePage.tsx 完整实现、落地页最近决策卡变实。

**它正在触碰的文件（新 Agent 避免直接修改）**：
- `server/src/llm.ts`（已创建）
- `server/src/decide/`（即将创建）
- `server/src/gateway.ts`、`server/src/db.ts`（加方法/加固）
- `server/src/index.ts`（路由注册——共享文件，见第 9 节协作规则）
- `web/src/pages/DecidePage.tsx`、`web/src/api.ts`、`web/src/types.ts`
- `package.json`（可能加依赖）

## 7. 代码规范（监督方验收标准，违反会打回）

1. **不要防御性编程**：不写层层 try/catch、不做投机性配置、不为未来预埋抽象。错误统一冒泡到 Express 错误中间件 / 前端一个 toast
2. **结构清楚可读**：文件职责单一，命名与 PRD 术语一致（palette/decision/shelf/sync/review）
3. **注释克制**：只在代码说不明白处写（算法选择、魔法数字、口径陷阱），不写"这行做什么"、不写署名日期
4. **mock/real 结构对等**：mock 数据长成真实回包形状，UI 层零模式感知；落库后走同一读取路径
5. **数据驱动铁律**：渲染层零内容硬编码，一切书目/颜色/尺寸来自接口数据
6. UI 文案全部中文，语气克制不卖萌；引文/长文衬线、界面无衬线（系统字体栈）

## 8. 已知坑与事故记录（新 Agent 必读，省你半天）

1. **schema 变更崩溃链**（已发生）：改表结构后，运行中的 dev 服务热重载撞旧库缺列 → SQLITE_ERROR 崩 → tsx 重启 EADDRINUSE 二次崩。**对策**：Phase 3 正在给 db.ts 加 schema 自愈（不兼容自动重建）；在它落地前，改 schema 前先停服务、删 `server/data/`
2. **端口僵尸**：tsx watch 异常退出可能残留进程占 8787。查占用：`netstat -ano | grep 8787`，杀 PID 前确认是 node
3. **浏览器旧标签卡死**：服务崩溃期间打开的标签页会失去事件响应（点击无反应但 DOM 正常）。**对策**：关旧标签开新的，不要怀疑产品代码
4. **微信读书接口口径陷阱**（已在代码中处理，改动相关代码时注意）：`/review/list/mine` 参数是小写 `bookid`；`progress` 是 0-100 整数（1=1%）；时长单位全是秒；`readingProgress` 值域做了双态归一；`/book/similar` 必须显式传 count 和 maxIdx
5. **封面 CORS**：微信读书封面 CDN 无 CORS 头，浏览器直取会污染 canvas——封面永远走服务端代理 `/api/cover/:bookId`（mock 生成 SVG / real 代理远端并落盘）
6. **`npm run build` 是验收基线**：双 tsc + Vite，任何改动后必须零错误

## 9. 协作规则（与 Phase 3 Agent 并行工作）

- **不要重启/杀掉 dev 进程**：tsx watch + HMR 自动热重载，直接改文件即可
- **index.ts 是共享冲突面**：新路由不要直接往 index.ts 里堆——写成独立 router 模块（如 `server/src/review/router.ts` export 一个 `Router`），在 index.ts 只加一行 `app.use(reviewRouter)`（这一行冲突概率低，改前先读文件最新状态）
- **package.json**：需要新依赖时先检查 Phase 3 汇报是否也加了，`npm install` 放在自己任务末尾一次做
- **数据库**：只加表/加列（向后兼容），不动已有列名；Phase 3 的 schema 自愈落地后按其约定走
- **汇报格式**：完成后给监督方（主会话）汇报——目录树变更、自检结果、已知问题、给监督方的审查建议点

## 10. 你的任务：Phase 4 · 读后整理页（F2.1-F2.3）

产品定义见 PRD §4 F2.1/F2.2/F2.3，这里是要点与工程约束：

### F2.1 单书回顾（P0）
- 入口：ReviewPage 顶部书列表（"最近读完"/"读了一半放下"两组，数据来自 shelf_snapshot 按 finished/abandoned/progress 分组 + 有笔记的书）；也支持从书架候选
- **两种叙事框架**（LLM 生成，走 llm.ts 适配器）：
  - 读完框架：我的三个收获 / 我与作者或书友分歧处 / 还没想清的问题 / 可复用的观点与行动
  - 弃读框架：为什么停（进度轨迹+划线分布推断）/ 已经带走了什么
- 素材**严格限定"我的"**（P2 决议）：highlight 表（mark_text/chapter_uid/create_time/划线时间线）、thought 表（content+abstract 对照）、shelf_snapshot（进度/时长/读完时间）。**不含任何书友维度**（点赞接口不存在，已核查）
- 生成立场：**忠实整理 + 事实性演变标注**——发现"你对 X 的想法在 3 月与 8 月相反"作为事实列出，不评判对错、不主动挑战
- 无笔记的书给优雅空态（"这本书还没有留下痕迹"）

### F2.2 跨书主题整理（P1）
- 用户提问驱动（输入框 + 2-3 个建议问题）：从全库 highlight/thought 按问题语义检索 → 按问题→主题→分歧/演变组织，**不按书罗列摘抄**
- 素材门槛：相关痕迹不足时明示（"该主题下你只有 2 条痕迹"），不硬生成
- 演变呈现：同一主题不同时期划线/想法时间线对照；冲突作为事实标注
- 检索实现建议：关键词/简单语义匹配即可起步（SQLite LIKE + 简单打分），LLM 负责组织归纳；**不要引向量库**

### F2.3 输出物与导出（P0）
- **单书札记**：四段骨架草稿（F2.1 产物），生成后直接编辑（无前置大纲确认）
- **观点卡片组**：三段卡——观点 / 证据（我的划线引文，标注书名+章节，**引文区块只读：可删除不可改写**）/ 反思
- 导出：Markdown；**对外导出走一步预览确认**（P3 决议：预览最终内容 → 点"确认导出" → 生成 .md 下载）
- mock 模式下用 270 划线/67 想法可完整演示

### API 建议（独立 router，见第 9 节）
```
GET  /api/review/books            回顾入口书列表（分组）
POST /api/review/book/:bookId     生成单书回顾草稿（LLM，流式或轮询自定，参考 Phase 3 的做法）
POST /api/review/theme            跨书主题整理（body: question）
POST /api/review/export           导出 Markdown（body: 草稿内容；前端先预览再调用）
```

### UI 约束
- 延续现有视觉语言：引文块=暖黄荧光高亮+左竖线+衬线字体（同决策卡证据块）；verdict/状态徽章风格一致
- ReviewPage 布局自定，但保持"渐进式向下生长"的产品气质；桌面优先
- 草稿编辑器：contenteditable 或 textarea 皆可，不做富文本 toolbar（克制）

### 验收标准（监督方按此验收）
- `npm run build` 零错误；curl 走完 书列表→单书回顾→主题整理→导出（mock）
- 回顾内容只引用真实存在的划线/想法（抽查引文能在 highlight/thought 表中找到原文——P1 证据规范在 F2 的体现）
- 演变标注有时间依据（引文 createTime 对得上）
- 弃读书的回顾框架与读完书不同
- 无笔记书空态优雅；痕迹不足的主题整理明示门槛
- 与 Phase 3 的文件零冲突（按第 9 节规则）

## 11. 当前运行中的东西（交接时刻）

- dev 服务后台运行中（5173 + 8787，mock 模式，改动自动热重载）
- Phase 3 构建 Agent 后台工作中（范围见第 6 节）
- 监督会话（主对话）：负责验收、协调、冲突仲裁——完成后向它汇报
