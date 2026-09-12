import { useCallback, useEffect, useRef, useState } from "react";
import {
  agentCenterService as service,
  commandMessage,
} from "../../services/agentCenterService";
import {
  initialAgent,
  LatestRequest,
} from "../../services/agentWorkspaceState";
import type {
  AgentCenterSnapshot,
  AgentPreferences,
  ManagementView,
  AgentNavigationContext,
} from "../../types/agentCenter";
let preferenceQueue: Promise<unknown> = Promise.resolve();
const emptyPreferences: AgentPreferences = {
  lastAgentId: null,
  scopes: {},
  targets: {},
  sorts: {},
};
export function useAgentWorkspace(context?: AgentNavigationContext) {
  const [snapshot, setSnapshot] = useState<AgentCenterSnapshot | null>(null),
    [prefs, setPrefs] = useState(emptyPreferences),
    [agentId, setAgent] = useState(""),
    [scopeId, setScope] = useState("user"),
    [view, setView] = useState<ManagementView | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const alive = useRef(true),
    preferences = useRef(prefs),
    requests = useRef(new LatestRequest());
  const currentContext = useRef({ agentId, scopeId });
  currentContext.current = { agentId, scopeId };
  const reloadView = useCallback(async () => {
    if (
      !agentId ||
      currentContext.current.agentId !== agentId ||
      currentContext.current.scopeId !== scopeId
    )
      return;
    const id = requests.current.next();
    const relevant = () =>
      alive.current &&
      requests.current.current(id) &&
      currentContext.current.agentId === agentId &&
      currentContext.current.scopeId === scopeId;
    setLoading(true);
    try {
      const value = await service.management(agentId, scopeId);
      if (relevant()) {
        setView(value);
        setError(null);
      }
    } catch (e) {
      if (relevant()) setError(commandMessage(e));
      throw e;
    } finally {
      if (relevant()) setLoading(false);
    }
  }, [agentId, scopeId]);
  useEffect(() => {
    let active = true;
    alive.current = true;
    void Promise.all([
      service.snapshot(),
      preferenceQueue.catch(() => {}).then(() => service.preferences()),
    ])
      .then(([base, saved]) => {
        if (!active || !alive.current) return;
        const requestedRoot = base.roots.find((r) => r.id === context?.rootId);
        const id = initialAgent(
          base,
          saved,
          context?.agentId ?? requestedRoot?.agentId,
        );
        const scope = context?.scopeId ?? saved.scopes[id] ?? "user";
        const next = base.catalog.some((a) => a.id === id)
          ? {
              ...saved,
              lastAgentId: id,
              scopes: { ...saved.scopes, [id]: scope },
            }
          : saved;
        setSnapshot(base);
        setPrefs(next);
        preferences.current = next;
        setAgent(id);
        setScope(scope);
        if (JSON.stringify(next) !== JSON.stringify(saved)) {
          preferenceQueue = preferenceQueue
            .catch(() => {})
            .then(() => service.savePreferences(next));
          void preferenceQueue.catch(
            (e) =>
              alive.current && setError(`偏好保存失败：${commandMessage(e)}`),
          );
        }
      })
      .catch((e) => {
        if (active && alive.current) {
          setError(commandMessage(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      alive.current = false;
      requests.current.invalidate();
    };
  }, []);
  useEffect(() => {
    if (agentId) void reloadView().catch(() => {});
  }, [reloadView]);
  useEffect(() => {
    if (!snapshot?.scan.running) return;
    let live = true,
      inflight = false;
    const timer = setInterval(() => {
      if (inflight) return;
      inflight = true;
      void service
        .snapshot()
        .then((value) => {
          if (!live) return;
          setSnapshot(value);
          if (!value.scan.running) void reloadView().catch(() => {});
        })
        .catch((e) => live && setError(commandMessage(e)))
        .finally(() => {
          inflight = false;
        });
    }, 700);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [snapshot?.scan.running, reloadView]);
  const persist = async (
    update: (current: AgentPreferences) => AgentPreferences,
  ) => {
    const next = update(preferences.current);
    preferences.current = next;
    setPrefs(next);
    preferenceQueue = preferenceQueue
      .catch(() => {})
      .then(() => service.savePreferences(next));
    try {
      await preferenceQueue;
    } catch (e) {
      if (alive.current) setError(`偏好保存失败：${commandMessage(e)}`);
      throw e;
    }
  };
  const chooseAgent = (id: string) => {
    if (id === agentId) return;
    setLoading(true);
    setAgent(id);
    const scope = preferences.current.scopes[id] ?? "user";
    setScope(scope);
    void persist((p) => ({ ...p, lastAgentId: id })).catch(() => {});
  };
  const chooseScope = (id: string) => {
    if (id === scopeId) return;
    setLoading(true);
    setScope(id);
    void persist((p) => ({
      ...p,
      scopes: { ...p.scopes, [agentId]: id },
    })).catch(() => {});
  };
  const reload = async () => {
    const base = await service.snapshot();
    if (alive.current) setSnapshot(base);
    await reloadView();
  };
  const scan = async (rootId?: string) => {
    await service.scan(rootId ? undefined : agentId, rootId);
    await reload();
  };
  const rememberTarget = async (id: string) => {
    const available = await service.management(agentId, scopeId);
    const targetScope = available.scopes.find((s) => s.rootIds.includes(id));
    if (!targetScope) throw new Error("该位置不属于当前 Agent，请重新选择");
    await persist((p) => ({
      ...p,
      scopes: { ...p.scopes, [agentId]: targetScope.id },
      targets: { ...p.targets, [`${agentId}:${targetScope.id}`]: id },
    }));
    if (
      currentContext.current.agentId !== agentId ||
      currentContext.current.scopeId !== scopeId
    )
      return;
    if (targetScope.id === scopeId) await reloadView();
    else setScope(targetScope.id);
  };
  const pickProject = async (path: string) => {
    const root = await service.preferredRoot(agentId, path);
    const base = await service.management(agentId, "user");
    const scope = base.scopes.find((s) => s.rootIds.includes(root.id));
    if (scope) {
      setScope(scope.id);
      await persist((p) => ({
        ...p,
        scopes: { ...p.scopes, [agentId]: scope.id },
        targets: { ...p.targets, [`${agentId}:${scope.id}`]: root.id },
      }));
    }
    const next = await service.snapshot();
    if (alive.current) setSnapshot(next);
    await service.scan(undefined, root.id);
  };
  return {
    snapshot,
    prefs,
    agentId,
    scopeId,
    view: view?.agentId === agentId && view.scopeId === scopeId ? view : null,
    loading,
    error,
    setError,
    chooseAgent,
    chooseScope,
    reload,
    reloadView,
    scan,
    rememberTarget,
    pickProject,
    persist,
  };
}
