import type { AgentTargetRecord, DiscoveryRootRecord } from "./discovery";
import type { SyncPlanRecord } from "./bundlePlanner";
export interface AgentDefinition {
  id: string;
  name: string;
  provider: string;
  commands: string[];
  userRoots: string[];
  projectRoots: string[];
  docs: string;
  verifiedAt: string;
  preferredUserRoot?: string;
  preferredProjectRoot?: string | null;
}

export interface AgentPreferences {
  lastAgentId: string | null;
  scopes: Record<string, string>;
  targets: Record<string, string>;
  sorts: Record<string, string>;
}
export interface ScopeOption {
  id: string;
  name: string;
  path: string | null;
  rootIds: string[];
}
export interface TargetOption {
  id: string;
  path: string;
  source: string;
  recommended: boolean;
  affectedAgents: string[];
}
export interface ManagedSkill {
  id: string;
  name: string;
  description: string;
  state: "added" | "update" | "issue" | "unverified";
  reason: string | null;
  instanceIds: string[];
  rootIds: string[];
  paths: string[];
  resolvedPath: string;
  libraryId: string | null;
  readonly: boolean;
  linked: boolean;
  canUpdate: boolean;
  canImport: boolean;
  localModified: boolean;
  diagnostics: Diagnostic[];
  modifiedAt: number | null;
}
export interface ManagementView {
  agentId: string;
  scopeId: string;
  scopeAvailable?:boolean;
  scopes: ScopeOption[];
  targets: TargetOption[];
  targetId: string | null;
  skills: ManagedSkill[];
  checkedAt: number;
}
export interface AgentImportPreview {
  id: string;
  path: string;
  name: string;
  description: string;
  fingerprint: string;
  changes: string[];
}
export interface AgentNavigationContext {
  agentId?: string;
  scopeId?: string;
  skillIds?: string[];
  managedIds?: string[];
  rootId?: string;
  bundleId?: string;
  openAdd?: boolean;
  openHistory?: boolean;
  requestId?: number;
}
export interface Diagnostic {
  code: string;
  severity: string;
  path: string;
  message: string;
  suggestion: string;
}
export interface Detection {
  status: string;
  evidence: string[];
  diagnostics: Diagnostic[];
}
export interface RootInfo {
  id: string;
  source: string;
  status: string;
  writable: boolean;
  areaId: string | null;
  scannedAt: number | null;
  diagnostics: Diagnostic[];
}
export interface AgentSkill {
  id: string;
  agentId: string;
  rootId: string;
  path: string;
  resolvedPath: string;
  name: string;
  description: string;
  status: string;
  linked: boolean;
  diagnostics: Diagnostic[];
  modifiedAt: number | null;
}
export interface ProjectArea {
  id: string;
  path: string;
  maxDepth: number;
  enabled: boolean;
}
export interface ScanStatus {
  running: boolean;
  cancelled: boolean;
  completed: number;
  total: number;
  current: string;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}
export interface AgentCenterSnapshot {
  catalog: AgentDefinition[];
  agents: AgentTargetRecord[];
  detections: Record<string, Detection>;
  roots: DiscoveryRootRecord[];
  rootDetails: Record<string, RootInfo>;
  skills: AgentSkill[];
  projects: ProjectArea[];
  projectDiagnostics: Record<string, Diagnostic[]>;
  scan: ScanStatus;
}
export interface AgentInstallPlan extends SyncPlanRecord {
  selection: string[] | null;
  overwrite: boolean;
  rootPath: string;
  affectedAgents: string[];
}
export const visibleSkills = (
  snapshot: AgentCenterSnapshot,
  agentId?: string,
) =>
  snapshot.skills.filter(
    (s) => s.status !== "missing" && (!agentId || s.agentId === agentId),
  );
export const uniqueSkillCount = (skills: AgentSkill[]) =>
  new Set(
    skills
      .filter((s) => s.status !== "missing")
      .map((s) => s.resolvedPath.replace(/\\/g, "/").toLowerCase()),
  ).size;
export function diagnosticsFor(
  snapshot: AgentCenterSnapshot,
  agentId: string,
): Diagnostic[] {
  return [
    ...(snapshot.detections[agentId]?.diagnostics ?? []),
    ...snapshot.roots
      .filter((r) => r.agentId === agentId)
      .flatMap((r) => snapshot.rootDetails[r.id]?.diagnostics ?? []),
    ...visibleSkills(snapshot, agentId).flatMap((s) => s.diagnostics),
  ];
}
