import { useEffect, useState } from "react";
import { api, clearSid } from "../api";
import { toast } from "../components/Toast";
import type { SessionStatus, SettingsResponse, SpoilerLevel, SyncProgress } from "../types";

interface SettingsPageProps {
  onExit: () => void;
}

const SPOILER_OPTIONS: { value: SpoilerLevel; label: string; note: string }[] = [
  { value: "none", label: "无剧透", note: "结论型划线默认折叠" },
  { value: "light", label: "轻", note: "保留金句，结论型划线默认折叠" },
  { value: "full", label: "全", note: "热门划线全部展示" }
];

export function SettingsPage({ onExit }: SettingsPageProps) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [sync, setSync] = useState<SyncProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.sessionStatus(), api.settings(), api.syncProgress()])
      .then(([sessionStatus, settingsData, syncData]) => {
        setStatus(sessionStatus);
        setSettings(settingsData);
        setSync(syncData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "设置加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function changeSpoiler(level: SpoilerLevel) {
    if (!settings || level === settings.spoilerLevel) return;
    const previous = settings.spoilerLevel;
    setSettings({ ...settings, spoilerLevel: level });
    try {
      await api.updateSettings(level);
      toast(`剧透偏好已切换为「${spoilerLabel(level)}」`);
    } catch (err) {
      setSettings({ ...settings, spoilerLevel: previous });
      toast(err instanceof Error ? err.message : "剧透偏好保存失败");
    }
  }

  async function exportData() {
    setBusy(true);
    try {
      await api.exportData();
      toast("个人数据已导出");
    } catch (err) {
      toast(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteData() {
    const confirmed = window.confirm(
      "确定删除当前会话的全部个人数据吗？这会清空书架快照、划线、想法、阅读速度、决策记录和剧透偏好，且无法恢复；共享书籍/书评缓存不会删除。"
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.deleteData();
      clearSid();
      onExit();
    } catch (err) {
      toast(err instanceof Error ? err.message : "删除失败");
      setBusy(false);
    }
  }

  async function exitSession() {
    try {
      await api.destroySession();
    } finally {
      clearSid();
      onExit();
    }
  }

  const currentSync = sync ?? settings?.sync ?? null;

  return (
    <section className="settings-page">
      <header className="settings-header">
        <h1>设置</h1>
        <p>会话、同步、剧透偏好与个人数据控制。</p>
      </header>

      {loading ? (
        <p className="settings-muted">正在读取设置…</p>
      ) : (
        <div className="settings-grid">
          <article className="settings-card settings-session-card">
            <h2>当前会话</h2>
            <dl className="settings-facts">
              <div>
                <dt>状态</dt>
                <dd>{status?.authenticated ? "已连接" : "已失效"}</dd>
              </div>
              <div>
                <dt>模式</dt>
                <dd>{status?.mode === "real" ? "真实模式" : "演示模式"}</dd>
              </div>
              <div>
                <dt>同步</dt>
                <dd>{syncLabel(currentSync)}</dd>
              </div>
            </dl>
            {currentSync?.phase === "error" && (
              <p className="settings-warning">真实数据同步失败，可更换 Key 重试。当前不会使用演示数据。</p>
            )}
            {status?.createdAt && <p className="settings-muted">会话创建于 {formatDate(status.createdAt)}</p>}
          </article>

          <article className="settings-card">
            <h2>剧透偏好</h2>
            <p className="settings-card-note">默认无剧透；小说/文学类始终隐藏热门划线。</p>
            <div className="spoiler-options" role="radiogroup" aria-label="剧透偏好">
              {SPOILER_OPTIONS.map((option) => (
                <label key={option.value} className="spoiler-option">
                  <input
                    type="radio"
                    name="spoiler-level"
                    value={option.value}
                    checked={settings?.spoilerLevel === option.value}
                    onChange={() => changeSpoiler(option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.note}</small>
                  </span>
                </label>
              ))}
            </div>
          </article>

          <article className="settings-card settings-data-card">
            <h2>个人数据</h2>
            <p className="settings-card-note">导出或删除仅作用于当前会话对应的个人数据；共享缓存与封面缓存会保留。</p>
            <div className="settings-actions">
              <button type="button" className="settings-action" onClick={exportData} disabled={busy}>
                导出全部个人数据 JSON
              </button>
              <button type="button" className="settings-action settings-danger" onClick={deleteData} disabled={busy}>
                删除我的全部数据
              </button>
            </div>
          </article>

          <article className="settings-card settings-exit-card">
            <h2>会话控制</h2>
            <p className="settings-card-note">退出只使当前会话失效，不删除已同步的个人数据。</p>
            <button type="button" className="settings-exit" onClick={exitSession} disabled={busy}>
              退出当前会话
            </button>
          </article>
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </section>
  );
}

function spoilerLabel(level: SpoilerLevel): string {
  return SPOILER_OPTIONS.find((option) => option.value === level)?.label ?? level;
}

function syncLabel(sync: SyncProgress | null): string {
  if (!sync) return "尚未同步";
  if (sync.phase === "error") return sync.error ?? "同步失败";
  if (sync.phase === "done") return "已同步";
  return `同步中 ${Math.round(sync.percent * 100)}%`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}
