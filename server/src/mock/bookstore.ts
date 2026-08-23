import { MOCK_BOOKS } from "./data.js";

// 决策演示的书店池：8 本不在书架上的虚构书 + 搜索/章节/热门划线的模拟原料。
// 《组织的失灵》是演示主打书（好评分量重但错配+超预算 → shelve），
// 《流程的常识》实操向 → read_now，《大公司病理学》与在读书重复+主题级差评 → skip。
export interface StoreBook {
  bookId: string;
  title: string;
  author: string;
  category: string;
  intro: string;
  wordCount: number;
  rating: number;
  ratingCount: number;
  style: "theory" | "practical" | "popular" | "narrative" | "essay";
  keywords: string[];
}

export const STORE_BOOKS: StoreBook[] = [
  {
    bookId: "store-001",
    title: "组织的失灵",
    author: "商北",
    category: "社科",
    intro: "从科层制的谱系出发，解释大组织为什么总在离目标最近的地方减速。",
    wordCount: 780000,
    rating: 84,
    ratingCount: 12800,
    style: "theory",
    keywords: ["组织", "失灵", "理论"]
  },
  {
    bookId: "store-002",
    title: "流程的常识",
    author: "贺一苇",
    category: "社科",
    intro: "五个可上手的流程杠杆，配二十个中小团队的改造案例与检查清单。",
    wordCount: 260000,
    rating: 79,
    ratingCount: 4300,
    style: "practical",
    keywords: ["流程", "管理", "实操"]
  },
  {
    bookId: "store-003",
    title: "大公司病理学",
    author: "阮岑",
    category: "社科",
    intro: "以组织理论三次转向为纲，系统梳理大公司病的学理脉络与经典研究。",
    wordCount: 620000,
    rating: 81,
    ratingCount: 8900,
    style: "theory",
    keywords: ["组织", "大公司病", "官僚"]
  },
  {
    bookId: "store-004",
    title: "会议的解剖",
    author: "简繁",
    category: "商务",
    intro: "把一场场例会拆开看：谁在说话、谁在沉默、决定到底在哪里做出。",
    wordCount: 210000,
    rating: 72,
    ratingCount: 2100,
    style: "practical",
    keywords: ["会议", "组织", "沟通"]
  },
  {
    bookId: "store-005",
    title: "慢决策",
    author: "桑与",
    category: "心理学",
    intro: "什么时候该快、什么时候该慢，关于决策节奏的一组反直觉研究。",
    wordCount: 230000,
    rating: 76,
    ratingCount: 3300,
    style: "popular",
    keywords: ["决策", "心理"]
  },
  {
    bookId: "store-006",
    title: "城市的算法",
    author: "纪流",
    category: "科普",
    intro: "红绿灯时长、地铁换乘、摊贩选址——城市如何被一群看不见的算法安排。",
    wordCount: 340000,
    rating: 86,
    ratingCount: 15600,
    style: "popular",
    keywords: ["城市", "算法", "科普"]
  },
  {
    bookId: "store-007",
    title: "寂静的春天之后",
    author: "苍梧",
    category: "历史",
    intro: "环境运动六十年，一部关于警惕与遗忘的编年史。",
    wordCount: 410000,
    rating: 83,
    ratingCount: 5400,
    style: "essay",
    keywords: ["环境", "历史"]
  },
  {
    bookId: "store-008",
    title: "执笔者",
    author: "岑砚",
    category: "历史",
    intro: "七位幕后执笔者的生涯，重看历史文本如何被一行行写定。",
    wordCount: 290000,
    rating: 68,
    ratingCount: 45,
    style: "narrative",
    keywords: ["历史", "写作"]
  }
];

// 书架书的搜索关键词与评分（候选池来自书店 + 书架的并集）
export const SHELF_KEYWORDS: Record<string, string[]> = {
  "mock-001": ["组织", "制度", "官僚"],
  "mock-002": ["小说", "热带"],
  "mock-003": ["逻辑", "科普"],
  "mock-004": ["非虚构", "工业"],
  "mock-005": ["科普", "地质"],
  "mock-006": ["哲学", "语言"],
  "mock-007": ["小说", "城市"],
  "mock-008": ["经济", "迁徙"],
  "mock-009": ["记忆", "心理"],
  "mock-010": ["园艺", "生活"],
  "mock-011": ["气候", "谈判"],
  "mock-012": ["登山", "随笔"]
};

export const RATINGS: Record<string, { rating: number; ratingCount: number }> = {
  "mock-001": { rating: 77, ratingCount: 6100 },
  "mock-002": { rating: 82, ratingCount: 9800 },
  "mock-003": { rating: 85, ratingCount: 12400 },
  "mock-004": { rating: 71, ratingCount: 2600 },
  "mock-005": { rating: 88, ratingCount: 18700 },
  "mock-006": { rating: 79, ratingCount: 4400 },
  "mock-007": { rating: 74, ratingCount: 3100 },
  "mock-008": { rating: 76, ratingCount: 5200 },
  "mock-009": { rating: 69, ratingCount: 1800 },
  "mock-010": { rating: 80, ratingCount: 900 },
  "mock-011": { rating: 75, ratingCount: 2700 },
  "mock-012": { rating: 83, ratingCount: 7300 }
};

// 章节标题按论证风格分池，argument_style 由标题词频推断
export const CHAPTER_POOLS: Record<StoreBook["style"], string[]> = {
  theory: ["导论：问题的提出", "组织理论的三次转向", "科层制的谱系", "信息与激励的错位", "目标置换的经典研究", "边界与模糊性", "比较的视角", "反例与修正", "结论：失灵作为常态"],
  practical: ["先诊断你的流程", "杠杆一：把等待显性化", "杠杆二：减少交接", "杠杆三：例会的三种替代", "杠杆四：例外清单", "杠杆五：回顾的节奏", "二十个改造案例", "落地检查清单"],
  popular: ["一个反直觉的开口", "数据的另一面", "三个经典实验", "被误读的结论", "生活中的映射", "边界在哪里", "如何不被绕进去"],
  narrative: ["开头：一次撤离", "旧城", "来客", "雨季的会议", "沉默的人", "转折", "尾声：新的名录"],
  essay: ["序：六十年后回望", "DDT 的十年", "立法的缝隙", "产业的反驳", "沉默的多数", "代际的遗忘", "此刻的回声"]
};

export function chapterTitles(bookId: string): string[] {
  const store = STORE_BOOKS.find((book) => book.bookId === bookId);
  if (store) return CHAPTER_POOLS[store.style];
  const shelfStyle: Record<string, StoreBook["style"]> = {
    "mock-001": "theory",
    "mock-002": "narrative",
    "mock-003": "popular",
    "mock-004": "essay",
    "mock-005": "popular",
    "mock-006": "theory",
    "mock-007": "narrative",
    "mock-008": "theory",
    "mock-009": "popular",
    "mock-010": "practical",
    "mock-011": "theory",
    "mock-012": "essay"
  };
  return CHAPTER_POOLS[shelfStyle[bookId] ?? "popular"];
}

// 热门划线（他人划线）按风格取材；章节位置决定金句型/结论型的剧透判别
const POPULAR_HIGHLIGHT_POOLS: Record<StoreBook["style"], string[]> = {
  theory: ["组织把不确定性封装成流程，也把责任一并封装了。", "激励设计的目标从来不是公平，而是可解释。", "越大越慢不是病，是结构性的物理。", "衡量什么，就得到什么——其余的会被悄悄放弃。", "制度的第一功能是让错误可以归档。", "边界越清晰的组织，越容不下例外。"],
  practical: ["先让等待可见，再谈效率。", "能不开的会是最便宜的一笔节约。", "清单的价值不在于完备，在于可执行。", "每次交接都是一次信息衰减。", "回顾会不是追责会，是校准会。", "把例外写下来，规则才开始可信。"],
  popular: ["直觉是经验的压缩包，偶尔也会压坏文件。", "数据的粒度决定了结论的形状。", "反直觉的结论往往只是换了一个分母。", "慢一点，是把信息等齐，不是拖延。", "我们高估了一次决定，低估了一千次习惯。"],
  narrative: ["旧城在雨里显出它本来的骨架。", "有人先走了，有人留下来看结局。", "她把那句话写进信里，然后烧掉了信。", "名单的最后一行空着。", "结尾来的时候，比所有人预想的都安静。"],
  essay: ["警惕是有保质期的，遗忘没有。", "每一代人都需要重新赢一次同样的争论。", "文献里的一句话，是一群人的一生。", "春天回来过，只是换了一批目击者。", "记录本身就是抵抗。"]
};

export function bestBookmarks(bookId: string): { text: string; chapterIdx: number; totalCount: number }[] {
  const style = STORE_BOOKS.find((book) => book.bookId === bookId)?.style ?? shelfStyleOf(bookId);
  const pool = POPULAR_HIGHLIGHT_POOLS[style];
  let seed = 0;
  for (const ch of bookId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return pool.slice(0, 5).map((text, index) => ({
    text,
    chapterIdx: (seed + index * 7) % Math.max(1, CHAPTER_POOLS[style].length - 1),
    totalCount: 40 + ((seed + index * 13) % 260)
  }));
}

function shelfStyleOf(bookId: string): StoreBook["style"] {
  const map: Record<string, StoreBook["style"]> = {
    "mock-001": "theory",
    "mock-002": "narrative",
    "mock-003": "popular",
    "mock-004": "essay",
    "mock-005": "popular",
    "mock-006": "theory",
    "mock-007": "narrative",
    "mock-008": "theory",
    "mock-009": "popular",
    "mock-010": "practical",
    "mock-011": "theory",
    "mock-012": "essay"
  };
  return map[bookId] ?? "popular";
}

export function keywordsOf(bookId: string): string[] {
  const store = STORE_BOOKS.find((book) => book.bookId === bookId);
  if (store) return store.keywords;
  return SHELF_KEYWORDS[bookId] ?? [];
}

export function ratingOf(bookId: string): { rating: number; ratingCount: number } {
  const store = STORE_BOOKS.find((book) => book.bookId === bookId);
  if (store) return { rating: store.rating, ratingCount: store.ratingCount };
  return RATINGS[bookId] ?? { rating: 70, ratingCount: 500 };
}

export function introOf(bookId: string): string {
  const store = STORE_BOOKS.find((book) => book.bookId === bookId);
  if (store) return store.intro;
  const shelf = MOCK_BOOKS.find((book) => book.bookId === bookId);
  return shelf ? `${shelf.author}的${shelf.category}作品，围绕${keywordsOf(bookId).slice(0, 2).join("与")}展开。` : "";
}

export function wordCountOf(bookId: string): number {
  const store = STORE_BOOKS.find((book) => book.bookId === bookId);
  if (store) return store.wordCount;
  return MOCK_BOOKS.find((book) => book.bookId === bookId)?.wordCount ?? 0;
}

// 本地搜索模拟：书店池 + 书架书按关键词匹配（任意关键词命中标题/分类/关键词表）
export function localSearch(keyword: string): { bookId: string; matched: number }[] {
  const terms = keyword.split(/\s+/).filter(Boolean);
  const all = [
    ...STORE_BOOKS.map((book) => ({ bookId: book.bookId, title: book.title, category: book.category, keywords: book.keywords })),
    ...MOCK_BOOKS.map((book) => ({ bookId: book.bookId, title: book.title, category: book.category, keywords: SHELF_KEYWORDS[book.bookId] ?? [] }))
  ];
  const results = all.map((book) => {
    const haystack = `${book.title} ${book.category} ${book.keywords.join(" ")}`;
    const matched = terms.filter((term) => haystack.includes(term) || book.keywords.some((kw) => kw.includes(term) || term.includes(kw))).length;
    return { bookId: book.bookId, matched };
  });
  return results.filter((entry) => entry.matched > 0);
}
