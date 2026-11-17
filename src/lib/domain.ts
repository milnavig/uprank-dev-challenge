import type {
  AdsComparison, CountShare, DashboardData, EconomicsTrade, HorizonResult,
  LeadsTrade, QualityIssue, RawDataset, RawRecord, RiskClient, RiskSignal, SnapshotMeta,
} from "./contracts";

const DAY = 86400;
const MONTH = 2629800;
type State = true | false | null;
type Interval = { start: number; end: number };
type Subscription = {
  id: string; customer: string | null; start: number | null; end: number | null;
  status: string | null; valid: boolean; estimated: boolean; raw: RawRecord;
};
type Client = {
  id: string; name: string; trade: string; raw: RawRecord; customer: string | null;
  billingKnown: boolean; subscriptions: Subscription[]; first: number | null;
  status: "retained" | "churned" | "unknown"; complete: boolean; estimated: boolean;
  intervals: Interval[]; liveAt: number | null; leads: Map<string, number | null>;
};
type Issue = (code: string, message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function identity(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value === value.trim() ? value : null;
}
function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function timestamp(value: unknown): number | null {
  const number = integer(value);
  return number !== null && number <= 253402300799 ? number : null;
}
function iso(value: unknown, dateOnly = false): number | null {
  if (typeof value !== "string") return null;
  const pattern = dateOnly
    ? /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!pattern.test(value)) return null;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  if (value.length > 10 && (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59)) return null;
  const result = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value) / 1000;
  return Number.isFinite(result) ? result : null;
}
function priorIso(value: unknown, at: number): number | null {
  const date = iso(value);
  return date !== null && date <= at ? date : null;
}
function addMonths(start: number, months: number): number {
  const source = new Date(start * 1000);
  const target = new Date(start * 1000);
  target.setUTCDate(1);
  target.setUTCMonth(source.getUTCMonth() + months);
  target.setUTCDate(Math.min(source.getUTCDate(), new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()));
  return target.getTime() / 1000;
}
function union(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = result[result.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function unique(records: RawRecord[]): RawRecord[] {
  const result = new Map<string, RawRecord>();
  for (const record of records) {
    if (!identity(record.id)) throw new Error("Invalid source identity; snapshot cannot be calculated.");
    const previous = result.get(record.id);
    if (previous && canonical(previous) !== canonical(record)) throw new Error("Conflicting duplicate source identity; snapshot cannot be calculated.");
    result.set(record.id, record);
  }
  return [...result.values()];
}
function normalizeSubscription(raw: RawRecord, at: number, issue: Issue): Subscription {
  const fallbackStart = raw.start_date === null || raw.start_date === undefined;
  const start = timestamp(fallbackStart ? raw.created : raw.start_date);
  const status = text(raw.status);
  let end: number | null = null;
  let estimated = fallbackStart && start !== null;
  let valid = start !== null;
  if (status === "canceled") {
    const fallbackEnd = raw.ended_at === null || raw.ended_at === undefined;
    end = timestamp(fallbackEnd ? raw.canceled_at : raw.ended_at);
    estimated ||= fallbackEnd && end !== null;
    if (end !== null && end > at) valid = false;
  } else if (status === "active" || status === "past_due") {
    if (raw.ended_at === null || raw.ended_at === undefined) end = Infinity;
    else {
      end = timestamp(raw.ended_at);
      if (end === null || end <= at) valid = false;
    }
  } else valid = false;
  if (start !== null && end !== null && end < start) valid = false;
  if (!valid || end === null) issue("incomplete_subscription_history", "Some subscription boundaries or statuses are incomplete or contradictory; dependent metrics exclude them.");
  if (estimated) issue("estimated_subscription_date", "A subscription uses created or canceled_at as an estimated boundary.");
  return { id: raw.id, customer: identity(raw.customer), start, end, status, valid, estimated, raw };
}
function stateAt(client: Client, at: number): State {
  if (!client.billingKnown) return null;
  let unknown = false;
  for (const sub of client.subscriptions) {
    if (sub.start !== null && sub.start > at) continue;
    if (!sub.valid || sub.start === null || sub.end === null) unknown = true;
    else if (sub.start <= at && at < sub.end) return true;
  }
  return unknown ? null : false;
}
function horizon(clients: Client[], months: 3 | 6, at: number): HorizonResult {
  const result: HorizonResult = { months, retainedCount: 0, notRetainedCount: 0, eligibleCount: 0, notMaturedCount: 0, unknownStartCount: 0, unknownOutcomeCount: 0, estimatedDateCount: 0, value: null, smallSample: true };
  for (const client of clients) {
    if (client.first === null) { result.unknownStartCount++; continue; }
    const target = addMonths(client.first, months);
    if (target > at) { result.notMaturedCount++; continue; }
    const state = stateAt(client, target);
    if (state === null) { result.unknownOutcomeCount++; continue; }
    if (state) result.retainedCount++;
    else result.notRetainedCount++;
    if (client.estimated) result.estimatedDateCount++;
  }
  result.eligibleCount = result.retainedCount + result.notRetainedCount;
  result.value = result.eligibleCount ? result.retainedCount / result.eligibleCount : null;
  result.smallSample = result.eligibleCount < 5;
  return result;
}
function monthEligibility(client: Client, start: number): State {
  if (client.liveAt === null) return client.raw.status === "onboarding" && object(client.raw.onboarding).live_at === null ? false : null;
  if (client.liveAt > start) return false;
  const end = addMonths(start, 1);
  if (client.intervals.some(interval => interval.start <= start && interval.end >= end)) return true;
  return client.complete ? false : null;
}
function monthKey(start: number): string { return new Date(start * 1000).toISOString().slice(0, 7); }
function countShares(counts: Map<string, number>, labels: Record<string, string>, denominator: number): CountShare[] {
  return [...counts].map(([code, count]) => ({ code, label: labels[code] ?? code.replaceAll("_", " "), count, share: denominator ? count / denominator : null })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
function increment(counts: Map<string, number>, code: string) { counts.set(code, (counts.get(code) ?? 0) + 1); }

function computeLeads(clients: Client[], months: number[]): LeadsTrade[] {
  const trades = new Map<string, Client[]>();
  for (const client of clients) trades.set(client.trade, [...(trades.get(client.trade) ?? []), client]);
  return [...trades].map(([trade, members]) => {
    let eligibleClientMonths = 0, observedClientMonths = 0, clientsWithoutObservations = 0, unknownEligibilityCount = 0;
    const means: number[] = [];
    for (const client of members) {
      const observations: number[] = [];
      let unknown = false;
      for (const start of months) {
        const eligibility = monthEligibility(client, start);
        if (eligibility === null) unknown = true;
        if (eligibility !== true) continue;
        eligibleClientMonths++;
        const observation = client.leads.get(monthKey(start));
        if (typeof observation === "number") { observations.push(observation); observedClientMonths++; }
      }
      if (unknown) unknownEligibilityCount++;
      if (observations.length) means.push(observations.reduce((sum, n) => sum + n, 0) / observations.length);
      else clientsWithoutObservations++;
    }
    const coverage = eligibleClientMonths ? observedClientMonths / eligibleClientMonths : null;
    return { trade, value: means.length ? means.reduce((sum, mean) => sum + mean, 0) / means.length : null, nClients: means.length, observedClientMonths, eligibleClientMonths, clientsWithoutObservations, unknownEligibilityCount, coverage, smallSample: means.length < 5 || observedClientMonths < 10 || coverage === null || coverage < 0.8 };
  }).sort((a, b) => a.trade.localeCompare(b.trade));
}

function computeEconomics(clients: Client[], invoices: RawRecord[], subscriptions: Subscription[], at: number, issue: Issue): EconomicsTrade[] {
  const byId = new Map(subscriptions.map(sub => [sub.id, sub]));
  const incompleteCustomers = new Set<string>();
  const cash = new Map<string, number>();
  for (const invoice of invoices) {
    const owner = identity(invoice.customer), sub = byId.get(identity(invoice.subscription) ?? "");
    const subOwner = sub?.customer;
    if (owner && subOwner && owner !== subOwner) {
      incompleteCustomers.add(owner); incompleteCustomers.add(subOwner);
      issue("invoice_ownership_conflict", "Invoice and subscription customer IDs conflict; both customers are excluded from revenue and LTV.");
      continue;
    }
    if (invoice.status !== "paid") {
      if (!["open", "void", "uncollectible"].includes(String(invoice.status))) {
        if (owner) incompleteCustomers.add(owner);
        issue("unknown_invoice_status", "An invoice has an unknown payment status; dependent cash history is incomplete.");
      }
      continue;
    }
    const paidAt = timestamp(object(invoice.status_transitions).paid_at);
    const amount = integer(invoice.amount_paid), refund = integer(invoice.post_payment_credit_notes_amount);
    const valid = owner && sub && sub.customer === owner && sub.start !== null && sub.start < at
      && paidAt !== null && paidAt < at && paidAt >= sub.start && amount !== null && refund !== null
      && refund <= amount && text(invoice.currency)?.toLowerCase() === "aud";
    if (!valid) {
      if (owner) incompleteCustomers.add(owner);
      if (subOwner) incompleteCustomers.add(subOwner);
      issue("incomplete_cash_history", "Paid invoice date, amount, AUD currency or subscription relationship is invalid; its client is excluded from both monetary means.");
      continue;
    }
    // All operands were checked independently above; no source coercion enters cash arithmetic.
    if (owner !== null && amount !== null && refund !== null) cash.set(owner, (cash.get(owner) ?? 0) + amount - refund);
  }
  const result = new Map<string, EconomicsTrade>();
  for (const client of clients) {
    const group = result.get(client.trade) ?? { trade: client.trade, netRevenueCents: 0, exposureSeconds: 0, eligibleClientCount: 0, excludedClientCount: 0, monthlyRevenueAud: null, observedLtvAud: null, avgObservedMonths: null, activeClientCount: 0, smallSample: true };
    const exposure = client.intervals.reduce((sum, interval) => sum + Math.max(0, Math.min(at, interval.end) - interval.start), 0);
    const net = client.customer ? cash.get(client.customer) ?? 0 : 0;
    if (!client.complete || !client.customer || incompleteCustomers.has(client.customer) || exposure < MONTH || !Number.isSafeInteger(net)) {
      group.excludedClientCount++;
      if (client.complete && exposure < MONTH) issue("short_economic_history", "A client has less than 30.4375 days of observed service and is excluded from revenue and LTV.");
    } else {
      group.eligibleClientCount++; group.netRevenueCents += net; group.exposureSeconds += exposure;
      if (client.status === "retained") group.activeClientCount++;
    }
    result.set(client.trade, group);
  }
  return [...result.values()].map(group => {
    const n = group.eligibleClientCount;
    if (n) {
      group.avgObservedMonths = group.exposureSeconds / MONTH / n;
      group.monthlyRevenueAud = group.netRevenueCents / 100 / (group.exposureSeconds / MONTH);
      group.observedLtvAud = group.netRevenueCents / 100 / n;
    }
    group.smallSample = n < 5;
    return group;
  }).sort((a, b) => a.trade.localeCompare(b.trade));
}

function computeRisk(clients: Client[], tickets: RawRecord[], invoices: RawRecord[], at: number, months: number[], issue: Issue): DashboardData["atRisk"] {
  const result: DashboardData["atRisk"] = { total: 0, eligibleCount: 0, unevaluatedCount: 0, rows: [] };
  const currentStart = at - 30 * DAY, previousStart = at - 60 * DAY;
  const currentMonth = months[2], previousMonth = months[1];
  for (const client of clients) {
    if (!["live", "onboarding"].includes(String(client.raw.status)) || client.status === "churned") continue;
    result.eligibleCount++;
    const signals: RiskSignal[] = [], reasons: string[] = [];
    function signal(id: string, label: string, weight: number, state: RiskSignal["state"], reason?: string) {
      signals.push({ id, label, weight, state });
      if (state === "triggered" && reason) reasons.push(reason);
    }
    const isLive = client.raw.status === "live";
    const eligibleNow = monthEligibility(client, currentMonth), eligibleBefore = monthEligibility(client, previousMonth);
    const currentLeads = client.leads.get(monthKey(currentMonth)), previousLeads = client.leads.get(monthKey(previousMonth));
    const leadState = !isLive || eligibleNow === false ? "not_applicable" : eligibleNow === null || currentLeads == null ? "unknown" : currentLeads === 0 ? "triggered" : "clear";
    signal("no_leads", "No leads in the last full month", 30, leadState, `0 leads in ${monthKey(currentMonth)} (full UTC month)`);
    let declineState: RiskSignal["state"];
    if (!isLive || eligibleNow === false || eligibleBefore === false) declineState = "not_applicable";
    else if (eligibleNow === null || eligibleBefore === null || currentLeads == null || previousLeads == null) declineState = "unknown";
    else declineState = previousLeads >= 5 && currentLeads > 0 && currentLeads <= 0.5 * previousLeads ? "triggered" : "clear";
    signal("lead_decline", "Lead decline", 20, declineState, `Leads fell from ${previousLeads} in ${monthKey(previousMonth)} to ${currentLeads} in ${monthKey(currentMonth)}`);
    const overdue = client.subscriptions.some(sub => sub.valid && sub.start !== null && sub.start < at && sub.status === "past_due");
    const billingUncertain = !client.billingKnown || client.subscriptions.some(sub => !sub.valid);
    signal("payment_problem", "Payment problem", 35, overdue ? "triggered" : billingUncertain ? "unknown" : "clear", "Current subscription is past due at the snapshot");
    let currentTickets = 0, previousTickets = 0, unknownTickets = false;
    for (const ticket of tickets) {
      if (ticket.client_id !== client.id) continue;
      const created = priorIso(ticket.created_at, at);
      if (created === null) { unknownTickets = true; continue; }
      if (created >= currentStart && created < at) currentTickets++;
      else if (created >= previousStart && created < currentStart) previousTickets++;
    }
    signal("support_spike", "Support spike", 15, unknownTickets ? "unknown" : currentTickets >= 3 && currentTickets >= 2 * Math.max(previousTickets, 1) ? "triggered" : "clear", `${currentTickets} support tickets in [${new Date(currentStart * 1000).toISOString().slice(0, 10)}, ${new Date(at * 1000).toISOString().slice(0, 10)}) UTC; previous 30 days: ${previousTickets}`);
    const signup = priorIso(client.raw.signup_at, at), rawLiveAt = object(client.raw.onboarding).live_at;
    const noGoLive = rawLiveAt === null;
    const onboardingState = isLive ? "not_applicable" : client.liveAt !== null ? "clear" : !noGoLive || signup === null ? "unknown" : at - signup > 14 * DAY ? "triggered" : "clear";
    signal("long_onboarding", "Long onboarding", 25, onboardingState, `Onboarding for ${signup === null ? "unknown" : ((at - signup) / DAY).toFixed(1)} days at the snapshot (more than 14 days)`);
    const lastLogin = priorIso(client.raw.last_login_at, at);
    signal("inactive_login", "No recent login", 15, !isLive ? "not_applicable" : lastLogin === null ? "unknown" : at - lastLogin >= 30 * DAY ? "triggered" : "clear", `Last login ${lastLogin === null ? "unknown" : Math.floor((at - lastLogin) / DAY)} days before the snapshot (at least 30 days)`);
    const applicable = signals.filter(s => s.state !== "not_applicable").length;
    const assessed = signals.filter(s => s.state === "triggered" || s.state === "clear").length;
    if (!assessed) { result.unevaluatedCount++; continue; }
    if (!signals.some(s => s.state === "triggered")) continue;
    if (billingUncertain) reasons.push("Billing history is incomplete; score is provisional");
    if (client.customer && invoices.some(invoice => invoice.customer === client.customer && invoice.status === "open" && (integer(invoice.attempt_count) ?? 0) > 0)) reasons.push("Unpaid open invoice after a payment attempt (context only; no extra risk points)");
    const risk = Math.min(100, signals.filter(s => s.state === "triggered").reduce((sum, s) => sum + s.weight, 0));
    result.rows.push({ clientId: client.id, businessName: client.name, trade: client.trade, risk, health: 100 - risk, assessed, applicable, reasons, signals });
  }
  result.rows.sort((a: RiskClient, b: RiskClient) => b.risk - a.risk || b.signals.filter(s => s.state === "triggered").length - a.signals.filter(s => s.state === "triggered").length || a.clientId.localeCompare(b.clientId));
  result.total = result.rows.length;
  if (tickets.some(ticket => priorIso(ticket.created_at, at) === null)) issue("invalid_ticket_date", "Some support ticket dates cannot be assigned to a historical window.");
  return result;
}

function adHistory(client: Client, at: number): number | "never" | null {
  const ads = object(client.raw.ads);
  if (typeof ads.enabled !== "boolean") return null;
  const activation = priorIso(ads.enabled_at, at);
  let earlierItem: number | null = null;
  for (const sub of client.subscriptions) {
    const items = object(sub.raw.items).data;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!isRecord(item) || object(item.price).product !== "prod_ads_management") continue;
      const date = timestamp(item.created);
      if (date !== null && date <= at) earlierItem = Math.min(earlierItem ?? Infinity, date);
    }
  }
  if (activation !== null) return earlierItem !== null && earlierItem < activation ? null : activation;
  if (ads.enabled === false && ads.enabled_at === null && earlierItem === null) return "never";
  return null;
}
function computeAds(clients: Client[], at: number): AdsComparison {
  const retained = clients.filter(client => client.status === "retained");
  const known = retained.filter(client => typeof object(client.raw.ads).enabled === "boolean");
  const enabledCount = known.filter(client => object(client.raw.ads).enabled === true).length;
  const exclusions: AdsComparison["exclusions"] = { unknownStart: 0, notReachedLandmark: 0, unknownLandmarkState: 0, notActiveAtLandmark: 0, unknownAdHistory: 0 };
  const early: Client[] = [], notEarly: Client[] = [];
  for (const client of clients) {
    // No-subscription onboarding clients have no billing relationship to classify.
    if (client.billingKnown && !client.subscriptions.length && client.raw.status === "onboarding") continue;
    if (client.first === null) { exclusions.unknownStart++; continue; }
    const landmark = addMonths(client.first, 1);
    if (landmark > at) { exclusions.notReachedLandmark++; continue; }
    const state = stateAt(client, landmark);
    if (state === null) { exclusions.unknownLandmarkState++; continue; }
    if (!state) { exclusions.notActiveAtLandmark++; continue; }
    const activation = adHistory(client, at);
    if (activation === null) { exclusions.unknownAdHistory++; continue; }
    if (activation !== "never" && activation <= landmark) early.push(client);
    else notEarly.push(client);
  }
  const insufficient = !early.length && !notEarly.length && exclusions.unknownAdHistory > 0;
  const groups: AdsComparison["groups"] = [
    { id: "early", label: "Activated by the end of the first month", count: early.length, horizons: [horizon(early, 3, at), horizon(early, 6, at)] },
    { id: "notEarly", label: "Not activated by the end of the first month", count: notEarly.length, horizons: [horizon(notEarly, 3, at), horizon(notEarly, 6, at)] },
  ];
  return {
    adoption: { enabledCount, eligibleCount: known.length, unknownCount: retained.length - known.length, value: known.length ? enabledCount / known.length : null },
    historyStatus: insufficient ? "insufficient_history" : "assumption_based",
    assumptions: [
      { id: "first_activation", text: "A1: enabled_at is assumed to be the first activation, preserved after disabling and re-enabling." },
      { id: "null_means_never", text: "A2: false with no date is assumed to mean no past activation." },
    ],
    limitation: "Estimate: enabled_at is assumed to be the first activation; false with no date is assumed to mean no past activation. " + (insufficient ? "Insufficient history: no landmark-eligible client has classifiable ads history. " : "") + "Comparison is conditional on having a subscription at the first-month landmark. Groups are not randomized; this does not establish a causal effect. Empty denominators mean no_eligible_data.",
    exclusions, groups,
    differences: ([3, 6] as const).map((months, index) => {
      const a = groups[0].horizons[index].value, b = groups[1].horizons[index].value;
      return { months, percentagePoints: a === null || b === null ? null : (a - b) * 100 };
    }),
  };
}

function computeDepartures(clients: Client[]): DashboardData["retention"]["departures"] {
  const churned = clients.filter(client => client.status === "churned");
  const counts = [0, 0, 0];
  let unknownDatesCount = 0;
  for (const client of churned) {
    if (client.first === null || !client.complete) { unknownDatesCount++; continue; }
    const end = Math.max(...client.subscriptions.map(sub => sub.end ?? -Infinity));
    counts[end <= addMonths(client.first, 3) ? 0 : end <= addMonths(client.first, 6) ? 1 : 2]++;
  }
  const denominator = counts.reduce((sum, count) => sum + count, 0);
  return {
    totalChurned: churned.length, unknownDatesCount,
    reactivatedCount: clients.filter(client => client.intervals.length > 1).length,
    bands: counts.map((count, index) => ({ code: ["months_1_3", "months_4_6", "after_6"][index], label: ["Months 1–3", "Months 4–6", "After 6 months"][index], count, share: denominator ? count / denominator : null })),
  };
}
function computeCancellationReasons(clients: Client[]): DashboardData["cancellationReasons"] {
  const churned = clients.filter(client => client.status === "churned");
  const reasons = new Map<string, number>(), feedback = new Map<string, number>();
  let unknownDateCount = 0, voluntary = 0;
  for (const client of churned) {
    if (client.subscriptions.some(sub => sub.end === null)) { unknownDateCount++; increment(reasons, "insufficient_data"); continue; }
    const end = Math.max(...client.subscriptions.map(sub => sub.end ?? -Infinity));
    const final = client.subscriptions.filter(sub => sub.end === end);
    const codes = new Set(final.map(sub => {
      const reason = text(object(sub.raw.cancellation_details).reason);
      return reason === null ? "not_provided" : ["cancellation_requested", "payment_failed"].includes(reason) ? reason : "unknown_reason";
    }));
    const code = codes.size > 1 ? "multiple_reasons" : [...codes][0] ?? "not_provided";
    increment(reasons, code);
    if (code === "cancellation_requested") {
      voluntary++;
      const values = new Set(final.map(sub => {
        const value = text(object(sub.raw.cancellation_details).feedback);
        return value === null ? "not_provided" : ["too_expensive", "low_quality", "unused", "too_complex", "switched_service", "customer_service", "missing_features", "other"].includes(value) ? value : "unknown_feedback";
      }));
      increment(feedback, values.size > 1 ? "multiple_feedback" : [...values][0] ?? "not_provided");
    }
  }
  const labels = { cancellation_requested: "Voluntary cancellation", payment_failed: "Payment failure", multiple_reasons: "Multiple reasons", insufficient_data: "Insufficient data", not_provided: "Not provided", multiple_feedback: "Multiple feedback values", unknown_reason: "Unrecognized reason", unknown_feedback: "Unrecognized feedback" };
  return { total: churned.length, voluntaryCount: voluntary, unknownDateCount, reasons: countShares(reasons, labels, churned.length), voluntaryFeedback: countShares(feedback, labels, voluntary) };
}

/** Pure projection of one complete snapshot; this function performs no I/O. */
export function computeDashboard(data: RawDataset, meta: SnapshotMeta): DashboardData {
  const at = iso(meta.referenceAt, true);
  if (at === null) throw new Error("Snapshot reference date is invalid; dashboard cannot be calculated.");
  const issues = new Map<string, QualityIssue>();
  const issue: Issue = (code, message) => {
    const previous = issues.get(code);
    issues.set(code, { code, message, count: (previous?.count ?? 0) + 1 });
  };
  const rawClients = unique(data.clients), customers = unique(data.customers), rawSubscriptions = unique(data.subscriptions);
  const invoices = unique(data.invoices), tickets = unique(data.tickets);
  const customerIds = new Set(customers.map(customer => customer.id));
  const clientIds = new Set(rawClients.map(client => client.id));
  const subscriptionIds = new Set(rawSubscriptions.map(sub => sub.id));
  for (const sub of rawSubscriptions) {
    if (!customerIds.has(identity(sub.customer) ?? "")) issue("orphan_subscription_customer", "A subscription has no matching billing customer; it cannot establish a product-client relationship.");
  }
  for (const invoice of invoices) {
    if (!customerIds.has(identity(invoice.customer) ?? "")) issue("orphan_invoice_customer", "An invoice has no matching billing customer and cannot contribute to cash metrics.");
    if (!subscriptionIds.has(identity(invoice.subscription) ?? "")) issue("orphan_invoice_subscription", "An invoice has no matching subscription; related cash history is incomplete.");
  }
  for (const ticket of tickets) {
    if (!clientIds.has(identity(ticket.client_id) ?? "")) issue("orphan_ticket_client", "A support ticket has no matching product client and is excluded from health assessment.");
  }
  for (const payload of data.leads) {
    if (!clientIds.has(payload.client_id)) issue("orphan_leads_client", "A lead response has no matching product client and is excluded from lead metrics.");
  }
  const ownerCount = new Map<string, number>();
  for (const client of rawClients) {
    const customer = identity(client.stripe_customer_id);
    if (customer) ownerCount.set(customer, (ownerCount.get(customer) ?? 0) + 1);
  }
  for (const customer of customers) {
    if (!ownerCount.has(customer.id)) issue("unlinked_billing_customer", "A billing customer has no stable-ID product-client relationship; no synthetic product client is created.");
  }
  const subscriptions = rawSubscriptions.map(sub => normalizeSubscription(sub, at, issue));
  const clients: Client[] = rawClients.map(raw => {
    const customer = identity(raw.stripe_customer_id);
    const billingKnown = customer !== null && customerIds.has(customer) && ownerCount.get(customer) === 1;
    if (!billingKnown) issue(customer !== null && (ownerCount.get(customer) ?? 0) > 1 ? "ambiguous_billing_join" : "missing_billing_join", "A client has no unique stable-ID billing relationship; billing-dependent metrics exclude it.");
    const subs = billingKnown ? subscriptions.filter(sub => sub.customer === customer && (sub.start === null || sub.start < at)) : [];
    const first = billingKnown && subs.length && subs.every(sub => sub.start !== null) ? Math.min(...subs.map(sub => sub.start ?? Infinity)) : null;
    const complete = billingKnown && subs.length > 0 && subs.every(sub => sub.valid && sub.start !== null && sub.end !== null);
    const intervals = union(subs.flatMap(sub => sub.valid && sub.start !== null && sub.end !== null ? [{ start: sub.start, end: sub.end }] : []));
    let status: Client["status"] = "unknown";
    if (subs.some(sub => sub.valid && sub.start !== null && ["active", "past_due"].includes(sub.status ?? ""))) status = "retained";
    else if (subs.length && subs.every(sub => sub.valid && sub.start !== null && sub.status === "canceled")) status = "churned";
    if (raw.status === "cancelled" && status === "retained") issue("product_billing_status_mismatch", "Product cancellation differs from a confirmed current billing relationship.");
    const leads = new Map<string, number | null>();
    for (const payload of data.leads) {
      if (payload.client_id !== raw.id) continue;
      for (const row of payload.data) {
        const month = text(row.month), value = integer(row.leads);
        if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { issue("invalid_lead_month", "A lead observation has an invalid calendar month."); continue; }
        if (value === null || (leads.has(month) && leads.get(month) !== value)) {
          leads.set(month, null);
          issue("invalid_lead_observation", "A lead month has an invalid value or conflicting duplicate; it is not treated as zero.");
        } else if (!leads.has(month)) leads.set(month, value);
      }
    }
    return { id: raw.id, name: text(raw.business_name) ?? "Unnamed business", trade: text(raw.trade) ?? "Не указан", raw, customer, billingKnown, subscriptions: subs, first, status, complete, estimated: subs.some(sub => sub.estimated), intervals, liveAt: priorIso(object(raw.onboarding).live_at, at), leads };
  });
  const calendar = new Date(at * 1000);
  const monthStart = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), 1) / 1000;
  const months = [-3, -2, -1].map(offset => addMonths(monthStart, offset));
  const retentionClients = clients.filter(client => client.subscriptions.length > 0 || !client.billingKnown);
  const leadsByTrade = computeLeads(clients, months);
  const economicsByTrade = computeEconomics(clients, invoices, subscriptions, at, issue);
  const atRisk = computeRisk(clients, tickets, invoices, at, months, issue);
  const ads = computeAds(clients, at);
  return {
    meta: { ...meta, definitionsVersion: "v5" },
    quality: { issues: [...issues.values()].sort((a, b) => a.code.localeCompare(b.code)), clientCount: clients.length, customerCount: customers.length, invoiceCount: invoices.length, ticketCount: tickets.length },
    atRisk,
    retention: {
      horizons: [horizon(retentionClients, 3, at), horizon(retentionClients, 6, at)],
      snapshot: { retainedCount: clients.filter(client => client.status === "retained").length, churnedCount: clients.filter(client => client.status === "churned").length, unknownCount: clients.filter(client => client.status === "unknown").length },
      departures: computeDepartures(clients),
    },
    leadsByTrade, economicsByTrade, ads, cancellationReasons: computeCancellationReasons(clients),
  };
}
