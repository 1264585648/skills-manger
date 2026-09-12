import { useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { AgentCenterSnapshot } from "../../types/agentCenter";
import { ProductIcon } from "../AgentCenterWidgets";

export function AgentSelector({
  snapshot,
  value,
  onChange,
}: {
  snapshot: AgentCenterSnapshot;
  value: string;
  onChange: (id: string) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const current = snapshot.catalog.find((a) => a.id === value);
  const installed = (id: string) =>
    snapshot.detections[id]?.status === "installed";
  const local = (id: string) =>
    installed(id) ||
    snapshot.roots.some((r) => r.agentId === id && r.canonicalPath);
  const candidates = snapshot.catalog.filter((a) =>
    `${a.name} ${a.provider}`.toLowerCase().includes(query.toLowerCase()),
  );
  const render = (isLocal: boolean) =>
    candidates
      .filter((a) => local(a.id) === isLocal)
      .map((agent) => (
        <button
          role="option"
          aria-selected={agent.id === value}
          key={agent.id}
          onClick={() => {
            onChange(agent.id);
            if (ref.current) ref.current.open = false;
            setQuery("");
            ref.current?.querySelector("summary")?.focus();
          }}
        >
          <ProductIcon id={agent.id} />
          <span>
            <strong>{agent.name}</strong>
            <small>
              {installed(agent.id)
                ? "已检测到安装"
                : local(agent.id)
                  ? "仅发现配置"
                  : "未检测到安装"}
            </small>
          </span>
          {agent.id === value ? <span className="ux-selected-dot" /> : null}
        </button>
      ));
  return (
    <details
      className="ux-agent-picker"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const choices = [
            ...(ref.current?.querySelectorAll<HTMLButtonElement>(
              'button[role="option"]',
            ) ?? []),
          ];
          if (choices.length) {
            e.preventDefault();
            const i = choices.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            choices[
              (i + (e.key === "ArrowDown" ? 1 : -1) + choices.length) %
                choices.length
            ].focus();
          }
        }
      }}
    >
      <summary aria-label="切换 Agent">
        <ProductIcon id={value} />
        <h1>{current?.name ?? "选择 Agent"}</h1>
        <ChevronDown size={17} />
      </summary>
      <div className="ux-agent-options">
        <label className="ux-search">
          <Search size={16} />
          <input
            aria-label="搜索 Agent"
            placeholder="搜索 Agent"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div role="listbox" aria-label="Agent 列表">
          <span className="ux-group-label">本机 Agent</span>
          {render(true)}
          <details open={!!query}>
            <summary>其他支持的 Agent</summary>
            {render(false)}
          </details>
          {!candidates.length ? (
            <p className="ux-muted">没有匹配的 Agent</p>
          ) : null}
        </div>
      </div>
    </details>
  );
}
