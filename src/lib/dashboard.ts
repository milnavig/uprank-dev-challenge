import { computeDashboard } from "./domain";
import { loadLatestSnapshot, StoreError } from "./store";
import type { DashboardData } from "./contracts";

export class DashboardUnavailable extends Error {
  constructor(public readonly code: "data_unavailable" | "configuration_error" | "internal_error", message: string) {
    super(message);
    this.name = "DashboardUnavailable";
  }
}

export async function getDashboard(): Promise<DashboardData> {
  try {
    const snapshot = await loadLatestSnapshot();
    return computeDashboard(snapshot.data, snapshot.meta);
  } catch (error) {
    if (error instanceof StoreError) {
      throw new DashboardUnavailable(
        error.code === "configuration_error" ? "configuration_error" : "data_unavailable",
        error.message,
      );
    }
    // Provider errors and connection strings must never cross the UI boundary.
    throw new DashboardUnavailable("internal_error", "The dashboard could not be prepared. Check the local setup and try again.");
  }
}
