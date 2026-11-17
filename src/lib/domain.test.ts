import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDashboard } from "./domain";
import type { RawDataset, RawRecord, SnapshotMeta } from "./contracts";

const meta: SnapshotMeta = { snapshotId: "synthetic", referenceAt: "2026-11-01T00:00:00Z", importedAt: "2026-11-17T00:00:00Z", lastImportStatus: "succeeded" };
const seconds = (date: string) => Date.parse(date) / 1000;
function client(id: string, fields: Record<string, unknown> = {}): RawRecord {
  return { id, business_name: `Synthetic ${id}`, stripe_customer_id: `cus_${id}`, trade: "plumber", status: "live", signup_at: "2026-01-01T00:00:00Z", onboarding: { live_at: "2026-01-01T00:00:00Z" }, last_login_at: "2026-10-31T00:00:00Z", ads: { enabled: false, enabled_at: null }, ...fields };
}
function sub(id: string, customerId: string, start: string, end: string | null = null, fields: Record<string, unknown> = {}): RawRecord {
  return { id, customer: customerId, start_date: seconds(start), created: seconds(start), status: end ? "canceled" : "active", ended_at: end ? seconds(end) : null, canceled_at: null, ...fields };
}
function dataset(clients: RawRecord[], subscriptions: RawRecord[], rest: Partial<RawDataset> = {}): RawDataset {
  return { clients, customers: clients.map(c => ({ id: String(c.stripe_customer_id) })), subscriptions, invoices: [], tickets: [], leads: clients.map(c => ({ client_id: c.id, data: [] })), ...rest };
}
function invoice(id: string, owner: string, subscription: string, amount: unknown, fields: Record<string, unknown> = {}): RawRecord {
  return { id, customer: owner, subscription, status: "paid", currency: "aud", amount_paid: amount, post_payment_credit_notes_amount: 0, status_transitions: { paid_at: seconds("2026-10-20T00:00:00Z") }, ...fields };
}

describe("v5 pure dashboard", () => {
  it("uses personal calendar horizons, interval endpoints and maturity independently", () => {
    const data = dataset([client("active"), client("boundary"), client("return"), client("new")], [
      sub("a", "cus_active", "2026-08-01T00:00:00Z"),
      sub("b", "cus_boundary", "2026-08-01T00:00:00Z", "2026-11-01T00:00:00Z"),
      sub("r1", "cus_return", "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"),
      sub("r2", "cus_return", "2026-05-01T00:00:00Z"),
      sub("n", "cus_new", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"),
    ]);
    const result = computeDashboard(data, meta);
    assert.partialDeepStrictEqual(result.retention.horizons[0], { retainedCount: 1, notRetainedCount: 2, eligibleCount: 3, notMaturedCount: 1, value: 1 / 3 });
    assert.partialDeepStrictEqual(result.retention.horizons[1], { retainedCount: 1, eligibleCount: 1, notMaturedCount: 3, value: 1 });
    assert.deepStrictEqual(result.retention.snapshot, { retainedCount: 2, churnedCount: 2, unknownCount: 0 });
    assert.strictEqual(result.retention.departures.reactivatedCount, 1);
  });

  it("adds months directly from January 31 and separates missing start from missing outcome", () => {
    const data = dataset([client("clamp"), client("nostart"), client("noend")], [
      sub("a", "cus_clamp", "2026-01-31T13:14:15Z", "2026-04-30T13:14:15Z"),
      { id: "b", customer: "cus_nostart", status: "canceled", start_date: null, created: null, ended_at: seconds("2026-08-01T00:00:00Z") },
      sub("c", "cus_noend", "2026-01-01T00:00:00Z", null, { status: "canceled", ended_at: null }),
    ]);
    const result = computeDashboard(data, meta);
    assert.partialDeepStrictEqual(result.retention.horizons[0], { notRetainedCount: 1, unknownStartCount: 1, unknownOutcomeCount: 1, eligibleCount: 1 });
    assert.partialDeepStrictEqual(result.retention.departures.bands[0], { count: 1, share: 1 });
    assert.strictEqual(result.retention.departures.unknownDatesCount, 1);
  });

  it("counts lead observations equally per client and retains observation-free clients in coverage", () => {
    const data = dataset([client("a"), client("b"), client("c")], [sub("a", "cus_a", "2026-01-01T00:00:00Z"), sub("b", "cus_b", "2026-01-01T00:00:00Z"), sub("c", "cus_c", "2026-01-01T00:00:00Z")], {
      leads: [
        { client_id: "a", data: [{ month: "2026-08", leads: 10 }, { month: "2026-09", leads: 10 }, { month: "2026-10", leads: 10 }] },
        { client_id: "b", data: [{ month: "2026-10", leads: 30 }] },
        { client_id: "c", data: [] },
      ],
    });
    assert.partialDeepStrictEqual(computeDashboard(data, meta).leadsByTrade[0], { value: 20, nClients: 2, observedClientMonths: 4, eligibleClientMonths: 9, clientsWithoutObservations: 1, coverage: 4 / 9, smallSample: true });
  });

  it("unions overlapping subscriptions but rejects lead months with a service gap or partial go-live", () => {
    const data = dataset([client("a"), client("b", { onboarding: { live_at: "2026-10-15T00:00:00Z" } })], [
      sub("a1", "cus_a", "2026-01-01T00:00:00Z", "2026-09-10T00:00:00Z"), sub("a2", "cus_a", "2026-10-01T00:00:00Z"), sub("a3", "cus_a", "2026-10-15T00:00:00Z"), sub("b", "cus_b", "2026-01-01T00:00:00Z"),
    ], { leads: [{ client_id: "a", data: [{ month: "2026-08", leads: 0 }, { month: "2026-09", leads: 100 }, { month: "2026-10", leads: 10 }] }, { client_id: "b", data: [{ month: "2026-10", leads: 100 }] }] });
    assert.partialDeepStrictEqual(computeDashboard(data, meta).leadsByTrade[0], { value: 5, nClients: 1, observedClientMonths: 2, eligibleClientMonths: 2 });
  });

  it("pools net cash and exposure on exactly the same eligible population without rounding LTV", () => {
    const data = dataset([client("a"), client("b"), client("short"), client("bad")], [
      sub("a", "cus_a", "2026-09-01T00:00:00Z"), sub("overlap", "cus_a", "2026-10-01T00:00:00Z"), sub("b", "cus_b", "2026-07-01T00:00:00Z"), sub("short", "cus_short", "2026-10-20T00:00:00Z"), sub("bad", "cus_bad", "2026-01-01T00:00:00Z"),
    ], { invoices: [invoice("a", "cus_a", "a", 25000, { post_payment_credit_notes_amount: 5000 }), invoice("b", "cus_b", "b", 80000), invoice("short", "cus_short", "short", 999999), invoice("bad", "cus_bad", "bad", "10000")] });
    data.invoices.push({ ...data.invoices[0] });
    const result = computeDashboard(data, meta).economicsByTrade[0];
    assert.partialDeepStrictEqual(result, { netRevenueCents: 100000, exposureSeconds: 184 * 86400, eligibleClientCount: 2, excludedClientCount: 2, observedLtvAud: 500, activeClientCount: 2 });
    assert.ok(result.monthlyRevenueAud !== null && Math.abs(result.monthlyRevenueAud - (1000 / (184 / 30.4375))) < 0.5 * 10 ** -10);
    assert.ok(result.avgObservedMonths !== null && Math.abs(result.avgObservedMonths - (184 / 30.4375 / 2)) < 0.5 * 10 ** -10);
  });

  it("keeps known zero cash, ignores unpaid invoices and allows planned future subscription endings", () => {
    const data = dataset([client("a")], [sub("a", "cus_a", "2026-08-01T00:00:00Z", null, { ended_at: seconds("2027-01-01T00:00:00Z") })], { invoices: [invoice("open", "cus_a", "a", 90000, { status: "open" })] });
    assert.partialDeepStrictEqual(computeDashboard(data, meta).economicsByTrade[0], { eligibleClientCount: 1, monthlyRevenueAud: 0, observedLtvAud: 0, exposureSeconds: 92 * 86400 });
  });

  it("isolates invoice ownership conflicts from BOTH customers without erasing retention", () => {
    const data = dataset([client("a"), client("b")], [sub("a", "cus_a", "2026-01-01T00:00:00Z"), sub("b", "cus_b", "2026-01-01T00:00:00Z")], { invoices: [invoice("bad", "cus_a", "b", 10000)] });
    const result = computeDashboard(data, meta);
    assert.partialDeepStrictEqual(result.economicsByTrade[0], { eligibleClientCount: 0, excludedClientCount: 2, monthlyRevenueAud: null, observedLtvAud: null });
    assert.strictEqual(result.retention.snapshot.retainedCount, 2);
    assert.strictEqual(result.quality.issues.some(issue => issue.code === "invoice_ownership_conflict"), true);
  });

  it("rejects ambiguous shared billing IDs and never joins by matching names", () => {
    const data = dataset([client("a"), client("b", { stripe_customer_id: "cus_a" }), client("c", { stripe_customer_id: "missing" })], [sub("a", "cus_a", "2026-01-01T00:00:00Z")], { customers: [{ id: "cus_a", name: "Synthetic c" }] });
    const result = computeDashboard(data, meta);
    assert.deepStrictEqual(result.retention.snapshot, { retainedCount: 0, churnedCount: 0, unknownCount: 3 });
    assert.strictEqual(result.economicsByTrade[0].eligibleClientCount, 0);
  });

  it("scores the six measured health signals without double-penalizing zero leads", () => {
    const data = dataset([client("a", { last_login_at: "2026-09-27T00:00:00Z" })], [sub("a", "cus_a", "2026-01-01T00:00:00Z", null, { status: "past_due" })], { leads: [{ client_id: "a", data: [{ month: "2026-09", leads: 12 }, { month: "2026-10", leads: 0 }] }], tickets: [
      { id: "t1", client_id: "a", created_at: "2026-10-03T00:00:00Z" }, { id: "t2", client_id: "a", created_at: "2026-10-04T00:00:00Z" }, { id: "t3", client_id: "a", created_at: "2026-10-05T00:00:00Z" }, { id: "future", client_id: "a", created_at: "2026-11-01T00:00:00Z" },
    ] });
    const row = computeDashboard(data, meta).atRisk.rows[0];
    assert.partialDeepStrictEqual(row, { risk: 95, health: 5, assessed: 5, applicable: 5 });
    assert.strictEqual((row.signals.filter(s => s.state === "triggered")).length, 4);
    assert.ok((row.reasons.join(" ")).includes("2026-10"));
  });

  it("distinguishes missing lead months from zero and respects the strict onboarding boundary", () => {
    const data = dataset([client("live"), client("on", { status: "onboarding", signup_at: "2026-10-18T00:00:00Z", onboarding: { live_at: null } }), client("old", { status: "onboarding", signup_at: "2026-10-17T23:59:59Z", onboarding: { live_at: null } })], [sub("live", "cus_live", "2026-01-01T00:00:00Z")]);
    const result = computeDashboard(data, meta);
    assert.deepStrictEqual(result.atRisk.rows.map(c => c.clientId), ["old"]);
    assert.strictEqual(result.atRisk.rows[0].risk, 25);
    assert.strictEqual(result.atRisk.rows[0].signals.filter(s => ["no_leads", "lead_decline", "inactive_login"].includes(s.id)).every(s => s.state === "not_applicable"), true);
  });

  it("fixes ads groups at the first-month landmark, handles disabled historical ads and excludes unknown history", () => {
    const data = dataset([
      client("early", { ads: { enabled: false, enabled_at: "2026-02-01T00:00:00Z" } }), client("late", { ads: { enabled: true, enabled_at: "2026-03-01T00:00:00Z" } }), client("never"), client("unknown", { ads: { enabled: true, enabled_at: null } }), client("left"), client("young"),
    ], [sub("e", "cus_early", "2026-01-01T00:00:00Z"), sub("l", "cus_late", "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"), sub("n", "cus_never", "2026-01-01T00:00:00Z"), sub("u", "cus_unknown", "2026-01-01T00:00:00Z"), sub("x", "cus_left", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"), sub("y", "cus_young", "2026-10-15T00:00:00Z")]);
    const ads = computeDashboard(data, meta).ads;
    assert.strictEqual(ads.historyStatus, "assumption_based");
    assert.deepStrictEqual(ads.assumptions.map(a => a.id), ["first_activation", "null_means_never"]);
    assert.strictEqual((ads.groups[0]).horizons.length, 2);
    assert.partialDeepStrictEqual(ads.groups[0], { count: 1, horizons: [{ retainedCount: 1, eligibleCount: 1, value: 1 }, { value: 1 }] });
    assert.strictEqual((ads.groups[1]).horizons.length, 2);
    assert.partialDeepStrictEqual(ads.groups[1], { count: 2, horizons: [{ retainedCount: 1, eligibleCount: 2, value: 0.5 }, { value: 0.5 }] });
    assert.strictEqual(ads.differences[0].percentagePoints, 50);
    assert.partialDeepStrictEqual(ads.exclusions, { notActiveAtLandmark: 1, notReachedLandmark: 1, unknownAdHistory: 1 });
  });

  it("does not turn documented prior ads items into proof of never enabled", () => {
    const data = dataset([client("bad"), client("ok")], [sub("b", "cus_bad", "2026-01-01T00:00:00Z", null, { items: { data: [{ created: seconds("2026-02-01T00:00:00Z"), price: { product: "prod_ads_management" } }] } }), sub("o", "cus_ok", "2026-01-01T00:00:00Z")]);
    assert.strictEqual(computeDashboard(data, meta).ads.exclusions.unknownAdHistory, 1);
  });

  it("counts terminal departures once, chooses final events and uses a separate voluntary feedback denominator", () => {
    const data = dataset([client("a"), client("b"), client("retained"), client("tie")], [
      sub("a1", "cus_a", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z", { cancellation_details: { reason: "payment_failed" } }),
      sub("a2", "cus_a", "2026-05-01T00:00:00Z", "2026-08-01T00:00:00Z", { cancellation_details: { reason: "cancellation_requested", feedback: null } }),
      sub("b", "cus_b", "2026-01-01T00:00:00Z", "2026-07-01T00:00:00Z", { cancellation_details: { reason: "payment_failed" } }),
      sub("r1", "cus_retained", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z", { cancellation_details: { reason: "cancellation_requested" } }), sub("r2", "cus_retained", "2026-01-01T00:00:00Z"),
      sub("t1", "cus_tie", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z", { cancellation_details: { reason: "payment_failed" } }), sub("t2", "cus_tie", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z", { cancellation_details: { reason: "cancellation_requested" } }),
    ]);
    const bonus = computeDashboard(data, meta).cancellationReasons;
    assert.strictEqual(bonus.total, 3);
    assert.strictEqual(bonus.voluntaryCount, 1);
    assert.partialDeepStrictEqual(bonus.reasons.find(r => r.code === "payment_failed"), { count: 1, share: 1 / 3 });
    assert.partialDeepStrictEqual(bonus.reasons.find(r => r.code === "multiple_reasons"), { count: 1, share: 1 / 3 });
    assert.partialDeepStrictEqual(bonus.voluntaryFeedback.find(r => r.code === "not_provided"), { count: 1, share: 1 });
  });

  it("returns null for empty denominators and never leaks contacts or source payloads", () => {
    const empty = computeDashboard(dataset([], []), meta);
    assert.strictEqual(empty.retention.horizons.every(h => h.value === null), true);
    assert.strictEqual(empty.ads.adoption.value, null);
    const data = dataset([client("a", { email: "PRIVATE-CONTACT", phone: "PRIVATE-PHONE", nested: { secret: "PRIVATE-PAYLOAD" } })], [sub("a", "cus_a", "2026-01-01T00:00:00Z")]);
    assert.doesNotMatch(JSON.stringify(computeDashboard(data, meta)), /PRIVATE/);
  });

  it("keeps missing cash dates, excessive refunds and negative money out of BOTH monetary averages", () => {
    const data = dataset([client("date"), client("refund"), client("negative"), client("good")], [
      sub("date", "cus_date", "2026-01-01T00:00:00Z"), sub("refund", "cus_refund", "2026-01-01T00:00:00Z"), sub("negative", "cus_negative", "2026-01-01T00:00:00Z"), sub("good", "cus_good", "2026-01-01T00:00:00Z"),
    ], { invoices: [invoice("date", "cus_date", "date", 100, { status_transitions: { paid_at: null } }), invoice("refund", "cus_refund", "refund", 100, { post_payment_credit_notes_amount: 101 }), invoice("negative", "cus_negative", "negative", -1), invoice("good", "cus_good", "good", 44600, { post_payment_credit_notes_amount: 5000, period_start: null, period_end: null })] });
    assert.partialDeepStrictEqual(computeDashboard(data, meta).economicsByTrade[0], { eligibleClientCount: 1, excludedClientCount: 3, netRevenueCents: 39600, observedLtvAud: 396 });
  });

  it("retains genuine zero observations while rejecting conflicting lead duplicates", () => {
    const data = dataset([client("a")], [sub("a", "cus_a", "2026-01-01T00:00:00Z")], { leads: [{ client_id: "a", data: [{ month: "2026-08", leads: 0 }, { month: "2026-09", leads: 100 }, { month: "2026-09", leads: 101 }, { month: "2026-10", leads: "0" }] }] });
    assert.partialDeepStrictEqual(computeDashboard(data, meta).leadsByTrade[0], { value: 0, nClients: 1, observedClientMonths: 1, eligibleClientMonths: 3, coverage: 1 / 3 });
  });

  it("does not score unknown-only clients as healthy and excludes product cancellation from calls", () => {
    const data = dataset([client("unknown", { stripe_customer_id: null, onboarding: { live_at: null }, last_login_at: null }), client("cancelled", { status: "cancelled", last_login_at: "2026-01-01T00:00:00Z" })], [sub("c", "cus_cancelled", "2026-01-01T00:00:00Z")], { tickets: [{ id: "bad", client_id: "unknown", created_at: "2026-02-30T00:00:00Z" }] });
    assert.strictEqual((computeDashboard(data, meta).atRisk).rows.length, 0);
    assert.partialDeepStrictEqual(computeDashboard(data, meta).atRisk, { total: 0, eligibleCount: 1, unevaluatedCount: 1, rows: [] });
  });

  it("measures the support and lead decline thresholds and sorts equal risks by stable ID", () => {
    const data = dataset([client("z"), client("a"), client("quiet")], [sub("z", "cus_z", "2026-01-01T00:00:00Z"), sub("a", "cus_a", "2026-01-01T00:00:00Z"), sub("q", "cus_quiet", "2026-01-01T00:00:00Z")], {
      leads: ["z", "a", "quiet"].map(id => ({ client_id: id, data: [{ month: "2026-09", leads: 10 }, { month: "2026-10", leads: 5 }] })),
      tickets: [
        { id: "t1", client_id: "a", created_at: "2026-10-02T00:00:00Z" }, { id: "t2", client_id: "a", created_at: "2026-10-04T00:00:00Z" }, { id: "t3", client_id: "a", created_at: "2026-10-05T00:00:00Z" },
        { id: "t4", client_id: "a", created_at: "2026-09-15T00:00:00Z" }, { id: "t5", client_id: "a", created_at: "2026-09-16T00:00:00Z" },
      ],
    });
    const result = computeDashboard(data, meta);
    assert.deepStrictEqual(result.atRisk.rows.map(c => [c.clientId, c.risk]), [["a", 20], ["quiet", 20], ["z", 20]]);
    assert.strictEqual(result.atRisk.rows[0].signals.find(s => s.id === "support_spike")?.state, "clear");
  });

  it("flags fallback dates without confusing a canceled_at request with an active ending", () => {
    const data = dataset([client("a")], [sub("a", "cus_a", "2026-01-01T00:00:00Z", null, { start_date: null, canceled_at: seconds("2026-02-01T00:00:00Z") })]);
    assert.partialDeepStrictEqual(computeDashboard(data, meta).retention.horizons[0], { retainedCount: 1, estimatedDateCount: 1 });
  });

  it("does not invent a safe first start or outcome from contradictory active boundaries", () => {
    const data = dataset([client("active"), client("badstart")], [sub("a", "cus_active", "2026-01-01T00:00:00Z", null, { ended_at: seconds("2026-02-01T00:00:00Z") }), sub("b", "cus_badstart", "2026-01-01T00:00:00Z", null, { start_date: "1735689600" })]);
    assert.partialDeepStrictEqual(computeDashboard(data, meta).retention.horizons[0], { eligibleCount: 0, unknownStartCount: 1, unknownOutcomeCount: 1, value: null });
  });

  it("separates unknown landmark state, unknown start, unknown ads and empty eligible groups", () => {
    const data = dataset([client("start"), client("state"), client("ads")], [
      sub("start", "cus_start", "2026-01-01T00:00:00Z", null, { start_date: null, created: null }),
      sub("state", "cus_state", "2026-01-01T00:00:00Z", null, { status: "canceled" }),
      sub("ads", "cus_ads", "2026-01-01T00:00:00Z"),
    ]);
    data.clients[2].ads = { enabled: true, enabled_at: "2026-12-01T00:00:00Z" };
    const ads = computeDashboard(data, meta).ads;
    assert.strictEqual(ads.historyStatus, "insufficient_history");
    assert.deepStrictEqual(ads.exclusions, { unknownStart: 1, unknownLandmarkState: 1, unknownAdHistory: 1, notReachedLandmark: 0, notActiveAtLandmark: 0 });
    assert.strictEqual(ads.groups.every(group => group.horizons.every(h => h.value === null)), true);
    const validButEmpty = computeDashboard(dataset([], []), meta).ads;
    assert.strictEqual(validButEmpty.historyStatus, "assumption_based");
    assert.strictEqual(validButEmpty.groups.every(group => group.horizons.every(h => h.value === null)), true);
  });

  it("rejects conflicting duplicate IDs instead of publishing a plausible metric", () => {
    const data = dataset([client("a")], [sub("a", "cus_a", "2026-01-01T00:00:00Z")]);
    data.clients.push(client("a", { trade: "different" }));
    assert.throws(() => computeDashboard(data, meta), { message: new RegExp(/Conflicting duplicate source identity/) });
  });

  it("does not publish arbitrary source strings as cancellation categories", () => {
    const data = dataset([client("a")], [sub("a", "cus_a", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z", { cancellation_details: { reason: "UNEXPECTED-PRIVATE-STRING" } })]);
    const result = computeDashboard(data, meta);
    assert.ok(!(JSON.stringify(result)).includes("UNEXPECTED-PRIVATE-STRING"));
    assert.strictEqual(result.cancellationReasons.reasons[0].code, "unknown_reason");
  });

  it("counts unresolved source relationships instead of synthesizing clients", () => {
    const data = dataset([client("a")], [sub("a", "cus_a", "2026-01-01T00:00:00Z"), sub("orphan", "cus_missing", "2026-01-01T00:00:00Z")], {
      invoices: [invoice("orphan", "cus_missing", "sub_missing", 100)], tickets: [{ id: "orphan", client_id: "client_missing", created_at: "2026-10-10T00:00:00Z" }], leads: [{ client_id: "client_missing", data: [] }],
    });
    const result = computeDashboard(data, meta);
    assert.strictEqual(result.quality.clientCount, 1);
    assert.ok(["orphan_subscription_customer", "orphan_invoice_customer", "orphan_invoice_subscription", "orphan_ticket_client", "orphan_leads_client"].every(value => (result.quality.issues.map(issue => issue.code)).includes(value)));
  });

  it("never repairs foreign IDs by trimming whitespace", () => {
    const data = dataset([client("a", { stripe_customer_id: " cus_a " })], [sub("a", "cus_a", "2026-01-01T00:00:00Z")], { customers: [{ id: "cus_a" }] });
    const result = computeDashboard(data, meta);
    assert.deepStrictEqual(result.retention.snapshot, { retainedCount: 0, churnedCount: 0, unknownCount: 1 });
    assert.strictEqual(result.economicsByTrade[0].eligibleClientCount, 0);
  });
});
