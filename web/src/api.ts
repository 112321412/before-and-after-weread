import type {
  CandidatesResult,
  DecisionCard,
  DecisionHistoryItem,
  IntentResult,
  RecallDraft,
  ReviewBookItem,
  SessionStatus,
  ShelfResponse,
  StatsResponse,
  SyncProgress,
  ThemeResult
} from "./types";

const SID_KEY = "weread-copilot-sid";

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
  return /^wrk-.+/.test(value.trim());
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const sid = getSid();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sid ? { "x-sid": sid } : {}),
      ...init?.headers
    }
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `请求失败（HTTP ${res.status}）`);
  return body;
}

export const api = {
  sessionStatus: () => request<SessionStatus>("/api/session"),
  createSession: (key: string) =>
    request<{ sid: string; mode: string }>("/api/session", { method: "POST", body: JSON.stringify({ key: key.trim() }) }),
  destroySession: () => request<{ ok: boolean }>("/api/session", { method: "DELETE" }),
  syncProgress: () => request<SyncProgress>("/api/sync/progress"),
  shelf: () => request<ShelfResponse>("/api/shelf"),
  stats: () => request<StatsResponse>("/api/stats"),
  decideIntent: (input: string) =>
    request<IntentResult>("/api/decide/intent", { method: "POST", body: JSON.stringify({ input }) }),
  decideCandidates: (intent: IntentResult, offset = 0) =>
    request<CandidatesResult>("/api/decide/candidates", { method: "POST", body: JSON.stringify({ intent, offset }) }),
  decideCard: (bookId: string, intent: IntentResult) =>
    request<DecisionCard>("/api/decide/card", { method: "POST", body: JSON.stringify({ bookId, intent }) }),
  postDecision: (payload: { cardId: string; action: string; trigger?: string; reason?: string }) =>
    request<{ ok: boolean }>("/api/decision", { method: "POST", body: JSON.stringify(payload) }),
  decisionHistory: () => request<{ decisions: DecisionHistoryItem[] }>("/api/decision"),
  reviewBooks: () => request<{ books: ReviewBookItem[] }>("/api/review/books"),
  reviewBook: (bookId: string) =>
    request<RecallDraft>(`/api/review/book/${bookId}`, { method: "POST", body: JSON.stringify({}) }),
  reviewTheme: (question: string) =>
    request<ThemeResult>("/api/review/theme", { method: "POST", body: JSON.stringify({ question }) }),
  // 导出返回文件流，不走统一 JSON 封装
  reviewExport: async (title: string, markdown: string): Promise<void> => {
    const sid = getSid();
    const res = await fetch("/api/review/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(sid ? { "x-sid": sid } : {}) },
      body: JSON.stringify({ title, markdown })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
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
