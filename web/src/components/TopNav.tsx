export type SyncState = "syncing" | "ok" | "error";

interface TopNavProps {
  route: string;
  onNavigate: (to: string) => void;
  syncState: SyncState;
  syncNote: string;
}

const NAV_ITEMS = [
  { path: "/shelf", label: "书架" },
  { path: "/decide", label: "选书决策" },
  { path: "/review", label: "读后整理" },
  { path: "/settings", label: "设置" }
];

export function TopNav({ route, onNavigate, syncState, syncNote }: TopNavProps) {
  return (
    <header className="top-nav">
      <button type="button" className="brand" onClick={() => onNavigate("/shelf")}>
        阅读副驾
        <span className="brand-sub">weread-copilot</span>
      </button>
      <nav className="nav-links" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.path}
            type="button"
            className={`nav-link${route === item.path ? " active" : ""}`}
            aria-current={route === item.path ? "page" : undefined}
            onClick={() => onNavigate(item.path)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className={`sync-dot ${syncState}`} title={syncNote} aria-label={`同步状态：${syncNote}`}>
        <span className="sync-dot-core" />
        <span className="sync-note">{syncNote}</span>
      </div>
    </header>
  );
}
