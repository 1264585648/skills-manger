export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
  defaultAgents: string[];
  versionPolicy: "fixed" | "follow";
}
