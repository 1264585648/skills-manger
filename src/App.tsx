import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type HealthSnapshot = {
  appVersion: string;
  databaseOk: boolean;
  databasePath: string;
  logPath: string;
  counter: number;
};

type CounterSnapshot = {
  value: number;
};

type BridgeState =
  | { status: "loading" }
  | { status: "ready"; health: HealthSnapshot }
  | { status: "error"; message: string };

function formatError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

export default function App() {
  const [bridge, setBridge] = useState<BridgeState>({ status: "loading" });
  const [incrementing, setIncrementing] = useState(false);

  const loadHealth = useCallback(async () => {
    setBridge({ status: "loading" });

    try {
      const health = await invoke<HealthSnapshot>("get_health");
      setBridge({ status: "ready", health });
    } catch (error) {
      setBridge({ status: "error", message: formatError(error) });
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const incrementCounter = async () => {
    if (bridge.status !== "ready") return;

    setIncrementing(true);

    try {
      const counter = await invoke<CounterSnapshot>("increment_counter");
      setBridge({
        status: "ready",
        health: { ...bridge.health, counter: counter.value },
      });
    } catch (error) {
      setBridge({ status: "error", message: formatError(error) });
    } finally {
      setIncrementing(false);
    }
  };

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">M0 · Engineering Shell</p>
          <h1>Skills Control Center</h1>
          <p className="subtitle">
            Tauri 2 + React + TypeScript + Rust + SQLite 工程基座。
          </p>
        </div>
        <span className="version">v0.1.0</span>
      </section>

      {bridge.status === "loading" && (
        <section className="panel status-panel">
          <div className="spinner" aria-hidden="true" />
          <div>
            <strong>正在检查桌面桥接与本地数据库…</strong>
            <p>应用启动后会通过 Tauri command 调用 Rust，并读取 SQLite 状态。</p>
          </div>
        </section>
      )}

      {bridge.status === "error" && (
        <section className="panel error-panel">
          <div className="error-mark">!</div>
          <div className="error-content">
            <strong>桌面桥接暂不可用</strong>
            <p>{bridge.message}</p>
            <button type="button" onClick={() => void loadHealth()}>
              重新检测
            </button>
          </div>
        </section>
      )}

      {bridge.status === "ready" && (
        <>
          <section className="metrics">
            <article className="panel metric">
              <span className="metric-icon blue">↔</span>
              <div>
                <span>Rust Command</span>
                <strong>Connected</strong>
              </div>
              <i className="dot ok" />
            </article>
            <article className="panel metric">
              <span className="metric-icon green">DB</span>
              <div>
                <span>SQLite</span>
                <strong>{bridge.health.databaseOk ? "Ready" : "Error"}</strong>
              </div>
              <i className={`dot ${bridge.health.databaseOk ? "ok" : "bad"}`} />
            </article>
            <article className="panel metric">
              <span className="metric-icon violet">#</span>
              <div>
                <span>Persistent Counter</span>
                <strong>{bridge.health.counter}</strong>
              </div>
              <i className="dot ok" />
            </article>
          </section>

          <section className="grid">
            <article className="panel detail">
              <header>
                <div>
                  <p className="eyebrow">Runtime</p>
                  <h2>M0 验收状态</h2>
                </div>
                <span className="badge">基础能力已接通</span>
              </header>
              <dl>
                <div>
                  <dt>App Version</dt>
                  <dd>{bridge.health.appVersion}</dd>
                </div>
                <div>
                  <dt>Database</dt>
                  <dd title={bridge.health.databasePath}>
                    {bridge.health.databasePath}
                  </dd>
                </div>
                <div>
                  <dt>Local Log</dt>
                  <dd title={bridge.health.logPath}>{bridge.health.logPath}</dd>
                </div>
              </dl>
            </article>

            <article className="panel action-card">
              <p className="eyebrow">SQLite Write Test</p>
              <h2>持久化计数器</h2>
              <p>
                点击后由 React 调用 Rust command，Rust 在事务中更新 SQLite。
                重启应用后数值仍应保留。
              </p>
              <div className="counter">{bridge.health.counter}</div>
              <button
                type="button"
                disabled={incrementing}
                onClick={() => void incrementCounter()}
              >
                {incrementing ? "写入中…" : "写入 SQLite +1"}
              </button>
            </article>
          </section>
        </>
      )}

      <footer>
        当前仅验证 M0 工程能力；正式五页面 UI 将在 M1 接入。
      </footer>
    </main>
  );
}
