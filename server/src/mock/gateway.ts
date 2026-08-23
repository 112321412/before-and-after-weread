import type {
  GatewayClient,
  GatewayEnvelope
} from "../gateway.js";

// 实现 GatewayClient 接口的内存网关：同步管道空跑自检用（无 key 场景），
// 同时充当各接口回包结构的活文档。数据全部确定性，可断言。
const DAY = 86400;

function envelope<T extends Record<string, unknown>>(payload: T): T & GatewayEnvelope {
  return { errcode: 0, ...payload };
}

// 5 本有笔记的书，分两页返回（验证 lastSort 游标）
const NOTEBOOK_PAGE_1 = ["bk-1", "bk-2", "bk-3"];
const NOTEBOOK_PAGE_2 = ["bk-4", "bk-5"];
const NOTEBOOK_SORTS: Record<string, number> = { "bk-1": 300, "bk-2": 200, "bk-3": 100, "bk-4": 90, "bk-5": 80 };

const SHELF_BOOKS = [
  { bookId: "bk-1", title: "自检甲", author: "作者甲", cover: null as string | null, category: "社科", readUpdateTime: 1770000000, finishReading: 1 },
  { bookId: "bk-2", title: "自检乙", author: "作者乙", cover: null as string | null, category: "小说", readUpdateTime: 1770000100, finishReading: 1 },
  { bookId: "bk-3", title: "自检丙", author: "作者丙", cover: null as string | null, category: "科普", readUpdateTime: 1770000200, finishReading: 1 },
  { bookId: "bk-4", title: "自检丁", author: "作者丁", cover: null as string | null, category: "随笔", readUpdateTime: 1770000300, finishReading: 0 },
  { bookId: "bk-5", title: "自检戊", author: "作者戊", cover: null as string | null, category: "生活", readUpdateTime: 1770000400, finishReading: 1 },
  { bookId: "bk-6", title: "无笔记书", author: "作者己", cover: null as string | null, category: "社科", readUpdateTime: 1770000500, finishReading: 0 }
];

// 速度基线期望：300000/800min=375、360000/900min=400、450000/900min=500 → 中位数 400；
// bk-5 时长 20 分钟不达标应被剔除
const WORD_COUNTS: Record<string, number> = { "bk-1": 300000, "bk-2": 360000, "bk-3": 450000, "bk-4": 200000, "bk-5": 100000, "bk-6": 250000 };
const READING_SECONDS: Record<string, number> = { "bk-1": 48000, "bk-2": 54000, "bk-3": 54000, "bk-4": 3600, "bk-5": 1200, "bk-6": 7200 };

export function createMockGateway(): GatewayClient {
  return {
    async callGateway<T extends GatewayEnvelope>(apiName: string): Promise<T> {
      throw new Error(`mock 网关未直连 ${apiName}，请走薄封装方法`);
    },
    async fetchNotebooks(lastSort?: number) {
      if (lastSort === undefined) {
        return envelope({
          totalBookCount: 5,
          totalNoteCount: 24,
          hasMore: 1,
          books: NOTEBOOK_PAGE_1.map((bookId) => ({
            bookId,
            book: { title: `自检-${bookId}`, author: "作者", cover: "" },
            reviewCount: 2,
            noteCount: 3,
            bookmarkCount: 0,
            readingProgress: 1,
            markedStatus: 0,
            sort: NOTEBOOK_SORTS[bookId]
          }))
        });
      }
      if (lastSort !== 100) throw new Error(`翻页游标错误：期望 100，收到 ${lastSort}`);
      return envelope({
        totalBookCount: 5,
        totalNoteCount: 24,
        hasMore: 0,
        books: NOTEBOOK_PAGE_2.map((bookId) => ({
          bookId,
          book: { title: `自检-${bookId}`, author: "作者", cover: "" },
          reviewCount: 2,
          noteCount: 3,
          bookmarkCount: 0,
          readingProgress: 0.5,
          markedStatus: 0,
          sort: NOTEBOOK_SORTS[bookId]
        }))
      });
    },
    async fetchBookmarks(bookId: string) {
      return envelope({
        updated: [1, 2, 3].map((index) => ({
          bookmarkId: `${bookId}-bm-${index}`,
          bookId,
          chapterUid: index,
          markText: `${bookId} 的第 ${index} 条划线`,
          createTime: 1770000000 + index * DAY,
          type: 1,
          range: `cf_${index}_${index * 100}`
        })),
        chapters: [1, 2, 3].map((index) => ({ chapterUid: index, chapterIdx: index, title: `第${index}章` }))
      });
    },
    async fetchMyReviews(bookId: string, synckey = 0) {
      if (synckey === 0) {
        return envelope({
          reviews: [1, 2].map((index) => ({
            review: {
              reviewId: `${bookId}-rv-${index}`,
              content: `${bookId} 的第 ${index} 条想法`,
              abstract: `${bookId} 的第 ${index} 条划线`,
              range: `cf_${index}_${index * 100}`,
              chapterUid: index,
              createTime: 1770000000 + index * DAY
            }
          })),
          totalCount: 3,
          hasMore: 1,
          synckey: 7
        });
      }
      if (synckey !== 7) throw new Error(`synckey 游标错误：期望 7，收到 ${synckey}`);
      return envelope({
        reviews: [
          {
            review: {
              reviewId: `${bookId}-rv-3`,
              content: `${bookId} 的整本书评（无 range）`,
              createTime: 1770000500
            }
          }
        ],
        totalCount: 3,
        hasMore: 0,
        synckey: 0
      });
    },
    async fetchReadData() {
      // 本月 1 日起连续 10 天、每天 30 分钟 → 可验证周分桶
      const now = new Date();
      const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
      const readTimes: Record<string, number> = {};
      for (let day = 0; day < 10; day += 1) {
        readTimes[String(monthStart + day * DAY)] = 1800;
      }
      return envelope({ baseTime: monthStart, readTimes, totalReadTime: 18000, readDays: 10 });
    },
    async fetchBookInfo(bookId: string) {
      return envelope({ bookId, title: `自检-${bookId}`, author: "作者", wordCount: WORD_COUNTS[bookId] ?? 0, category: "社科" });
    },
    async fetchBookProgress(bookId: string) {
      const finished = SHELF_BOOKS.find((book) => book.bookId === bookId)?.finishReading === 1;
      return envelope({
        bookId,
        book: {
          progress: finished ? 100 : 42,
          recordReadingTime: READING_SECONDS[bookId] ?? 0,
          ...(finished ? { finishTime: 1770000000 } : {}),
          updateTime: 1770000000
        },
        timestamp: 1770000000
      });
    },
    async fetchShelf() {
      return envelope({ books: SHELF_BOOKS, archive: [{ name: "自检书单", bookIds: ["bk-1", "bk-2"] }], bookCount: 6 });
    }
  };
}
