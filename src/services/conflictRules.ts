export type ConflictKind =
  | "target_drift"
  | "unmanaged"
  | "destination_mismatch"
  | "unverifiable";

export const conflictKindMeta: Record<ConflictKind, { label: string; hint: string }> = {
  target_drift: {
    label: "目标漂移",
    hint: "本应用曾部署过该 Skill，但目标内容已被外部修改。直接覆盖会丢失这些改动。",
  },
  unmanaged: {
    label: "未托管内容",
    hint: "目标位置已存在同名 Skill，且不由本应用部署，写入前必须先确认归属。",
  },
  destination_mismatch: {
    label: "部署路径漂移",
    hint: "已记录的部署路径与当前 Root 不匹配，通常是 Root 目录被移动或改名。",
  },
  unverifiable: {
    label: "无法校验",
    hint: "目标目录不可读或缺少 SKILL.md，无法确定其内容，因此拒绝写入。",
  },
};

// 判定顺序有意为之：先排除"无法校验"，因为它同样可能带 Unmanaged 前缀，
// 但处置方式不同（先修复可读性，而不是先确认归属）。
export const classifyConflict = (reason: string): ConflictKind => {
  if (reason.includes("cannot be verified")) return "unverifiable";
  if (reason.includes("does not match the registered root")) return "destination_mismatch";
  if (reason.includes("Target Drift")) return "target_drift";
  if (reason.includes("Unmanaged")) return "unmanaged";
  return "unverifiable";
};

export const joinDestinationPath = (rootPath: string, skillName: string): string => {
  const normalized = rootPath.replace(/[\\/]+$/, "");
  const separator = normalized.includes("\\") ? "\\" : "/";
  return `${normalized}${separator}${skillName}`;
};

export const baseName = (path: string): string =>
  path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
