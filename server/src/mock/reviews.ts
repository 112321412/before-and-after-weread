// 三档书评 fixture：主题名 → 评论文本变体池（通用但自然，可跨书复用），
// 每本书声明各档的主题分布（主题 + 支持条数），materializeReviews 确定性展开成完整书评列表。
export interface RawReview {
  reviewId: string;
  content: string;
  star: number; // 20=一星 … 100=五星
  isFinish: boolean;
  createTime: number;
  theme: string; // fixture 内部标注，供主题归纳；real 模式由 LLM 归纳
}

const THEME_TEXTS: Record<string, string[]> = {
  案例扎实: ["案例给得很足，每个论点都有对应的公司史实支撑。", "最喜欢第三章那个改制案例，细节扎实到可以直接抄作业。", "作者显然做过一线调研，案例不是编出来的。", "材料功夫到位，注释都快赶上正文了。"],
  框架清晰: ["结构特别清楚，读完能自己复述出整条主线。", "先给地图再上路，每章开头的小结救了我很多次。", "框架不花哨，但真的能用。", "适合做笔记的一本书，层级划分得很干净。"],
  实操性强: ["照着第二章的清单改了一版流程，两周就见效。", "不是那种读完就忘的书，工具能直接用。", "每章末的问题列表很实用。", "给团队人手买了一本。"],
  落地清单: ["检查清单打印出来贴在工位了。", "清单比正文还值。", "难得有作者肯把方法写成可执行的步骤。", "按清单走了一遍，漏项果然被抓出来三个。"],
  体系完整: ["当教材读完全不亏，脉络一以贯之。", "把散落的研究串成了一条线，功力很深。", "文献覆盖面惊人，适合入门后系统补课。"],
  门槛偏高: ["前两章的术语密度太高，劝退了两次。", "没有基础会读得很慢，建议先补一本入门的。", "更像写给同行的书，普通读者吃力。", "翻译过来的概念太多，得边查边读。"],
  翻译生硬: ["译文的长句太多，读着费劲。", "有些术语前后译法不一致。", "能看出来原文写得好，但译文减分。"],
  论证重复: ["核心观点第一章就讲完了，后面八章都在换着说法重复。", "读到一半发现和第二章说的是同一件事。", "压缩成一篇长文都嫌长。", "例子换了十个，论点还是那一个。"],
  立场先行: ["结论先行的痕迹太重，反例都轻描淡写带过。", "感觉作者先站了队再找证据。", "对立观点的呈现不公平。"],
  教材味: ["写法太像教科书，缺乏问题意识。", "四平八稳，读完记不住任何锋利的判断。", "适合考试，不适合想解决问题的人。"],
  案例偏浅: ["案例都是浅尝辄止，缺乏追踪。", "例子太小，撑不起结论。", "希望看到失败案例的分析，只有成功的。"],
  节奏拖沓: ["中段明显注水，跳过两章毫无影响。", "铺垫太长，重点来得太晚。"],
  排版松散: ["行距大、页边距宽，信息密度对不起页数。", "同样的内容做成小开本能少三分之一。"],
  水分略多: ["干货率大概六成，剩下的可以快进。", "附录比正文精彩，有点本末倒置。"],
  颠覆认知: ["推翻了我对这个话题的默认想象。", "读完看新闻的眼光都不一样了。"],
  文笔出色: ["光是文笔就值回书价。", "译笔流畅，完全感觉不出是译本。"]
};

// 每本书三档主题分布：[主题, 支持条数]；singles 为不成主题的散评条数
const BOOK_REVIEW_PLAN: Record<string, { recommend: [string, number][]; neutral: [string, number][]; negative: [string, number][]; singles: number; deepV?: number }> = {
  "store-001": {
    // 演示主打书：好评如潮但论证重复是主题级差评，配合错配+超预算闸门 → shelve
    recommend: [["案例扎实", 5], ["框架清晰", 3]],
    neutral: [["门槛偏高", 3], ["翻译生硬", 2]],
    negative: [["论证重复", 4], ["立场先行", 2]],
    singles: 2,
    deepV: 862
  },
  "store-002": {
    // 好评“案例扎实” vs 差评“案例偏浅”构成争议焦点演示
    recommend: [["实操性强", 4], ["案例扎实", 3]],
    neutral: [["排版松散", 2]],
    negative: [["案例偏浅", 2]], // 次级差评：成主题但不到主题级负面（<30% 且 <3 条）
    singles: 3,
    deepV: 791
  },
  "store-003": {
    // 与在读书重复 + 主题级差评 → skip
    recommend: [["体系完整", 4]],
    neutral: [["门槛偏高", 3]],
    negative: [["教材味", 4], ["节奏拖沓", 2]],
    singles: 1,
    deepV: 704
  },
  "store-004": { recommend: [["案例扎实", 3]], neutral: [["水分略多", 3]], negative: [["节奏拖沓", 3]], singles: 2, deepV: 655 },
  "store-005": { recommend: [["颠覆认知", 4]], neutral: [["门槛偏高", 2]], negative: [["水分略多", 2]], singles: 2, deepV: 712 },
  "store-006": { recommend: [["案例扎实", 5], ["框架清晰", 4]], neutral: [["门槛偏高", 2]], negative: [["节奏拖沓", 2]], singles: 1, deepV: 883 },
  "store-007": { recommend: [["体系完整", 4], ["文笔出色", 3]], neutral: [["节奏拖沓", 2]], negative: [["立场先行", 2]], singles: 2, deepV: 796 },
  "store-008": { recommend: [["文笔出色", 2]], neutral: [["水分略多", 2]], negative: [["节奏拖沓", 2]], singles: 2 },
  "mock-001": { recommend: [["框架清晰", 4], ["案例扎实", 3]], neutral: [["门槛偏高", 2]], negative: [["论证重复", 3]], singles: 2, deepV: 738 },
  "mock-002": { recommend: [["文笔出色", 5]], neutral: [["节奏拖沓", 2]], negative: [["节奏拖沓", 2]], singles: 1, deepV: 820 },
  "mock-003": { recommend: [["框架清晰", 4], ["颠覆认知", 3]], neutral: [["门槛偏高", 3]], negative: [["翻译生硬", 2]], singles: 2, deepV: 845 },
  "mock-004": { recommend: [["案例扎实", 3]], neutral: [["水分略多", 3]], negative: [["立场先行", 3]], singles: 2, deepV: 689 },
  "mock-005": { recommend: [["颠覆认知", 5], ["框架清晰", 3]], neutral: [["门槛偏高", 2]], negative: [["水分略多", 2]], singles: 1, deepV: 876 },
  "mock-006": { recommend: [["体系完整", 4]], neutral: [["门槛偏高", 4]], negative: [["论证重复", 3]], singles: 2, deepV: 781 },
  "mock-007": { recommend: [["文笔出色", 3]], neutral: [["节奏拖沓", 3]], negative: [["节奏拖沓", 3]], singles: 2, deepV: 726 },
  "mock-008": { recommend: [["案例扎实", 3], ["框架清晰", 3]], neutral: [["排版松散", 2]], negative: [["水分略多", 3]], singles: 2, deepV: 740 },
  "mock-009": { recommend: [["框架清晰", 2]], neutral: [["水分略多", 3]], negative: [["论证重复", 3], ["案例偏浅", 2]], singles: 2, deepV: 673 },
  "mock-010": { recommend: [["实操性强", 3], ["落地清单", 2]], neutral: [["排版松散", 2]], negative: [["案例偏浅", 2]], singles: 1, deepV: 789 },
  "mock-011": { recommend: [["体系完整", 3]], neutral: [["门槛偏高", 2]], negative: [["立场先行", 2]], singles: 2, deepV: 731 },
  "mock-012": { recommend: [["文笔出色", 4], ["案例扎实", 3]], neutral: [["节奏拖沓", 2]], negative: [["水分略多", 2]], singles: 1, deepV: 812 }
};

const SINGLE_TEXTS = [
  "中规中矩，符合预期。",
  "不好说，可能是我没读到点子上。",
  "朋友推荐的，我持保留意见。",
  "读了一半，先放放。",
  "kindle 版排版有点问题。"
];

// 确定性展开某本书某档的书评
export function materializeReviews(bookId: string, band: "recommend" | "neutral" | "negative"): RawReview[] {
  const plan = BOOK_REVIEW_PLAN[bookId];
  if (!plan) return [];
  const stars = band === "recommend" ? [100, 80] : band === "neutral" ? [60] : [20, 40];
  const reviews: RawReview[] = [];
  let index = 0;
  let textCursor = 0;
  const pushReview = (content: string, theme: string) => {
    const star = stars[index % stars.length];
    // 差评档每两条有一条“读完仍差评”，是 P1 的高权重信号
    const isFinish = band === "negative" ? index % 2 === 1 : index % 3 !== 0;
    reviews.push({
      reviewId: `${bookId}-${band}-${index}`,
      content,
      star,
      isFinish,
      createTime: 1770000000 - index * 86400 * 3,
      theme
    });
    index += 1;
  };
  for (const [theme, count] of plan[band]) {
    const variants = THEME_TEXTS[theme];
    for (let i = 0; i < count; i += 1) {
      pushReview(variants[(textCursor + i) % variants.length], theme);
    }
    textCursor += count;
  }
  for (let i = 0; i < plan.singles; i += 1) {
    pushReview(SINGLE_TEXTS[(textCursor + i) % SINGLE_TEXTS.length], `个别提及-${i}`);
  }
  return reviews;
}

export function deepVRecommendValue(bookId: string): number | undefined {
  return BOOK_REVIEW_PLAN[bookId]?.deepV;
}
