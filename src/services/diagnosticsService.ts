import { invoke } from "@tauri-apps/api/core";

export interface HealthSnapshot { appVersion: string; databaseOk: boolean; databasePath: string; logPath: string; counter: number; }

function formatError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return "Unknown desktop bridge error"; }
}

export const diagnosticsService = {
  async getHealth(): Promise<HealthSnapshot> { return invoke<HealthSnapshot>("get_health"); },
  formatError,
};
