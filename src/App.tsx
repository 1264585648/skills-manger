import { useState } from "react";
import { AppShell } from "./layout/AppShell";
import { DiscoverPage } from "./pages/DiscoverPage";
import { GovernPage } from "./pages/GovernPage";
import { WriteBackPage } from "./pages/WriteBackPage";
import type { PageKey } from "./types/domain";

const initialPage = (): PageKey => {
  if (typeof window === "undefined") return "discover";
  const requested = new URLSearchParams(window.location.search).get("page");
  return requested === "govern" || requested === "writeback" ? requested : "discover";
};

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>(initialPage);

  return (
    <AppShell activePage={activePage} onNavigate={setActivePage}>
      {activePage === "discover" ? (
        <DiscoverPage onGovern={() => setActivePage("govern")} />
      ) : null}
      {activePage === "govern" ? (
        <GovernPage onWriteBack={() => setActivePage("writeback")} />
      ) : null}
      {activePage === "writeback" ? <WriteBackPage /> : null}
    </AppShell>
  );
}
