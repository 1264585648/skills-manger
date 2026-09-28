import { useCallback, useRef } from "react";

export interface SingleFlightControls<Args extends unknown[]> {
  /** 已有任务在飞就复用它：给挂载时加载用，避免 StrictMode 把全量扫描跑两遍。 */
  loadOnce: (...args: Args) => Promise<void>;
  /** 一定拿到最新数据：等当前任务收尾后再跑一遍，给「重新扫描」和写操作之后用。 */
  reload: (...args: Args) => Promise<void>;
}

/**
 * 同一时刻只允许一个加载任务在飞。
 *
 * 全量扫描要读遍所有 Agent 目录（本机约 30s），StrictMode 的双挂载会让用户白等一倍时间，
 * 连点「重新扫描」同理。写操作之后的刷新则必须真跑一次，否则复用的旧结果会覆盖刚保存的数据。
 */
export function useSingleFlight<Args extends unknown[]>(
  run: (...args: Args) => Promise<void>,
): SingleFlightControls<Args> {
  const inFlight = useRef<Promise<void> | null>(null);
  const pendingReload = useRef<{
    promise: Promise<void>;
    args: Args;
  } | null>(null);

  const start = useCallback(
    (...args: Args) => {
      const task = run(...args);
      inFlight.current = task;
      void task.finally(() => {
        if (inFlight.current === task) inFlight.current = null;
      });
      return task;
    },
    [run],
  );

  const loadOnce = useCallback(
    (...args: Args) => inFlight.current ?? start(...args),
    [start],
  );

  const reload = useCallback(
    async (...args: Args) => {
      if (!inFlight.current) {
        return start(...args);
      }

      if (pendingReload.current) {
        pendingReload.current.args = args;
        return pendingReload.current.promise;
      }

      const queued = (async () => {
        try {
          await inFlight.current;
        } catch {
          // ignore previous run errors
        } finally {
          pendingReload.current = null;
        }
        return start(...args);
      })();

      pendingReload.current = { promise: queued, args };
      return queued;
    },
    [start],
  );

  return { loadOnce, reload };
}
