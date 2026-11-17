// Upstream payloads are untrusted. Identity is validated on import; domain fields
// remain unknown until their individual units, dates and relationships are checked.
export type RawRecord = Record<string, unknown> & { id: string };
export type LeadPayload = { client_id: string; data: Record<string, unknown>[] };
export type RawDataset = {
  clients: RawRecord[];
  customers: RawRecord[];
  subscriptions: RawRecord[];
  invoices: RawRecord[];
  tickets: RawRecord[];
  leads: LeadPayload[];
};
export type SnapshotMeta = {
  snapshotId: string;
  referenceAt: string;
  importedAt: string;
  lastImportStatus: "running" | "succeeded" | "failed" | null;
};
export type HorizonResult = {
  months: 3 | 6;
  retainedCount: number;
  notRetainedCount: number;
  eligibleCount: number;
  notMaturedCount: number;
  unknownStartCount: number;
  unknownOutcomeCount: number;
  estimatedDateCount: number;
  value: number | null;
  smallSample: boolean;
};
export type QualityIssue = { code: string; count: number; message: string };
export type CountShare = { code: string; label: string; count: number; share: number | null };
export type RiskSignal = {
  id: string; label: string; weight: number;
  state: "triggered" | "clear" | "unknown" | "not_applicable";
};
export type RiskClient = {
  clientId: string; businessName: string; trade: string;
  risk: number; health: number; assessed: number; applicable: number;
  reasons: string[]; signals: RiskSignal[];
};
export type LeadsTrade = {
  trade: string; value: number | null; nClients: number;
  observedClientMonths: number; eligibleClientMonths: number;
  clientsWithoutObservations: number; unknownEligibilityCount: number;
  coverage: number | null; smallSample: boolean;
};
export type EconomicsTrade = {
  trade: string; netRevenueCents: number; exposureSeconds: number;
  eligibleClientCount: number; excludedClientCount: number;
  monthlyRevenueAud: number | null; observedLtvAud: number | null;
  avgObservedMonths: number | null; activeClientCount: number;
  smallSample: boolean;
};
export type AdsComparison = {
  adoption: { enabledCount: number; eligibleCount: number; unknownCount: number; value: number | null };
  historyStatus: "verified" | "assumption_based" | "insufficient_history";
  assumptions: { id: "first_activation" | "null_means_never"; text: string }[];
  limitation: string;
  exclusions: {
    unknownStart: number; notReachedLandmark: number; unknownLandmarkState: number;
    notActiveAtLandmark: number; unknownAdHistory: number;
  };
  groups: { id: "early" | "notEarly"; label: string; count: number; horizons: HorizonResult[] }[];
  differences: { months: 3 | 6; percentagePoints: number | null }[];
};
export type DashboardData = {
  meta: SnapshotMeta & { definitionsVersion: "v5" };
  quality: { issues: QualityIssue[]; clientCount: number; customerCount: number; invoiceCount: number; ticketCount: number };
  atRisk: { total: number; eligibleCount: number; unevaluatedCount: number; rows: RiskClient[] };
  retention: {
    horizons: HorizonResult[];
    snapshot: { retainedCount: number; churnedCount: number; unknownCount: number };
    departures: { bands: CountShare[]; totalChurned: number; unknownDatesCount: number; reactivatedCount: number };
  };
  leadsByTrade: LeadsTrade[];
  economicsByTrade: EconomicsTrade[];
  ads: AdsComparison;
  cancellationReasons: { total: number; voluntaryCount: number; unknownDateCount: number; reasons: CountShare[]; voluntaryFeedback: CountShare[] };
};
