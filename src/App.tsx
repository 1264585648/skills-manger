import { useState } from "react";
import { AppShell } from "./layout/AppShell";
import { AgentsPage } from "./pages/AgentsPage";
import { BundlesPage } from "./pages/BundlesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { SyncPage } from "./pages/SyncPage";
import type { PageKey } from "./types/domain";

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("skills");
  return <AppShell activePage={activePage} onNavigate={setActivePage}>{activePage === "skills" ? <SkillsPage /> : null}{activePage === "bundles" ? <BundlesPage /> : null}{activePage === "agents" ? <AgentsPage /> : null}{activePage === "sync" ? <SyncPage /> : null}{activePage === "settings" ? <SettingsPage /> : null}</AppShell>;
}
