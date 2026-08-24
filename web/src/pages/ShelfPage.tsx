import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { applyPalette } from "../theme";
import { bookStatusLabel, type ShelfBook, type StatsResponse } from "../types";
import { ShelfScene, prefersReducedMotion, webglAvailable } from "../shelf3d/ShelfScene";
import { StaticShelf } from "../shelf3d/StaticShelf";
import { toast } from "../components/Toast";
import type { SyncState } from "../components/TopNav";

interface ShelfPageProps {
  onSyncStateChange: (state: SyncState, note: string) => void;
}

export function ShelfPage({ onSyncStateChange }: ShelfPageProps) {
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [error, setError] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ShelfScene | null>(null);
  const use3D = useMemo(() => webglAvailable() && !prefersReducedMotion(), []);

  useEffect(() => {
    onSyncStateChange("syncing", "正在同步书架");
    let cancelled = false;
    const applySnapshot = (shelf: Awaited<ReturnType<typeof api.shelf>>, statsData: StatsResponse) => {
      if (cancelled) return;
      setBooks(shelf.books);
      setStats(statsData);
      if (shelf.sync?.phase === "error") {
        const message = shelf.sync.error ?? "真实数据同步失败，可更换 Key 重试";
        setSyncNotice(message);
        onSyncStateChange("error", message);
      } else if (shelf.mode === "real" && shelf.sync?.phase !== "done") {
        setSyncNotice("");
        onSyncStateChange("syncing", "正在同步真实数据");
      } else {
        setSyncNotice("");
        onSyncStateChange("ok", shelf.mode === "mock" ? "演示书架已同步" : "真实数据已同步");
      }
    };
    const pollInitialSync = async () => {
      try {
        for (;;) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          const progress = await api.syncProgress();
          if (cancelled) return;
          if (progress.phase === "error") {
            const message = progress.error ?? "真实数据同步失败，可更换 Key 重试";
            setSyncNotice(message);
            onSyncStateChange("error", message);
            return;
          }
          if (progress.phase === "done") {
            const freshShelf = await api.shelf();
            const freshStats = await api.stats();
            applySnapshot(freshShelf, freshStats);
            return;
          }
          onSyncStateChange("syncing", `正在同步真实数据 ${Math.round(progress.percent * 100)}%`);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "真实数据同步失败，可更换 Key 重试";
        setSyncNotice(message);
        onSyncStateChange("error", message);
      }
    };
    Promise.all([api.shelf(), api.stats()])
      .then(([shelf, statsData]) => {
        applySnapshot(shelf, statsData);
        if (shelf.mode === "real" && shelf.sync && shelf.sync.phase !== "done" && shelf.sync.phase !== "error") {
          void pollInitialSync();
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "书架加载失败");
        onSyncStateChange("error", "同步失败");
      });
    return () => {
      cancelled = true;
    };
  }, [onSyncStateChange]);

  useEffect(() => {
    if (!use3D || books.length === 0 || !mountRef.current || sceneRef.current) return;
    const scene = new ShelfScene(mountRef.current, {
      books,
      onFocus: (index) => setFocusIndex(index),
      onActivate: () => toast("书籍详情页 · 本期预留")
    });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [use3D, books]);

  // 焦点书 → 10 键调色板写入 :root，页面背景随之 720ms 过渡
  useEffect(() => {
    const book = books[focusIndex];
    if (book) applyPalette(book.palette);
  }, [books, focusIndex]);

  const nudge = useCallback(
    (direction: number) => {
      if (sceneRef.current) {
        sceneRef.current.nudge(direction);
        return;
      }
      setFocusIndex((current) => Math.min(books.length - 1, Math.max(0, current + direction)));
    },
    [books.length]
  );

  const focused = books[focusIndex];

  return (
    <>
      <section className="shelf-hero" aria-label="书架">
        {syncNotice && (
          <div className="shelf-sync-warning" role="status">
            {syncNotice} {books.length > 0 ? "当前显示已有本地快照。" : "暂无可用的本地书架快照。"}
          </div>
        )}
        {error ? (
          <div className="shelf-error">
            <p>{error}</p>
            <button type="button" onClick={() => window.location.reload()}>
              重试
            </button>
          </div>
        ) : use3D && books.length > 0 ? (
          <>
            <div className="shelf-canvas-mount" ref={mountRef} aria-label="三维书架：滚轮或左右箭头切换焦点书" />
            <div className="hero-bottom-fade" aria-hidden="true" />
          </>
        ) : books.length > 0 ? (
          <StaticShelf
            books={books}
            focusIndex={focusIndex}
            onFocus={setFocusIndex}
            onActivate={() => toast("书籍详情页 · 本期预留")}
          />
        ) : (
          <div className="shelf-loading">{syncNotice ? "暂无可用的本地书架快照。" : "正在取出你的书架…"}</div>
        )}

        <div className="shelf-info">
          <button type="button" className="shelf-arrow" aria-label="上一本" onClick={() => nudge(-1)}>
            ‹
          </button>
          <div className="shelf-meta">
            <h2 className="shelf-title">{focused?.title ?? ""}</h2>
            <p className="shelf-status">
              {focused ? `${focused.author} · ${bookStatusLabel(focused)}${focused.highlights > 0 ? ` · 划线 ${focused.highlights}` : ""}` : ""}
            </p>
          </div>
          <button type="button" className="shelf-arrow" aria-label="下一本" onClick={() => nudge(1)}>
            ›
          </button>
          <span className="shelf-counter">
            {String(focusIndex + 1).padStart(2, "0")} / {String(books.length).padStart(2, "0")}
          </span>
        </div>
        <button
          type="button"
          className="scroll-hint"
          onClick={() => document.getElementById("stats-section")?.scrollIntoView({ behavior: "smooth" })}
        >
          ↓ 下滑查看阅读数据
        </button>
      </section>
      <StatsSection stats={stats} />
    </>
  );
}

function StatsSection({ stats }: { stats: StatsResponse | null }) {
  return (
    <section id="stats-section" className="stats-section" aria-label="阅读数据">
      <header className="stats-header">
        <h2>近期阅读</h2>
        <p>书架之外，读过的痕迹都算数。</p>
      </header>
      <div className="stats-grid">
        <article className="stat-card stat-chart">
          <h3>
            本月阅读时长 · 按周
            <span className="month-total">{stats ? `本月累计 ${(stats.monthMinutes / 60).toFixed(1)} 小时` : ""}</span>
          </h3>
          <WeeklyBars data={stats?.weeklyMinutes ?? []} />
          {stats?.speedBaseline && (
            <p className="stat-caption">
              阅读速度基线约 {Math.round(stats.speedBaseline.wpm)} 字/分钟
              （{stats.speedBaseline.basis === "own_median" ? "按你最近读完的书估算" : "按群体均值估算"}），
              决策卡的预计时长将按此换算。
            </p>
          )}
        </article>
        <article className="stat-card">
          <h3>读完 / 弃读</h3>
          <div className="stat-pair">
            <div className="stat-number">
              <strong>{stats?.finished ?? 0}</strong>
              <span>读完</span>
            </div>
            <div className="stat-number">
              <strong>{stats?.abandoned ?? 0}</strong>
              <span>弃读</span>
            </div>
          </div>
          <p className="stat-caption">弃读也是一次决策，回顾框架在读后整理页。</p>
        </article>
        <article className="stat-card">
          <h3>划线 / 想法</h3>
          <div className="stat-pair">
            <div className="stat-number">
              <strong>{stats?.highlights ?? 0}</strong>
              <span>划线</span>
            </div>
            <div className="stat-number">
              <strong>{stats?.thoughts ?? 0}</strong>
              <span>想法</span>
            </div>
          </div>
          <p className="stat-caption">读后整理的原料，全部来自你自己的痕迹。</p>
        </article>
        <article className="stat-card stat-decisions">
          <h3>最近决策</h3>
          {stats && stats.recentDecisions.length > 0 ? (
            <ul className="decision-list">
              {stats.recentDecisions.map((decision) => (
                <li key={decision.id}>
                  <span className={`verdict verdict-${decision.verdict}`}>{verdictLabel(decision.verdict)}</span>
                  <span className="decision-topic">{decision.topic ?? "未命名主题"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="stat-empty">
              还没有决策记录。
              <br />
              选书决策页开放后，每一次「现在读 / 放入待读 / 排除」的判定都会归档在这里。
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

function verdictLabel(verdict: string): string {
  if (verdict === "read_now") return "现在读";
  if (verdict === "shelve") return "放入待读";
  return "排除";
}

function WeeklyBars({ data }: { data: { label: string; minutes: number }[] }) {
  if (data.length === 0) {
    return <p className="stat-empty">暂无阅读时长数据。</p>;
  }
  const width = 560;
  const height = 210;
  const padding = { top: 28, right: 12, bottom: 30, left: 12 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((item) => item.minutes), 1);
  const slot = innerWidth / data.length;
  const barWidth = slot * 0.5;
  const baseline = padding.top + innerHeight;

  return (
    <svg className="weekly-bars" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最近五周阅读时长柱状图">
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <line
          key={ratio}
          className="bar-grid"
          x1={padding.left}
          x2={width - padding.right}
          y1={baseline - innerHeight * ratio}
          y2={baseline - innerHeight * ratio}
        />
      ))}
      {data.map((item, index) => {
        const barHeight = (item.minutes / max) * innerHeight;
        const x = padding.left + slot * index + (slot - barWidth) / 2;
        return (
          <g key={item.label}>
            <rect
              className="bar-rect"
              x={x}
              y={baseline - barHeight}
              width={barWidth}
              height={Math.max(barHeight, 2)}
              rx="3"
            />
            <text className="bar-value" x={x + barWidth / 2} y={baseline - barHeight - 8} textAnchor="middle">
              {(item.minutes / 60).toFixed(1)}h
            </text>
            <text className="bar-label" x={x + barWidth / 2} y={baseline + 20} textAnchor="middle">
              {item.label}
            </text>
          </g>
        );
      })}
      <line className="bar-axis" x1={padding.left} x2={width - padding.right} y1={baseline} y2={baseline} />
    </svg>
  );
}
