export type SourceProviderType = "local" | "github" | "registry" | "url";

export interface SourceProvider {
  id: string;
  name: string;
  type: SourceProviderType;
  enabled: boolean;
}
