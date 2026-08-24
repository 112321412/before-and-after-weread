import { useState } from "react";
import { api, isWeReadKey, setSid } from "../api";
import type { SyncPhase } from "../types";

interface SetupPageProps {
  mode: string; // mock | real
  onReady: () => void;
}

// mock 模式的本地模拟进度（接口即时返回，固定 2 秒走完同步观感）
const MOCK_STAGES = [
  { until: 0.3, label: "正在验证 Key" },
  { until: 0.7, label: "正在同步书架" },
  { until: 0.92, label: "正在提取封面主色" },
  { until: 1, label: "完成" }
];

// real 模式阶段文案，对接 GET /api/sync/progress 的 phase
const REAL_STAGE_LABELS: Record<SyncPhase, string> = {
  notebooks: "正在拉取笔记本概览",
  shelf: "正在同步书架",
  notes: "正在同步划线与想法",
  covers: "正在处理封面主色",
  readdata: "正在汇总阅读数据",
  baseline: "正在计算阅读速度基线",
  done: "完成",
  error: "同步失败"
};

export function SetupPage({ mode, onReady }: SetupPageProps) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [stageLabel, setStageLabel] = useState("");

  async function submit(inputKey: string) {
    const normalizedKey = inputKey.trim();
    setError("");
    if (mode === "real" && !isWeReadKey(normalizedKey)) {
      setError("请输入 wrk- 开头的微信读书 API Key");
      setBusy(false);
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const { sid, mode: sessionMode } = await api.createSession(mode === "real" ? normalizedKey : "");
      setSid(sid);
      if (sessionMode === "real") {
        await pollSyncProgress();
      } else {
        await animateMockProgress();
      }
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "接入失败");
      setBusy(false);
    }
  }

  async function pollSyncProgress(): Promise<void> {
    for (;;) {
      const state = await api.syncProgress();
      setProgress(state.percent);
      setStageLabel(REAL_STAGE_LABELS[state.phase]);
      if (state.phase === "done") return;
      if (state.phase === "error") throw new Error(state.error || "同步失败，请检查 Key 后重试");
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  }

  function animateMockProgress(): Promise<void> {
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const value = Math.min(1, (performance.now() - startedAt) / 2000);
        setProgress(value);
        setStageLabel(MOCK_STAGES.find((stage) => value < stage.until)?.label ?? "完成");
        if (value >= 1) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
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
          <div className="setup-sync">
            <div className="sync-stage">
              {stageLabel}
              <span className="sync-count">{Math.round(progress * 100)}%</span>
            </div>
            <div className="sync-track">
              <div className="sync-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
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
                type="password"
                value={key}
                placeholder="wrk-xxxxxxxx（微信读书 API Key）"
                autoComplete="new-password"
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
              WEREAD_MODE=real；接入后会全量同步书架、划线与想法（进度条显示真实进度）。
            </p>
            {error && <p className="setup-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
