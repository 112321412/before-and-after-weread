import type { SessionStatus, ShelfResponse, StatsResponse, SyncProgress } from "./types";

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
    request<{ sid: string; mode: string }>("/api/session", { method: "POST", body: JSON.stringify({ key }) }),
  destroySession: () => request<{ ok: boolean }>("/api/session", { method: "DELETE" }),
  syncProgress: () => request<SyncProgress>("/api/sync/progress"),
  shelf: () => request<ShelfResponse>("/api/shelf"),
  stats: () => request<StatsResponse>("/api/stats")
};
