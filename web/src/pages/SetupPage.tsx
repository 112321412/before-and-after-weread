import { useState } from "react";
import { api, isWeReadKey, setSid } from "../api";

interface SetupPageProps {
  mode: string; // mock | real
  onReady: () => void;
}

export function SetupPage({ mode, onReady }: SetupPageProps) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(inputKey: string) {
    const normalizedKey = inputKey.trim();
    setError("");
    if (mode === "real" && !isWeReadKey(normalizedKey)) {
      setError("请输入微信读书 API Key");
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const { sid, mode: sessionMode } = await api.createSession(mode === "real" ? normalizedKey : "");
      setSid(sid);
      if (sessionMode === "real") {
        // 进入网站与上游同步解耦；同步状态在书架/设置页展示。
        onReady();
        return;
      }
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "接入失败");
      setBusy(false);
    }
  }

  return (
    <div className="setup-page">
      <div className="setup-card">
        <h1 className="setup-title">阅读副驾</h1>
        <p className="setup-tagline">
          把「评分 82%」翻译成「这本书配不配得上你此刻的目标、时间和已读背景」；
          <br />
          把划线从收藏变成作品。
        </p>

        {busy ? (
          <div className="setup-sync" role="status" aria-live="polite">
            <div className="sync-stage">正在建立会话…</div>
          </div>
        ) : (
          <>
            <form
              className="setup-form"
              onSubmit={(event) => {
                event.preventDefault();
                submit(key);
              }}
            >
              <input
                className="setup-input"
                type="text"
                value={key}
                placeholder="请输入微信读书 API Key"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="text"
                aria-invalid={Boolean(error)}
                onChange={(event) => setKey(event.target.value)}
              />
              <button className="setup-submit" type="submit" disabled={mode === "real" && key.trim() === ""}>
                接入微信读书
              </button>
            </form>
            {mode === "mock" && (
              <button type="button" className="setup-demo" onClick={() => submit("")}>
                演示模式进入 · 免 Key
              </button>
            )}
            <p className="setup-note">
              Key 仅保存在服务端会话内存中，不落盘、不写日志。真实模式需要在启动服务端时设置
              WEREAD_MODE=real；接入后会在站内同步书架、划线与想法，并显示真实同步状态。
            </p>
            {error && <p className="setup-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
