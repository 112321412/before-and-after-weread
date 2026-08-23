import { api, clearSid } from "../api";

interface SettingsPageProps {
  onExit: () => void;
}

export function SettingsPage({ onExit }: SettingsPageProps) {
  async function exitSession() {
    try {
      await api.destroySession();
    } finally {
      clearSid();
      onExit();
    }
  }

  return (
    <section className="placeholder-page">
      <h1>设置</h1>
      <p className="placeholder-lede">Key 管理、同步状态、剧透偏好与数据控制。</p>
      <div className="placeholder-card">
        <p>完整设置页将在 Phase 4 实现，规划项：</p>
        <ul>
          <li>Key 管理：查看会话状态、断开会话（Key 仅存服务端内存）</li>
          <li>剧透偏好：无剧透 / 轻 / 全，三档</li>
          <li>数据控制：一键删除全部本地数据、导出 JSON</li>
        </ul>
        <button type="button" className="settings-exit" onClick={exitSession}>
          退出当前会话
        </button>
      </div>
    </section>
  );
}
