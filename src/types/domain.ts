export type PageKey = "discover" | "govern" | "writeback";

/** A discovered skill with its governance metadata joined in for display. */
export interface GovernedSkill {
  instance: import("./discovery").SkillInstanceRecord;
  note: string;
  groupId: string | null;
  groupName: string | null;
  tagIds: string[];
  tagNames: string[];
}

/** Strip the Windows \\?\ verbatim prefix for display. */
export const displayPath = (path: string): string =>
  path.startsWith("\\\\?\\") ? path.slice(4) : path;

/** Short, copy-friendly form of a content hash. */
export const shortHash = (hash: string): string =>
  hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
