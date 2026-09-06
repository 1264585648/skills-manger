export type SkillSource =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'local';

export type SkillLifecycleStatus =
  | 'installed'
  | 'missing'
  | 'conflict'
  | 'outdated'
  | 'unmanaged';

/**
 * Canonical Library 中 Skill 的生命周期信息。
 *
 * Discovery 发现的实例不会自动变成 installed，
 * 必须经过 adopt/import 流程进入 Canonical Library。
 */
export interface SkillLifecycle {
  id: string;
  name: string;
  source: SkillSource;
  status: SkillLifecycleStatus;
  version?: string;
  checksum?: string;
  locations: string[];
  updatedAt?: string;
}

export interface SkillImportCandidate {
  path: string;
  name: string;
  source: SkillSource;
  existsInLibrary: boolean;
  conflict?: boolean;
  reason?: string;
}

export interface SkillImportPlan {
  candidates: SkillImportCandidate[];
  summary: {
    total: number;
    added: number;
    unchanged: number;
    conflicts: number;
  };
}
