import { useCallback, useEffect, useMemo, useState } from "react";
import { workspaceService } from "../services/workspaceService";
import { fuzzyScore } from "../services/fuzzyMatch";
import type { PageKey } from "../types/domain";

const pages: Array<{ id: PageKey; label: string; hint: string }> = [
  { id: "home", label: "概览", hint: "环境总览与待处理项" },
  { id: "skills", label: "Skills", hint: "技能库与发现的实例" },
  { id: "bundles", label: "工作流", hint: "Bundle 编排" },
  { id: "agents", label: "Agents", hint: "Agent 与 Root" },
  { id: "sync", label: "环境更新", hint: "生成计划并安全应用" },
  { id: "settings", label: "设置", hint: "来源、发现目录、安全边界" },
];

type Entry = {
  id: string;
  group: "页面" | "Skill" | "Bundle" | "Agent";
  label: string;
  hint: string;
  page: PageKey;
  keywords: string;
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (page: PageKey) => void;
}

export function CommandPalette({ open, onOpenChange, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);

  const loadEntries = useCallback(async (): Promise<void> => {
    const [skills, bundles, agents] = await Promise.all([
      workspaceService.getSkills().catch(() => []),
      workspaceService.getBundles().catch(() => []),
      workspaceService.getAgents().catch(() => []),
    ]);
    setEntries([
      ...pages.map((page) => ({
        id: `page:${page.id}`,
        group: "页面" as const,
        label: page.label,
        hint: page.hint,
        page: page.id,
        keywords: `${page.label} ${page.id}`,
      })),
      ...skills.map((skill) => ({
        id: `skill:${skill.id}`,
        group: "Skill" as const,
        label: skill.name,
        hint: `技能库 · ${skill.source}`,
        page: "skills" as const,
        keywords: `${skill.name} ${skill.description} ${skill.source}`,
      })),
      ...bundles.map((bundle) => ({
        id: `bundle:${bundle.id}`,
        group: "Bundle" as const,
        label: bundle.name,
        hint: `${bundle.skillIds.length} 个 Skill`,
        page: "bundles" as const,
        keywords: `${bundle.name} ${bundle.description}`,
      })),
      ...agents.map((agent) => ({
        id: `agent:${agent.id}`,
        group: "Agent" as const,
        label: agent.name,
        hint: agent.path,
        page: "agents" as const,
        keywords: `${agent.name} ${agent.type}`,
      })),
    ]);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
        setQuery("");
        setActiveIndex(0);
      } else if (event.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    void loadEntries();
  }, [open, loadEntries]);

  const results = useMemo(() => {
    if (!query.trim()) return entries.slice(0, 12);
    return entries
      .map((entry) => ({ entry, score: fuzzyScore(query.trim(), `${entry.label} ${entry.keywords}`) }))
      .filter((item): item is { entry: Entry; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((item) => item.entry);
  }, [entries, query]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  if (!open) return null;

  const commit = (entry: Entry | undefined): void => {
    if (!entry) return;
    onNavigate(entry.page);
    onOpenChange(false);
  };

  return (
    <div className="palette-backdrop" role="presentation" onClick={() => onOpenChange(false)}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          className="palette-input"
          autoFocus
          value={query}
          placeholder="搜索页面、Skill、Bundle、Agent…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length));
            } else if (event.key === "Enter") {
              event.preventDefault();
              commit(results[activeIndex]);
            }
          }}
        />
        <div className="palette-results">
          {results.length === 0 ? (
            <p className="palette-empty">没有匹配项</p>
          ) : (
            results.map((entry, index) => (
              <button
                type="button"
                key={entry.id}
                className={index === activeIndex ? "palette-row active" : "palette-row"}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(entry)}
              >
                <span className="palette-group">{entry.group}</span>
                <span className="palette-label">{entry.label}</span>
                <span className="palette-hint">{entry.hint}</span>
              </button>
            ))
          )}
        </div>
        <div className="palette-footer">
          <span>↑↓ 选择 · Enter 跳转 · Esc 关闭</span>
          <span>Cmd/Ctrl + K 唤起</span>
        </div>
      </div>
    </div>
  );
}
