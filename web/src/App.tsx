import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useHashRoute } from "./router";
import { TopNav, type SyncState } from "./components/TopNav";
import { ToastHost } from "./components/Toast";
import { SetupPage } from "./pages/SetupPage";
import { ShelfPage } from "./pages/ShelfPage";
import { DecidePage } from "./pages/DecidePage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";

type AppPhase = "checking" | "setup" | "ready";

export function App() {
  const [phase, setPhase] = useState<AppPhase>("checking");
  const [mode, setMode] = useState("mock");
  const [route, navigate] = useHashRoute();
  const [syncState, setSyncState] = useState<SyncState>("ok");
  const [syncNote, setSyncNote] = useState("尚未同步");

  useEffect(() => {
    api
      .sessionStatus()
      .then((status) => {
        setMode(status.mode);
        setPhase(status.authenticated ? "ready" : "setup");
      })
      .catch(() => setPhase("setup"));
  }, []);

  const handleSyncStateChange = useCallback((state: SyncState, note: string) => {
    setSyncState(state);
    setSyncNote(note);
  }, []);

  if (phase === "checking") {
    return <div className="app-splash" />;
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
        {route === "/decide" ? (
          <DecidePage />
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
          <ShelfPage onSyncStateChange={handleSyncStateChange} />
        )}
      </main>
      <ToastHost />
    </div>
  );
}
