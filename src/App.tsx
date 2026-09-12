import { useState } from "react";
import { AppShell } from "./layout/AppShell";
import { AgentsPage } from "./pages/AgentsPage";
import { BundlesPage } from "./pages/BundlesPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { SyncPage } from "./pages/SyncPage";
import type { PageKey } from "./types/domain";
import type { AgentNavigationContext } from "./types/agentCenter";

type NavigationParams = AgentNavigationContext;

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>(() =>
    new URLSearchParams(window.location.search).get("page") === "agents" ? "agents" : "home",
  );
  const [syncBundleId, setSyncBundleId] = useState<string | null>(null);
  const [agentContext,setAgentContext]=useState<AgentNavigationContext>(()=>{const params=new URLSearchParams(window.location.search);return {agentId:params.get("agentId")??undefined,scopeId:params.get("scopeId")??undefined};});
  const [syncContext,setSyncContext]=useState<AgentNavigationContext|undefined>();

  const navigate = (page: PageKey, params?: NavigationParams): void => {
    if (params?.bundleId !== undefined) setSyncBundleId(params.bundleId);
    if(page==="agents"&&params)setAgentContext({...params,requestId:Date.now()});
    if(page==="sync")setSyncContext(params?{...params,requestId:Date.now()}:undefined);
    setActivePage(page);
  };

  return (
    <AppShell activePage={activePage} onNavigate={navigate}>
      {activePage === "home" ? <HomePage onNavigate={navigate} /> : null}
      {activePage === "skills" ? <SkillsPage onAddToAgent={skillIds=>navigate("agents",{skillIds,openAdd:true})}/> : null}
      {activePage === "bundles" ? <BundlesPage onNavigateToSync={(bundleId) => navigate("sync", { bundleId })} onAddToAgent={bundleId=>navigate("agents",{bundleId,openAdd:true})}/> : null}
      {activePage === "agents" ? <AgentsPage key={agentContext.requestId} initialContext={agentContext} onNavigateToSync={context=>navigate("sync",context)}/> : null}
      {activePage === "sync" ? <SyncPage key={syncContext?.requestId??syncBundleId??"sync"} initialBundleId={syncBundleId} initialContext={syncContext} onReturnToAgent={()=>navigate("agents",{agentId:syncContext?.agentId,scopeId:syncContext?.scopeId})}/> : null}
      {activePage === "settings" ? <SettingsPage /> : null}
    </AppShell>
  );
}
