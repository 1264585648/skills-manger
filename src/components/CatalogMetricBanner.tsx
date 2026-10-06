import type { WorkspaceController } from "../hooks/useWorkspace";
import { IconSkill, IconLink, IconGovernance, IconAlert } from "./icons";
import { isGoverned, needsAttention } from "../types/domain";

interface Props {
  controller: WorkspaceController;
}

export function CatalogMetricBanner({ controller }: Props) {
  const {
    entries,
    filterKey,
    setFilterKey,
    hasScriptsOnly,
    setHasScriptsOnly,
    setSortKey,
    clearAllFilters,
  } = controller;

  const total = entries.length;
  const userScope = entries.filter((e) => e.hasUserScope).length;
  const projectScope = entries.filter((e) => e.hasProjectScope).length;

  const distributedCount = entries.filter((e) => e.installedRootIds.length > 0).length;
  const coveragePercent = total > 0 ? Math.round((distributedCount / total) * 100) : 0;

  const governedCount = entries.filter(isGoverned).length;
  const governancePercent = total > 0 ? Math.round((governedCount / total) * 100) : 0;

  const attentionCount = entries.filter(needsAttention).length;
  const scriptsCount = entries.filter((e) => e.scriptCount > 0).length;
  const alertTotal = attentionCount + scriptsCount;

  return (
    <div className="catalog-metric-banner" role="region" aria-label="技能资产度量概览">
      {/* 1. 总量指标 */}
      <div
        className={`metric-card ${filterKey === "all" ? "metric-card-active" : ""}`}
        onClick={() => clearAllFilters()}
        role="button"
        tabIndex={0}
        title="点击查看全部技能"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            clearAllFilters();
          }
        }}
      >
        <div className="metric-card-head">
          <span className="metric-card-title">技能资产总数</span>
          <span className="metric-card-icon">
            <IconSkill />
          </span>
        </div>
        <div className="metric-card-val-row">
          <span className="metric-card-val metric-card-val-accent">{total}</span>
          <span className="metric-card-sub">
            {userScope} 全局 · {projectScope} 项目
          </span>
        </div>
        <div className="metric-bar-wrap">
          <div className="metric-bar-fill fill-blue" style={{ width: "100%" }} />
        </div>
      </div>

      {/* 2. 分发覆盖率 */}
      <div
        className="metric-card"
        onClick={() => setSortKey("targets-desc")}
        role="button"
        tabIndex={0}
        title="点击按分发覆盖率由高到低排序"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSortKey("targets-desc");
          }
        }}
      >
        <div className="metric-card-head">
          <span className="metric-card-title">Agent 分发覆盖率</span>
          <span className="metric-card-icon">
            <IconLink />
          </span>
        </div>
        <div className="metric-card-val-row">
          <span className="metric-card-val metric-card-val-green">{coveragePercent}%</span>
          <span className="metric-card-sub">
            {distributedCount}/{total} 已分发
          </span>
        </div>
        <div className="metric-bar-wrap">
          <div
            className="metric-bar-fill fill-green"
            style={{ width: `${Math.min(100, coveragePercent)}%` }}
          />
        </div>
      </div>

      {/* 3. 治理完成度 */}
      <div
        className={`metric-card ${filterKey === "ungoverned" ? "metric-card-active" : ""}`}
        onClick={() => setFilterKey(filterKey === "ungoverned" ? "all" : "ungoverned")}
        role="button"
        tabIndex={0}
        title="点击快速筛选未治理技能"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFilterKey(filterKey === "ungoverned" ? "all" : "ungoverned");
          }
        }}
      >
        <div className="metric-card-head">
          <span className="metric-card-title">治理达标率</span>
          <span className="metric-card-icon">
            <IconGovernance />
          </span>
        </div>
        <div className="metric-card-val-row">
          <span className="metric-card-val metric-card-val-accent">{governancePercent}%</span>
          <span className="metric-card-sub">
            {governedCount} 已治理 · {total - governedCount} 待治理
          </span>
        </div>
        <div className="metric-bar-wrap">
          <div
            className="metric-bar-fill fill-blue"
            style={{ width: `${Math.min(100, governancePercent)}%` }}
          />
        </div>
      </div>

      {/* 4. 安全与告警 */}
      <div
        className={`metric-card ${
          filterKey === "attention" || hasScriptsOnly ? "metric-card-active" : ""
        }`}
        onClick={() => {
          if (attentionCount > 0) {
            setFilterKey(filterKey === "attention" ? "all" : "attention");
          } else {
            setHasScriptsOnly(!hasScriptsOnly);
          }
        }}
        role="button"
        tabIndex={0}
        title="点击跳转需处理冲突或脚本安全筛选"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (attentionCount > 0) {
              setFilterKey(filterKey === "attention" ? "all" : "attention");
            } else {
              setHasScriptsOnly(!hasScriptsOnly);
            }
          }
        }}
      >
        <div className="metric-card-head">
          <span className="metric-card-title">安全与治理告警</span>
          <span className="metric-card-icon" style={{ color: alertTotal > 0 ? "var(--amber)" : "var(--muted)" }}>
            <IconAlert />
          </span>
        </div>
        <div className="metric-card-val-row">
          <span
            className={`metric-card-val ${
              alertTotal > 0 ? "metric-card-val-amber" : "metric-card-val-green"
            }`}
          >
            {alertTotal}
          </span>
          <span className="metric-card-sub">
            {attentionCount} 需介入 · {scriptsCount} 含脚本
          </span>
        </div>
        <div className="metric-bar-wrap">
          <div
            className={`metric-bar-fill ${alertTotal > 0 ? "fill-amber" : "fill-green"}`}
            style={{ width: total > 0 ? `${Math.min(100, (alertTotal / total) * 100)}%` : "0%" }}
          />
        </div>
      </div>
    </div>
  );
}
