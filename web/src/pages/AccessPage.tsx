import { useState } from "react";
import { api, setAccessToken } from "../api";

interface AccessPageProps {
  onReady: () => void;
}

export function AccessPage({ onReady }: AccessPageProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!password) {
      setError("请输入访问口令");
      return;
    }
    setBusy(true);
    try {
      const result = await api.exchangeAccessPassword(password);
      if (!result.token) throw new Error("访问口令验证失败");
      setAccessToken(result.token);
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "访问口令验证失败");
      setBusy(false);
    }
  }

  return (
    <div className="setup-page">
      <div className="setup-card">
        <h1 className="setup-title">访问口令</h1>
        <p className="setup-tagline">
          这是部署方设置的访问门。通过后才会进入阅读副驾，口令不会保存在浏览器中。
        </p>
        <form
          className="setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            className="setup-input"
            type="password"
            value={password}
            placeholder="请输入访问口令"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="setup-submit" type="submit" disabled={busy || password.length === 0}>
            进入网站
          </button>
        </form>
        <p className="setup-note">访问凭证只在当前浏览器会话内有效，服务重启后需要重新输入。</p>
        {error && <p className="setup-error">{error}</p>}
      </div>
    </div>
  );
}
