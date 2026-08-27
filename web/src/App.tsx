import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ACCESS_REQUIRED_EVENT, clearAccessToken, destroySessionAndClearSid, isAccessErrorCode } from "./api";
import { useHashRoute } from "./router";
import { TopNav, type SyncState } from "./components/TopNav";
import { ToastHost } from "./components/Toast";
import { SetupPage } from "./pages/SetupPage";
import { AccessPage } from "./pages/AccessPage";

const ShelfPage = lazy(() => import("./pages/ShelfPage").then(({ ShelfPage }) => ({ default: ShelfPage })));
const DecidePage = lazy(() => import("./pages/DecidePage").then(({ DecidePage }) => ({ default: DecidePage })));
const ReviewPage = lazy(() => import("./pages/ReviewPage").then(({ ReviewPage }) => ({ default: ReviewPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(({ SettingsPage }) => ({ default: SettingsPage })));
const ReadingListPage = lazy(() =>
  import("./pages/ReadingListPage").then(({ ReadingListPage }) => ({ default: ReadingListPage }))
);

type AppPhase = "checking" | "access" | "setup" | "ready" | "error";

function isAccessError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && isAccessErrorCode(code);
}

function RouteLoading() {
  return (
    <div className="app-splash" role="status" aria-live="polite">
      正在打开页面…
    </div>
  );
}

export function App() {
  const [phase, setPhase] = useState<AppPhase>("checking");
  const [mode, setMode] = useState("mock");
  const [route, navigate] = useHashRoute();
  const [syncState, setSyncState] = useState<SyncState>("ok");
  const [syncNote, setSyncNote] = useState("尚未同步");

  const loadSession = useCallback(async () => {
    try {
      const status = await api.sessionStatus();
      setMode(status.mode);
      setPhase(status.authenticated ? "ready" : "setup");
    } catch (error) {
      setPhase(isAccessError(error) ? "access" : "setup");
    }
  }, []);

  useEffect(() => {
    api
      .accessStatus()
      .then((access) => {
        if (access.required && !access.authenticated) {
          clearAccessToken();
          setPhase("access");
          return;
        }
        void loadSession();
      })
      .catch(() => setPhase("error"));
  }, [loadSession]);

  useEffect(() => {
    const onAccessRequired = () => setPhase("access");
    window.addEventListener(ACCESS_REQUIRED_EVENT, onAccessRequired);
    return () => window.removeEventListener(ACCESS_REQUIRED_EVENT, onAccessRequired);
  }, []);

  const handleSyncStateChange = useCallback((state: SyncState, note: string) => {
    setSyncState(state);
    setSyncNote(note);
  }, []);

  const handleChangeKey = useCallback(() => {
    void destroySessionAndClearSid().finally(() => {
      navigate("/shelf");
      setPhase("setup");
    });
  }, [navigate]);

  if (phase === "checking") {
    return <div className="app-splash" />;
  }

  if (phase === "error") {
    return (
      <div className="setup-page">
        <div className="setup-card">
          <h1 className="setup-title">暂时无法连接服务</h1>
          <p className="setup-tagline">请确认服务已启动后刷新页面。</p>
        </div>
      </div>
    );
  }

  if (phase === "access") {
    return (
      <>
        <AccessPage onReady={loadSession} />
        <ToastHost />
      </>
    );
  }

  if (phase === "setup") {
    return (
      <>
        <SetupPage
          mode={mode}
          onReady={() => {
            navigate("/shelf");
            setPhase("ready");
          }}
        />
        <ToastHost />
      </>
    );
  }

  return (
    <div className="app-shell">
      <TopNav route={route} onNavigate={navigate} syncState={syncState} syncNote={syncNote} />
      <main className="app-main">
        <Suspense fallback={<RouteLoading />}>
          {route === "/decide" ? (
            <DecidePage />
          ) : route === "/reading-list" ? (
            <ReadingListPage />
          ) : route === "/review" ? (
            <ReviewPage />
          ) : route === "/settings" ? (
            <SettingsPage
              onExit={() => {
                navigate("/shelf");
                setPhase("setup");
              }}
            />
          ) : (
            <ShelfPage onSyncStateChange={handleSyncStateChange} onChangeKey={handleChangeKey} />
          )}
        </Suspense>
      </main>
      <ToastHost />
    </div>
  );
}
