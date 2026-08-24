// 微信读书 Agent API Gateway 客户端（真实模式）。
// 单一入口 callGateway：自动注入 skill_version、Bearer key、参数平铺、errcode 非 0 抛统一错误。
// 新增接口 = 在返回对象上加一个十几行的薄封装，骨架零改动。
const GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION = "1.0.4";
const GATEWAY_AUTH_ERROR = "Key 无效、过期或权限不匹配，请重新生成";

export class GatewayHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(statusCode === 401 || statusCode === 403 ? GATEWAY_AUTH_ERROR : `网关请求失败：HTTP ${statusCode}`);
    this.name = "GatewayHttpError";
  }
}

export interface GatewayEnvelope {
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
}

export interface NotebookEntry {
  bookId: string;
  book: { title: string; author: string; cover: string };
  reviewCount: number; // 想法/点评数
  noteCount: number; // 划线数
  bookmarkCount: number;
  readingProgress: number;
  markedStatus: number;
  sort: number; // 最近笔记时间，翻页游标 & 增量同步对比位
}

export interface NotebooksResponse extends GatewayEnvelope {
  totalBookCount: number;
  totalNoteCount: number;
  hasMore: number;
  books: NotebookEntry[];
}

export interface BookmarkListResponse extends GatewayEnvelope {
  updated: {
    bookmarkId: string;
    bookId: string;
    chapterUid: number;
    markText: string;
    createTime: number;
    type: number; // 0=书签 1=划线（接口已过滤书签）
    range: string;
    colorStyle?: number;
  }[];
  chapters: { chapterUid: number; chapterIdx: number; title: string }[];
}

export interface MyReviewsResponse extends GatewayEnvelope {
  reviews: {
    review: {
      reviewId: string;
      content: string;
      abstract?: string; // 想法对应的划线原文（书评/章节点评可能为空）
      range?: string;
      star?: number; // 统一落库为 0-5；无星级为 -1
      isFinish?: number | boolean;
      chapterUid?: number;
      chapterIdx?: number;
      chapterName?: string;
      createTime: number;
    };
  }[];
  totalCount: number;
  hasMore: number;
  synckey: number;
}

export interface ReadDataResponse extends GatewayEnvelope {
  baseTime: number;
  readTimes: Record<string, number>; // key=分桶起始时间戳（秒），value=秒；monthly 按天分桶
  totalReadTime: number; // 秒
  readDays?: number;
}

export interface BookInfoResponse extends GatewayEnvelope {
  bookId: string;
  title: string;
  author: string;
  wordCount: number;
  newRating?: number;
  newRatingCount?: number;
  category?: string;
  intro?: string;
  deepLink?: string;
}

export interface BookProgressResponse extends GatewayEnvelope {
  bookId: string;
  book: {
    progress: number; // 真实回包中读完的书也常为 99，读完判定以 finishTime 为准
    readingTime?: number; // 单书文字阅读时长（秒）。recordReadingTime 是朗读/TTS 时长，常为 0
    recordReadingTime?: number;
    finishTime?: number;
    updateTime: number;
  };
  timestamp: number;
}

export interface StoreSearchResponse extends GatewayEnvelope {
  sid: string;
  hasMore: number;
  results: {
    title: string;
    scope: number; // 回包分组类型不等于请求 scope，不作为过滤条件
    books: {
      searchIdx: number;
      bookInfo: {
        bookId: string;
        title: string;
        author: string;
        cover?: string;
        intro?: string;
        category?: string;
        deepLink?: string;
        soldout?: number;
      };
      readingCount?: number;
      newRating?: number;
      newRatingCount?: number;
    }[];
  }[];
}

export interface ReviewListResponse extends GatewayEnvelope {
  reviewsCnt: number;
  friendCommentCount?: number;
  deepVRecommendInfo?: { title: string; subtitle: string };
  deepVRecommendValue?: number; // 862 = 86.2%
  reviewsHasMore: number;
  reviews: {
    idx: number;
    review: {
      review: {
        reviewId: string;
        content: string;
        star: number; // 20=一星 … 100=五星
        isFinish?: number;
        createTime: number;
        author?: { name: string };
      };
    };
  }[];
}

export interface ChapterInfoResponse extends GatewayEnvelope {
  bookId: string;
  chapters: { chapterUid: number; chapterIdx: number; title: string; wordCount: number; level: number }[];
}

export interface BestBookmarksResponse extends GatewayEnvelope {
  totalCount: number;
  items: { bookId: string; chapterUid: number; range: string; markText: string; totalCount: number }[];
  chapters: { chapterUid: number; chapterIdx: number; title: string }[];
}

export interface SimilarResponse extends GatewayEnvelope {
  booksimilar: {
    sessionId: string;
    books: {
      idx: number;
      book: { bookInfo: { bookId: string; title: string; author: string; cover?: string; intro?: string; deepLink?: string } };
    }[];
  };
}

// books[] 字段以 PRD 与 decision-card-spec 提到的口径为准；albums/mp 属书架总数口径，后续阶段接入
export interface ShelfSyncResponse extends GatewayEnvelope {
  books: {
    bookId: string;
    title: string;
    author: string;
    cover?: string | null;
    category: string;
    progress?: number;
    readUpdateTime: number;
    finishReading: number;
    deepLink?: string;
  }[];
  archive: { name: string; bookIds: string[] }[];
  bookCount: number;
}

export interface GatewayClient {
  callGateway<T extends GatewayEnvelope>(apiName: string, params?: Record<string, unknown>): Promise<T>;
  fetchNotebooks(lastSort?: number): Promise<NotebooksResponse>;
  fetchBookmarks(bookId: string): Promise<BookmarkListResponse>;
  fetchMyReviews(bookId: string, synckey?: number): Promise<MyReviewsResponse>;
  fetchReadData(mode: "weekly" | "monthly" | "annually" | "overall"): Promise<ReadDataResponse>;
  fetchBookInfo(bookId: string): Promise<BookInfoResponse>;
  fetchBookProgress(bookId: string): Promise<BookProgressResponse>;
  fetchShelf(): Promise<ShelfSyncResponse>;
  fetchStoreSearch(keyword: string): Promise<StoreSearchResponse>;
  fetchReviewList(bookId: string, reviewListType: 1 | 2 | 4): Promise<ReviewListResponse>;
  fetchChapterInfo(bookId: string): Promise<ChapterInfoResponse>;
  fetchBestBookmarks(bookId: string): Promise<BestBookmarksResponse>;
  fetchSimilar(bookId: string): Promise<SimilarResponse>;
}

// key 绑定在客户端实例上，由会话层创建（key 只存在会话内存）
export function createGateway(key: string): GatewayClient {
  const callGateway = async <T extends GatewayEnvelope>(
    apiName: string,
    params: Record<string, unknown> = {}
  ): Promise<T> => {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ api_name: apiName, ...params, skill_version: SKILL_VERSION })
    });
    if (!res.ok) throw new GatewayHttpError(res.status);
    const body = (await res.json()) as T;
    // 成功回包的 errcode 字段可以整个缺席（真实网关验证），只有显式非 0 才是错误
    if (typeof body.errcode === "number" && body.errcode !== 0) {
      throw new Error(`网关返回错误：${body.errcode}`);
    }
    return body;
  };

  return {
    callGateway,
    // 笔记本概览：count=100 + lastSort 游标翻页（hasMore=1 时用最后一本 sort 续拉）
    fetchNotebooks: (lastSort?: number) =>
      callGateway<NotebooksResponse>("/user/notebooks", { count: 100, ...(lastSort !== undefined ? { lastSort } : {}) }),
    fetchBookmarks: (bookId: string) => callGateway<BookmarkListResponse>("/book/bookmarklist", { bookId }),
    // 注意：本接口参数名是 bookid（小写 i），synckey 翻页游标
    fetchMyReviews: (bookId: string, synckey = 0) =>
      callGateway<MyReviewsResponse>("/review/list/mine", { bookid: bookId, count: 20, synckey }),
    fetchReadData: (mode) => callGateway<ReadDataResponse>("/readdata/detail", { mode }),
    fetchBookInfo: (bookId: string) => callGateway<BookInfoResponse>("/book/info", { bookId }),
    fetchBookProgress: (bookId: string) => callGateway<BookProgressResponse>("/book/getprogress", { bookId }),
    fetchShelf: () => callGateway<ShelfSyncResponse>("/shelf/sync"),
    // 找书固定电子书 scope=10
    fetchStoreSearch: (keyword: string) =>
      callGateway<StoreSearchResponse>("/store/search", { keyword, scope: 10 }),
    // 三档各拉一页：1=推荐 2=不行 4=一般
    fetchReviewList: (bookId: string, reviewListType: 1 | 2 | 4) =>
      callGateway<ReviewListResponse>("/review/list", { bookId, reviewListType, count: 20, maxIdx: 0, synckey: 0 }),
    fetchChapterInfo: (bookId: string) => callGateway<ChapterInfoResponse>("/book/chapterinfo", { bookId }),
    fetchBestBookmarks: (bookId: string) =>
      callGateway<BestBookmarksResponse>("/book/bestbookmarks", { bookId, chapterUid: 0, synckey: 0 }),
    // 底层要求 count/maxIdx 显式传且与 listTypes/synckey 长度一致
    fetchSimilar: (bookId: string) =>
      callGateway<SimilarResponse>("/book/similar", { bookId, count: 12, maxIdx: 0 })
  };
}
