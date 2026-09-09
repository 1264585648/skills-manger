import { useState } from "react";
import { AppShell } from "./layout/AppShell";
import { AgentsPage } from "./pages/AgentsPage";
import { BundlesPage } from "./pages/BundlesPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { SyncPage } from "./pages/SyncPage";
import type { PageKey } from "./types/domain";

interface NavigationParams {
  bundleId?: string;
}

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [syncBundleId, setSyncBundleId] = useState<string | null>(null);

  const navigate = (page: PageKey, params?: NavigationParams): void => {
    if (params?.bundleId !== undefined) setSyncBundleId(params.bundleId);
    setActivePage(page);
  };

  return (
    <AppShell activePage={activePage} onNavigate={navigate}>
      {activePage === "home" ? <HomePage onNavigate={navigate} /> : null}
      {activePage === "skills" ? <SkillsPage /> : null}
      {activePage === "bundles" ? <BundlesPage onNavigateToSync={(bundleId) => navigate("sync", { bundleId })} /> : null}
      {activePage === "agents" ? <AgentsPage /> : null}
      {activePage === "sync" ? <SyncPage key={syncBundleId ?? "sync"} initialBundleId={syncBundleId} /> : null}
      {activePage === "settings" ? <SettingsPage /> : null}
    </AppShell>
  );
}
