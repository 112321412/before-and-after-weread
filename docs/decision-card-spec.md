# 选书决策卡 · 产品与技术 Spec

> 版本 v0.1（MVP 范围）。定位：读书选择器 + 阅读痕迹作品化工具 的读前模块。
> 一句话：把"这本书评分 82%"翻译成"这本书配不配得上你此刻的目标、时间和已读背景"。

## 0. 数据基础（本 spec 的所有字段均已映射到 weread Agent Gateway 真实接口）

| 数据 | 接口 | 用途 |
|---|---|---|
| 书籍元数据（字数/评分/评分分布/译者/简介） | `/book/info` | 阅读成本、评论分歧统计 |
| 章节目录（层级/章节字数/锚点） | `/book/chapterinfo` | 论证方式与结构推断 |
| 书评按态度分拉（1=推荐 2=不行 4=一般），含星级、是否读完、时间 | `/review/list` | 评论分歧（无需自行分类） |
| 资深会员推荐率 | `/review/list` 回包 `deepVRecommendInfo` | 分歧统计补充信号 |
| 好友点评数 | `/review/list` 回包 `friendCommentCount` | 社交信号 |
| 热门划线 Top20（原文+人数） | `/book/bestbookmarks` | 写作风格证据、读者共鸣点 |
| 相似书 | `/book/similar` | 替代方案 |
| 搜索（含书单 scope=13、全文 scope=12） | `/store/search` | 候选生成、概念覆盖验证 |
| 书架（含自建书单 `archive[]`、读完标记） | `/shelf/sync` | 个人关联、防重复推荐 |
| 单书累计阅读时长（秒） | `/book/getprogress` → `recordReadingTime` | 个性化阅读速度基线 |
| 笔记概览（有笔记的书、划线/想法数、进度） | `/user/notebooks` | 个人关联 |
| 我的划线原文 / 我的想法 | `/book/bookmarklist`、`/review/list/mine` | 已读主题样本 |
| 偏好分类/作者、总时长、日均 | `/readdata/detail` | 速度基线、偏好背景 |

硬约束：网关**只读**，无法替用户把书加入微信读书待读——所有"待读/排除"动作落在本产品侧的决策档案；跳回微信读书只用 `deepLink`。正文内容不可得，内容判断只能基于简介+目录+热门划线+书评，**不假装读过全文**。

## 1. 输入

### 1.1 用户显式输入（一次对话内收齐，≤2 轮追问）

| 字段 | 必填 | 形式 | 说明 |
|---|---|---|---|
| `intent` 阅读目标 | 是 | 枚举 + 原文 | solve_problem 解决具体问题 / systematic 系统入门 / counter_view 找反方 / relax 消遣 / follow_topic 跟上话题 / revisit 重读。自由文本由 LLM 归类，**保留用户原话**用于卡片回显 |
| `topic_or_book` 主题或书目 | 是 | 自由文本 | 三种入口：a) 主题式（"组织为什么失灵"）→ 系统出候选；b) 书目式（"《权力的演化》值得读吗"）→ 单本卡；c) 书架式（"想读堆里的前 3 本挑一下"）→ 批量卡。MVP 只做 a/b |
| `constraints` 约束 | 否 | 结构化可选 | time_budget（每周小时数/总预算）、difficulty（"不想太学术"）、deadline（"两周后要用上"，影响 read_now 判定）、format |

### 1.2 系统隐式输入（自动拉取，不问用户）

- **个人速度基线**：`/readdata/detail(overall)` 总时长 + 最近读完 2-3 本的 `recordReadingTime` ÷ `wordCount` → 字/分钟；新用户回退到群体均值（中文 350-500 字/分钟）并标注"估算"
- **已读背景**：`/shelf/sync`（finishReading=1 列表、archive 书单）+ `/user/notebooks`（有笔记的书）
- **兴趣样本**：近期笔记最多 2 本的划线内容（`/book/bookmarklist`，截取主题词）

## 2. 输出（决策卡 JSON Schema，渲染成卡）

```jsonc
{
  "card_id": "dc_20260823_001",
  "book": { "bookId": "", "title": "", "author": "", "translator": "", "cover": "", "deepLink": "", "wordCount": 0, "category": "" },
  "user_goal": { "type": "solve_problem", "verbatim": "我想理解组织为什么失灵，但不想读太学术的书" },

  // ① 可解释结论
  "verdict": {
    "action": "read_now | shelve | skip",   // 现在读 / 放入待读 / 排除
    "confidence": "high | medium | low",
    "one_liner": "≤30字结论",
    "shelve_trigger": "当…时再读"             // action=shelve 时必填，决策是有条件的
  },

  // ② 内容匹配
  "content_match": {
    "core_question": "≤40字：这本书到底回答什么问题（简介+目录归纳）",
    "argument_style": "案例驱动 | 数据论证 | 理论推演 | 叙事",
    "style_evidence": "章节结构/热门划线样本的引用",
    "match_score": 1-5,
    "mismatch_warning": "目标=解决问题 但书偏解释少方法 → 明确说出错配"
  },

  // ③ 阅读成本（全个性化）
  "reading_cost": {
    "estimated_hours": 6.5,                   // wordCount ÷ 个人速度；无有效字数时为 null
    "word_count_source": "book_info | chapters | unknown", // 章节回退或待校准时明确标注
    "speed_basis": "based_on_own | estimated",
    "calendar_estimate": "按你每周3小时，约2周",
    "difficulty": "门槛描述 + 前置知识要求（差评+目录推断，挂证据）",
    "version_note": "译本/版本提醒（译者字段 + 差评中的翻译吐槽）"
  },

  // ④ 评论分歧（不是平均分，是分布和人群）
  "review_divergence": {
    "stats": { "rating": 82, "rating_count": 12000, "rating_detail": "…分布…", "deepv_recommend_rate": "86.2%", "friend_reviewers": 2 },
    "positive_themes": [ { "theme": "", "quote": "≤50字原文", "star": 100, "is_finish": true } ],
    "negative_themes": [ { "theme": "", "quote": "", "star": 20, "is_finish": true, "weight": "finished_negative 高权重" } ],
    "controversy": "好评差评谈同一件事但结论相反时的争议焦点一句话"
  },

  // ⑤ 个人关联
  "personal_link": {
    "relations": [ { "type": "补充|重复|反驳|前置", "book": "已读书名", "evidence": "引用自己哪条划线/想法/书单", "note": "一句话" } ],
    "already_in": "已在书架《管理》书单 / 曾于2025-03读到12%弃读，当时划了8条线",
    "author_history": "你读过该作者另外2本，其中一本五星"
  },

  // ⑥ 替代方案（verdict ≠ read_now 时必填）
  "alternative": [ { "title": "", "why": "一句话", "deepLink": "" } ],

  // ⑦ 证据与诚实边界
  "evidence": [ { "claim_ref": "指向卡内某结论", "source": "review:xxxx / bookmark:xxxx / api:/book/info" } ],
  "open_questions": [ "评论样本不足以判断后半段是否注水" ]
}
```

**两条铁律**：① 无证据不出结论——所有 theme/结论必须挂 reviewId/划线/接口字段，拉不到证据的点进 `open_questions`，不硬编；② 剧透控制——内容样本默认无剧透档，热门划线按"金句型/情节型"启发式分类（人名密集/章节靠后视为情节型），情节型折叠；小说类整卡切无剧透模式。

## 3. 完整用户流程（主流程一条：主题式入口）

```
用户："我想理解组织为什么失灵，但不想读太学术的书"

Step 1 意图结构化
  goal=solve_problem + 难度约束"低学术门槛"；topic=组织失灵

Step 2 候选生成（系统做，用户可改）
  /store/search(scope=10, 关键词扩展: 组织失灵/组织失效/大公司病/官僚制…)
  → 评分人数≥阈值 的 5-8 本 + /book/similar 扩展
  → 粗筛（分类匹配、评分下限、书架去重——已读过的不再进候选，除非 goal=revisit）
  → 展示 3 本候选（书名/评分/一句预告），用户可换可指定
  单本入口（"《X》值得读吗"）跳过本步

Step 3 数据拉取（并行，调用预算见 §5）
  每本候选：/book/info + /book/chapterinfo + /review/list×3档(推荐/不行/一般 各1页) + /book/bestbookmarks
  个人数据（一次）：/shelf/sync + /readdata/detail(overall) + /user/notebooks + 近期2本划线

Step 4 生成决策卡
  3 张结构化卡 + 一行横向对比（预计时长 / 门槛 / 与已读重叠度 / 结论）

Step 5 用户决策（每张卡三个动作）
  [现在读] → deepLink 跳微信读书
  [放入待读] → 写入本产品决策档案（含触发条件）
  [排除] → 写入档案 + 一句理由
  可追问展开任一字段（"差评都在骂什么"→ negative_themes 展开原文）

Step 6 归档与闭环（本产品的飞轮，也是二期"读后作品"的接口）
  决策档案 = 卡片快照 + 用户动作 + 时间
  定期检查该书 /book/getprogress：progress=100 → 生成"预期 vs 现实"复盘卡
  （当时的 verdict/顾虑 vs 实际划线与想法）→ 用于校准后续卡片 + 喂给阅读自画像
```

## 4. 红线与边界

1. **只读网关**：待读管理在本产品侧；微信读书侧动作只有 deepLink 跳转。
2. **不编造**：见两条铁律；LLM 只做归纳与对照，不做无来源断言。
3. **正文不可得**：内容匹配的证据链 = 简介 + 目录结构 + 热门划线 + 书评；`scope=12` 全文搜索可做廉价的概念覆盖验证（"这个概念在书里出现几次"），MVP 不依赖。
4. **成本可控**：单卡 8-10 次调用，3 卡 + 个人数据 ≈ 25-30 次；书评每档 1 页 20 条即够，不翻页（MVP）。

## 5. MVP 验收标准

- 一句话进，≤3 张卡出；每卡首屏一屏内，字段可展开
- 每个结论可点开看到证据引文（reviewId / 划线 / 接口字段）
- 预计时长回测：对用户已读完的书，|预测 − 实际(recordReadingTime)| / 实际 ≤ 40% 即达标
- 决策档案落库；书读完能自动出复盘卡

## 6. 暂缓项（二期）

书架瘦身批量卡（书架 progress=0 的"想读堆"）、scope=12 概念覆盖验证、决策准确率报表、跨书对比深化、分享卡形态。
