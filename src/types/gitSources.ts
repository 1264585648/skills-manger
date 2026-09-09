export type UpdateStatus =
  | "clean"
  | "upstream_update"
  | "local_modified"
  | "target_drift"
  | "conflict"
  | "missing";

export interface GitSourceDraft {
  url: string;
  reference: string;
  skillSubpath: string;
}

export interface SkillUpdateRecord {
  skillId: string;
  skillName: string;
  sourceId: string;
  sourceUrl: string;
  reference: string;
  baseHash: string;
  libraryHash: string | null;
  upstreamHash: string;
  upstreamRevision: string;
  status: UpdateStatus;
  checkedAt: number;
  canPromote: boolean;
}
