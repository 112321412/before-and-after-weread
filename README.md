# 阅读副驾（weread-copilot）

读书选择器 + 阅读痕迹作品化工具。当前代码已实现（自动检查与构建通过；真实完整用户旅程已由监督浏览器终验，写路径按数据保护约束保留自动化验证）：

- **Phase 1**：BYOK 会话、三维书架落地页（动态调色板）、阅读数据可视化
- **Phase 2**：真实同步层（F3.1 全量 / F3.2 增量 / F3.3 速度基线）、同步进度协议
- **Phase 3**：选书决策、决策历史、30 天书评缓存
- **Phase 4**：单书回顾、跨书主题、Markdown 导出、设置/数据控制、访问口令
- **v1.3 视觉迭代**：书架 hero 中心真实同步环、完成门控、中性应用外壳、封面原色与静态降级

## 启动

```bash
npm install
npm run dev
```

一条命令同时启动：

- 前端（Vite）：http://localhost:5173
- 服务端（Express + SQLite）：http://localhost:8787
- 前端的 `/api` 请求由 Vite 代理到 8787

首次进入会看到 Key 配置门，点击「演示模式进入 · 免 Key」即可体验（默认 mock 模式）。

## 模式

| 模式 | 启动方式 | 数据来源 |
|---|---|---|
| mock（默认） | `npm run dev` | 12 本虚构中文书，封面由服务端动态生成 SVG（`/api/cover/:bookId`），调色板从封面底色推导 |
| real | PowerShell：`$env:WEREAD_MODE='real'; npm run dev`<br>POSIX：`WEREAD_MODE=real npm run dev` | 微信读书 Agent API Gateway（`POST https://i.weread.qq.com/api/agent/gateway`，Bearer key，参数平铺 + `skill_version: "1.0.4"`）。封面由服务端代理，主色由服务端提取后写入本地书籍缓存 |

`.env.example` 只提供变量清单，项目不会自动加载 `.env` 或该示例文件；请在当前 shell 或托管平台设置变量。以下是只含占位值的真实模式启动示例：

PowerShell：

```powershell
$env:WEREAD_MODE='real'
$env:WEREAD_ACCESS_PASSWORD='replace-with-access-password'
$env:LLM_BASE_URL='https://provider.example/v1'
$env:LLM_API_KEY='replace-with-provider-key'
$env:LLM_MODEL='replace-with-model-name'
npm run dev
```

POSIX shell：

```bash
export WEREAD_MODE=real
export WEREAD_ACCESS_PASSWORD=replace-with-access-password
export LLM_BASE_URL=https://provider.example/v1
export LLM_API_KEY=replace-with-provider-key
export LLM_MODEL=replace-with-model-name
npm run dev
```

真实模式在 Key 配置门输入微信读书 API Key：服务端调 `/user/notebooks` 验证 → 建会话并立即返回 → 后台跑全量同步（笔记本翻页 → 书架 → 划线/想法并发 ≤8 → 封面批量取主色 → readdata 周分桶 → 速度基线），前端轮询 `GET /api/sync/progress`，在书架 hero 中心环显示真实百分比与阶段；TopNav 只显示一般同步状态。之后每次进入书架页做增量同步（笔记概览 sort 对比，只重拉变化的书）。Key 只存服务端会话内存，不落盘、不写日志。

未配置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 时，决策卡与读后整理使用规则降级态；配置齐全时才调用 OpenAI-compatible `/chat/completions`。`npm run check:llm` 使用本地临时 HTTP server 验证适配器，不等同于真实供应商调用通过。

无 key 时可用 `server/src/mock/gateway.ts`（实现 GatewayClient 接口的内存网关）空跑整条同步管道自检。

## 脚本

| 脚本 | 说明 |
|---|---|
| `npm run dev` | concurrently 同时起前后端（server: tsx watch / web: vite serve） |
| `npm run dev:server` | 只起服务端（8787） |
| `npm run dev:web` | 只起前端（5173） |
| `npm run build` | server 与 web 的 tsc 全量类型检查 + Vite 产物构建（`web/dist/`） |
| `npm run check` | 一键运行全部自动检查；包含同步基线、账户/访问控制、LLM 适配器、决策候选与真实口径 fixture、书评缓存、认证错误、F2.1 回顾列表映射与视觉/F2.2/F2.3 回归 |

## 目录

```
weread/
  docs/                 PRD、决策卡 spec、交接文档与参考页面
  server/
    src/
      index.ts          Express 入口：会话 + 同步进度 + 书架/统计/封面路由
      sync.ts           同步引擎：全量/增量管道、阶段进度、周分桶、速度基线、封面预处理
      gateway.ts        网关客户端：createGateway(key) → callGateway + 各接口薄封装
      db.ts             SQLite 初始化（8 张表，PRD 附录 B）+ mock 播种
      palette.ts        主色提取（sharp 缩 32×48 量化）→ 10 键调色板推导
      mock/             演示数据、SVG 封面、空跑网关（mock/gateway.ts）
    data/               weread.db 与封面缓存（运行时生成，已 gitignore）
  web/
    src/
      pages/            ShelfPage / SetupPage / DecidePage·ReviewPage·SettingsPage
      shelf3d/          ShelfScene（Three.js 书架）、textures、StaticShelf 降级
      api.ts / shelfState.ts / theme.ts / router.ts / types.ts
      styles/           全局样式与 CSS 变量
  scripts/              各阶段自动检查（含 check-visual-iteration.ts）
```

## 接口速查

| 接口 | 说明 |
|---|---|
| `POST /api/session` | body `{ key }` 创建会话 → `{ sid, mode }`；mock 模式免 key；real 验证后后台全量同步 |
| `GET /api/session` | 带 `x-sid` 查会话状态 |
| `DELETE /api/session` | 退出会话 |
| `GET /api/sync/progress` | 全量同步进度：`{ phase, current, total, percent, error? }`，phase ∈ notebooks/shelf/notes/covers/readdata/baseline/done/error |
| `GET /api/shelf` | 书架（books：进度/状态/封面代理路径/调色板/sizeSeed）；real 模式进入时做增量同步 |
| `GET /api/stats` | 周分桶时长、本月累计、读完/弃读、划线/想法、最近决策、速度基线 |
| `GET /api/cover/:bookId` | 封面（mock：SVG；real：代理缓存的真实封面） |

## 约定

- 前端不引 UI 组件库与图表库，图表为手写 SVG；样式由 CSS 变量驱动（焦点书调色板只写入 shelf hero 局部变量，720ms 过渡）
- 三维书架仅实例化焦点 ±8 本网格，封面纹理 LRU 上限 40；`prefers-reduced-motion` 或 WebGL 不可用时退化为静态封面网格
- mock 与 real 落库后走同一读取路径，UI / 3D 层不感知模式差异
