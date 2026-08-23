// 演示模式的固定书目：12 本虚构中文书，字段口径对齐 /shelf/sync + /user/notebooks。
// lastReadAt / finishedAt 用固定日期，保证演示数据不随启动时间漂移。
export interface MockBook {
  bookId: string;
  title: string;
  author: string;
  category: string;
  color: string; // 封面底色（SVG 封面与调色板的推导源）
  wordCount: number; // 总字数（速度基线计算用）
  progress: number; // 0-100
  finished: boolean;
  abandoned: boolean;
  highlights: number;
  thoughts: number;
  readMinutes: number;
  lastReadAt: string | null;
  finishedAt: string | null;
  archive: string | null;
}

export const MOCK_VID = "mock-reader";

export const MOCK_BOOKS: MockBook[] = [
  { bookId: "mock-001", title: "制度的心跳", author: "宋知远", category: "社科", color: "#23395b", wordCount: 320000, progress: 12, finished: false, abandoned: false, highlights: 18, thoughts: 4, readMinutes: 214, lastReadAt: "2026-08-22", finishedAt: null, archive: "组织与制度" },
  { bookId: "mock-002", title: "慢船去往热带", author: "林雾", category: "小说", color: "#b5543a", wordCount: 430000, progress: 100, finished: true, abandoned: false, highlights: 46, thoughts: 12, readMinutes: 1180, lastReadAt: "2026-08-02", finishedAt: "2026-08-02", archive: null },
  { bookId: "mock-003", title: "逻辑学的门廊", author: "顾一苇", category: "科普", color: "#2f5d50", wordCount: 290000, progress: 68, finished: false, abandoned: false, highlights: 31, thoughts: 6, readMinutes: 520, lastReadAt: "2026-08-21", finishedAt: null, archive: null },
  { bookId: "mock-004", title: "铁锈与蜂蜜", author: "陈拾", category: "非虚构", color: "#8a5a24", wordCount: 240000, progress: 23, finished: false, abandoned: true, highlights: 7, thoughts: 1, readMinutes: 96, lastReadAt: "2026-06-11", finishedAt: null, archive: null },
  { bookId: "mock-005", title: "深时简史", author: "江篁", category: "科普", color: "#274b63", wordCount: 360000, progress: 100, finished: true, abandoned: false, highlights: 39, thoughts: 9, readMinutes: 943, lastReadAt: "2026-07-19", finishedAt: "2026-07-19", archive: null },
  { bookId: "mock-006", title: "词与物的黄昏", author: "闻则", category: "哲学", color: "#4a3a5e", wordCount: 480000, progress: 100, finished: true, abandoned: false, highlights: 52, thoughts: 21, readMinutes: 1362, lastReadAt: "2026-05-30", finishedAt: "2026-05-30", archive: "长期计划" },
  { bookId: "mock-007", title: "透明街区", author: "苏昀", category: "小说", color: "#37536b", wordCount: 350000, progress: 41, finished: false, abandoned: false, highlights: 12, thoughts: 2, readMinutes: 305, lastReadAt: "2026-08-18", finishedAt: null, archive: null },
  { bookId: "mock-008", title: "候鸟经济学", author: "许望舒", category: "社科", color: "#6b4a2f", wordCount: 265000, progress: 100, finished: true, abandoned: false, highlights: 27, thoughts: 5, readMinutes: 705, lastReadAt: "2026-06-28", finishedAt: "2026-06-28", archive: null },
  { bookId: "mock-009", title: "记忆的裁切线", author: "蒋眠", category: "心理学", color: "#7c3a4d", wordCount: 210000, progress: 9, finished: false, abandoned: true, highlights: 5, thoughts: 0, readMinutes: 61, lastReadAt: "2026-05-08", finishedAt: null, archive: null },
  { bookId: "mock-010", title: "荒漠花园种植手册", author: "岑可", category: "生活", color: "#8fa03a", wordCount: 190000, progress: 0, finished: false, abandoned: false, highlights: 0, thoughts: 0, readMinutes: 0, lastReadAt: null, finishedAt: null, archive: "想读" },
  { bookId: "mock-011", title: "谈判桌上的气候", author: "沈既明", category: "社科", color: "#2e4a5e", wordCount: 280000, progress: 0, finished: false, abandoned: false, highlights: 0, thoughts: 0, readMinutes: 0, lastReadAt: null, finishedAt: null, archive: "想读" },
  { bookId: "mock-012", title: "雪线以上", author: "谢青梧", category: "随笔", color: "#55606b", wordCount: 300000, progress: 100, finished: true, abandoned: false, highlights: 33, thoughts: 7, readMinutes: 812, lastReadAt: "2026-07-05", finishedAt: "2026-07-05", archive: null }
];

// 划线原文模板池：虚构引文，只为让 highlight/thought 表有可读的真实行
const HIGHLIGHT_TEMPLATES = [
  "制度的惯性不在条文里，而在每个人对例外的默许里。",
  "真正改变方向的决策，往往发生在会议记录之外的走廊里。",
  "把复杂问题交给复杂工具，是逃避而非解决。",
  "作者在这里把“效率”还原成了一个价值判断，而不只是度量。",
  "组织的记忆比个人的记忆更长，也更不诚实。",
  "这一章的反例清单值得单独摘出来反复看。",
  "边界条件的讨论被主流叙述系统性地抹掉了。",
  "所有可持续的系统都为“慢”保留了位置。",
  "这句话第一次读像常识，放到上下文里才发现是全书最激进的一句。",
  "数据的粒度决定了结论的形状，而不是相反。",
  "他对“常识”的拆解方式：先问这个常识替谁省了事。",
  "一个解释如果不能被证伪，就只是安慰。",
  "好的框架让你看见没写出来的那一半。",
  "时间预算是最诚实的优先级声明。",
  "读到这里才发现前一章的铺垫有多重。",
  "共识不等于同意，很多时候只是疲惫。",
  "把这句话和上一本书第三章对照着读，分歧就出来了。",
  "技术决定论最诱人的地方，是它免除了人的责任。",
  "城市的形状是无数次讨价还价的凝固物。",
  "记忆不是录像，是每次都重写的剧本。",
  "他在附录里承认了正文回避的问题，诚实得罕见。",
  "分类方式本身就是一种立场。",
  "风险不在不确定里，而在确定错的地方。",
  "这个比喻用得节制，所以有效。"
];

const THOUGHT_TEMPLATES = [
  "和《制度的心跳》里对官僚制的分析放在一起，两个人的立场几乎是相反的。",
  "这里如果想清楚了，上一条划线的疑问其实就解了。",
  "这个说法要打折扣：样本只有他自己的公司。",
  "先记下来，等读完第三章回来改判。",
  "这一段让我想重新排一下下半年的书单。",
  "作者回避了分配问题，只在效率层面打转。",
  "值得抄给同事，但需要先补上下文。"
];

function seeded(seed: string): () => number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function dateToTimestamp(date: string): number {
  return Math.floor(new Date(`${date}T12:00:00+08:00`).getTime() / 1000);
}

export interface MockNoteRow {
  bookId: string;
  text: string;
  range: string;
  chapterUid: number;
  createTime: number;
  abstract?: string;
}

// 生成每本书的划线/想法行（数量与书目声明一致），时间从 lastReadAt 往前散布
export function mockHighlightRows(book: MockBook): MockNoteRow[] {
  if (book.highlights === 0) return [];
  const random = seeded(book.bookId);
  const last = dateToTimestamp(book.lastReadAt ?? "2026-04-01");
  const span = 60 * 60 * 24 * 45;
  return Array.from({ length: book.highlights }, (_, i) => ({
    bookId: book.bookId,
    text: HIGHLIGHT_TEMPLATES[Math.floor(random() * HIGHLIGHT_TEMPLATES.length)],
    range: `cf_${Math.floor(random() * 12) + 1}_${i}`,
    chapterUid: Math.floor(random() * 12) + 1,
    createTime: last - Math.floor(random() * span)
  }));
}

export function mockThoughtRows(book: MockBook): MockNoteRow[] {
  if (book.thoughts === 0) return [];
  const random = seeded(`${book.bookId}-thought`);
  const last = dateToTimestamp(book.lastReadAt ?? "2026-04-01");
  const span = 60 * 60 * 24 * 45;
  const highlights = mockHighlightRows(book);
  return Array.from({ length: book.thoughts }, (_, i) => {
    const highlight = highlights[Math.floor(random() * highlights.length)];
    return {
      bookId: book.bookId,
      text: THOUGHT_TEMPLATES[Math.floor(random() * THOUGHT_TEMPLATES.length)],
      abstract: highlight?.text,
      range: `cf_thought_${i}`,
      chapterUid: highlight?.chapterUid ?? 1,
      createTime: last - Math.floor(random() * span)
    };
  });
}

// 最近 5 周阅读时长（分钟），固定锚点 2026-07-20（周一），演示数据确定性输出
export function mockWeeklyMinutes(): { label: string; minutes: number }[] {
  const random = seeded("weekly-minutes");
  const weeks: { label: string; minutes: number }[] = [];
  const anchor = new Date("2026-07-20T08:00:00Z").getTime();
  for (let week = 0; week < 5; week += 1) {
    let minutes = 0;
    for (let day = 0; day < 7; day += 1) {
      const weekend = day >= 5;
      minutes += Math.floor(random() * (weekend ? 80 : 45)) + (weekend ? 25 : 10);
    }
    const label = new Date(anchor + week * 7 * 86400000).toISOString().slice(5, 10);
    weeks.push({ label, minutes });
  }
  return weeks;
}
