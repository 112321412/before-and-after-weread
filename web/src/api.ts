import type {
  CandidatesResult,
  DecisionCard,
  DecisionHistoryItem,
  IntentResult,
  RecallDraft,
  ReviewBookItem,
  ReadingListItem,
  AccessStatus,
  SessionStatus,
  SettingsResponse,
  ShelfResponse,
  SpoilerLevel,
  StatsResponse,
  SyncProgress,
  ThemeResult
} from "./types";

const SID_KEY = "weread-copilot-sid";
const ACCESS_TOKEN_KEY = "weread-copilot-access-token";
export const ACCESS_REQUIRED_EVENT = "weread-access-required";

export interface ApiError extends Error {
  code?: string;
}

export function getSid(): string | null {
  return localStorage.getItem(SID_KEY);
}

export function setSid(sid: string): void {
  localStorage.setItem(SID_KEY, sid);
}

export function clearSid(): void {
  localStorage.removeItem(SID_KEY);
}

export function isWeReadKey(value: string): boolean {
  return Boolean(value.trim());
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function isAccessErrorCode(code?: string): boolean {
  return code === "ACCESS_REQUIRED" || code === "ACCESS_EXPIRED";
}

export function isAccessGateFailure(status: number, code?: string): boolean {
  return (status === 401 || status === 403) && isAccessErrorCode(code);
}

function handleAccessFailure(path: string, status: number, code?: string): void {
  if (isAccessGateFailure(status, code) && !path.startsWith("/api/access/")) {
    clearAccessToken();
    window.dispatchEvent(new Event(ACCESS_REQUIRED_EVENT));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const sid = getSid();
  const accessToken = getAccessToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sid ? { "x-sid": sid } : {}),
      ...(accessToken ? { "x-access-token": accessToken } : {}),
      ...init?.headers
    }
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    handleAccessFailure(path, res.status, body.code);
    const error = new Error(body.error || `请求失败（HTTP ${res.status}）`) as ApiError;
    error.code = body.code;
    throw error;
  }
  return body;
}

export const api = {
  accessStatus: () => request<AccessStatus>("/api/access/status"),
  exchangeAccessPassword: (password: string) =>
    request<{ required: boolean; token?: string }>("/api/access/token", {
      method: "POST",
      body: JSON.stringify({ password })
    }),
  sessionStatus: () => request<SessionStatus>("/api/session"),
  createSession: (key: string) =>
    request<{ sid: string; mode: string }>("/api/session", { method: "POST", body: JSON.stringify({ key: key.trim() }) }),
  destroySession: () => request<{ ok: boolean }>("/api/session", { method: "DELETE" }),
  syncProgress: () => request<SyncProgress>("/api/sync/progress"),
  settings: () => request<SettingsResponse>("/api/settings"),
  updateSettings: (spoilerLevel: SpoilerLevel) =>
    request<{ spoilerLevel: SpoilerLevel }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ spoilerLevel })
    }),
  shelf: () => request<ShelfResponse>("/api/shelf"),
  stats: () => request<StatsResponse>("/api/stats"),
  decideIntent: (input: string) =>
    request<IntentResult>("/api/decide/intent", { method: "POST", body: JSON.stringify({ input }) }),
  decideCandidates: (intent: IntentResult, offset = 0) =>
    request<CandidatesResult>("/api/decide/candidates", { method: "POST", body: JSON.stringify({ intent, offset }) }),
  decideCard: (bookId: string, intent: IntentResult, selectedBookIds: string[]) =>
    request<DecisionCard>("/api/decide/card", {
      method: "POST",
      body: JSON.stringify({ bookId, intent, selectedBookIds })
    }),
  postDecision: (payload: { cardId: string; action: string; trigger?: string; reason?: string }) =>
    request<{ ok: boolean }>("/api/decision", { method: "POST", body: JSON.stringify(payload) }),
  rejudgeDecision: (payload: { recordId: number; action: string; trigger?: string; reason?: string }) =>
    request<{ ok: boolean }>("/api/decision/rejudge", { method: "POST", body: JSON.stringify(payload) }),
  decisionHistory: () => request<{ decisions: DecisionHistoryItem[] }>("/api/decision"),
  readingList: () => request<{ items: ReadingListItem[] }>("/api/reading-list"),
  exportData: async (): Promise<void> => {
    const sid = getSid();
    const accessToken = getAccessToken();
    const res = await fetch("/api/data/export", {
      headers: { ...(sid ? { "x-sid": sid } : {}), ...(accessToken ? { "x-access-token": accessToken } : {}) }
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      handleAccessFailure("/api/data/export", res.status, body.code);
      throw new Error(body.error || "导出失败");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "weread-personal-data.json";
    link.click();
    URL.revokeObjectURL(url);
  },
  deleteData: () => request<{ ok: boolean }>("/api/data", { method: "DELETE" }),
  reviewBooks: () => request<{ books: ReviewBookItem[] }>("/api/review/books"),
  reviewBook: (bookId: string) =>
    request<RecallDraft>(`/api/review/book/${bookId}`, { method: "POST", body: JSON.stringify({}) }),
  reviewTheme: (question: string) =>
    request<ThemeResult>("/api/review/theme", { method: "POST", body: JSON.stringify({ question }) }),
  // 导出返回文件流，不走统一 JSON 封装
  reviewExport: async (title: string, markdown: string): Promise<void> => {
    const sid = getSid();
    const accessToken = getAccessToken();
    const res = await fetch("/api/review/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sid ? { "x-sid": sid } : {}),
        ...(accessToken ? { "x-access-token": accessToken } : {})
      },
      body: JSON.stringify({ title, markdown })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      handleAccessFailure("/api/review/export", res.status, body.code);
      throw new Error(body.error || "导出失败");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
};

// 退出与更换 Key 共用同一条会话清理路径：服务端失效会话，客户端再清掉 sid。
export async function destroySessionAndClearSid(): Promise<void> {
  try {
    await api.destroySession();
  } finally {
    clearSid();
  }
}
