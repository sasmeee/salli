import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Pairing, View } from "@/lib/salli";
import "@/lib/theme";
import { PairScreen } from "@/screens/PairScreen";
import { WelcomeScreen } from "@/screens/WelcomeScreen";
import { Dashboard } from "@/screens/Dashboard";
import { SettingsScreen } from "@/screens/SettingsScreen";
import "./App.css";

export default function App() {
  const [pair, setPair] = useState<Pairing | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [left, setLeft] = useState(30);
  const [screen, setScreen] = useState<"home" | "settings">("home");

  const loadPair = () => invoke<Pairing>("pairing_info").then(setPair);
  const loadView = () => invoke<View>("get_state").then(setView);

  useEffect(() => {
    loadPair();
    loadView();
    const subs = [
      listen("code-changed", loadPair),
      listen("sms-synced", loadView),
      listen("tx-updated", loadView),
      listen("phone-paired", loadView),
    ];
    return () => subs.forEach((p) => p.then((f) => f()));
  }, []);

  // after unpair or delete, always come back to the dashboard
  useEffect(() => {
    if (view && (!view.paired || !view.onboarded)) setScreen("home");
  }, [view?.paired, view?.onboarded]);

  // countdown bar for the pairing code
  useEffect(() => {
    const t = setInterval(() => {
      if (pair)
        setLeft(Math.max(0, pair.expires_at - Math.floor(Date.now() / 1000)));
    }, 250);
    return () => clearInterval(t);
  }, [pair]);

  if (!view) return null;
  if (!view.paired) return <PairScreen pair={pair} left={left} />;
  if (!view.onboarded) return <WelcomeScreen view={view} />;
  if (screen === "settings") {
    return (
      <SettingsScreen
        view={view}
        pair={pair}
        left={left}
        onBack={() => setScreen("home")}
      />
    );
  }
  return <Dashboard view={view} onSettings={() => setScreen("settings")} />;
}
