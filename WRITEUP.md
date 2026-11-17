# UpRank dashboard implementation decisions

The dashboard prioritises a concrete decision: which existing clients need attention this week. The other views explain the lifecycle, product results and segment economics behind that queue. All values are computed from the supplied read-only APIs on the server; the browser receives a presentation model, never the upstream key or complete source payloads.

## Data and architecture

Next.js App Router provides the page and backend. An explicit import loads both pagination contracts, every client's lead history, and one consistent API reference date into local Postgres. The page and `/api/dashboard` use the same pure calculation function over the same published snapshot. Refreshing the page does not re-fetch hundreds of upstream resources.

The store has two tables: import runs and original source records. Source records and the successful run state publish in one transaction. A failed import records a safe failure code and leaves the prior complete snapshot available. Transport completeness and business-data quality are distinct: missing optional facts do not masquerade as zero values or erase unrelated verified facts.

pg is sufficient for this small schema, so there is no ORM, external backend, worker queue or scheduled sync. Import requests are bounded by concurrency, deadlines, response sizes and total record count. Writes are restricted to dedicated loopback challenge databases. Docker Compose exposes Postgres only on `127.0.0.1:55432`.

The interface uses direct report names, readable captions and no promotional copy. Comparisons start with the highest leads/month or observed LTV, with real sortable headings for other comparisons. Sorting changes only presentation order over prepared server values. Horizontal controls appear when a table actually overflows. Risk direction and signal contributions are explicit; eligibility notes distinguish an excluded client from a missing observation. Ads assumptions stay beside the estimate without repeating the same disclaimer several times.

## Definitions and tradeoffs

- **Health:** explainable penalties for zero/falling monthly leads, a current past-due subscription, support spikes, long onboarding and inactivity. Thresholds are heuristics rather than learned probabilities. Unknown signals remain unknown; a partial score is visibly labelled. Completed cancellations are not put in a future-churn call list.
- **Retention:** subscription state at each client's three- and six-calendar-month anniversary. Recent clients are excluded only from horizons they have not reached. Reactivations are evaluated at the actual anniversary. This is point-in-time retention, not an uninterrupted survival curve.
- **Leads:** the latest three complete calendar months, eligible only when go-live and subscription intervals establish a complete month. Explicit zero counts; absent months lower coverage. Individual client averages have equal weight within a trade. Client counts, observed/eligible months and small-sample flags accompany comparisons.
- **Revenue:** net paid invoice amounts, including post-payment credit corrections, divided by total observed client-months of eligible clients in each trade. Ad spend paid to an ad platform is excluded. This is historical cash collection per client-month, not MRR or profit.
- **Observed LTV:** revenue per client-month times mean observed duration on the exact same population. This equals total net collections divided by eligible clients. Active clients are censored at the reference date; their future lifetime is not invented. The result uses canonical values rather than rounded UI amounts.
- **Ads:** fix groups at the first-month anniversary among clients subscribed at that point, then compare their three-/six-month outcomes. Subsequent adoption never changes the original group. Current adoption is shown separately.

## Ads assumptions

The API supplies `enabled_at` but does not explicitly guarantee its historical semantics. For the test, the comparison is an **assumption-based estimate**, prominently labelled with two assumptions:

1. `enabled_at` records first activation, survives disabling, and is not replaced on reactivation.
2. `enabled=false` with no activation date means no past activation in the available history.

The diagnostic dataset had 82 dated ads clients; 81 had a documented ads item whose creation matched that date. This supports a working hypothesis, not proof of either assumption. Missing or conflicting individual histories are excluded; assumptions cannot override known contradictory evidence. If the assumptions are disproved and groups cannot be reconstructed, the comparison becomes unavailable rather than silently using today's flag.

The comparison is descriptive and conditional on subscription at the first-month landmark. Acquisition period, trade, budget and customer motivation can still differ. It does not establish that ads caused retention or explain cancellations before that landmark.

## Bonus and next business action

The bonus separates voluntary cancellation from termination after failed payments, then breaks down voluntary feedback including missing answers. This distinguishes a value/onboarding conversation from a payment-recovery process review. It is calculated per finally churned client, not per cancelled subscription or removed add-on. Each displayed share has an explicit denominator.

The initial read-only exploration suggested 55 voluntary departures and 9 after payment failure among 64 linked terminal clients; those observations motivated the feature. The application recomputes the values from its imported data and does not hardcode these counts.

## Verification and limits

Tests use Node.js's built-in test runner and strict assertions, with the existing tsx loader for TypeScript. This avoids an additional test-framework dependency chain. Literal synthetic fixtures exercise date boundaries, reactivation gaps, missing lead months, pooled money/LTV, contradictory owners, ranking and ads assumptions. Controlled transport responses exercise the real importer. A separate real local Postgres database exercises rollback, failure recording and reloading a previous snapshot. These checks complement, rather than replace, a real upstream import and browser verification.

This challenge targets one local read-only dashboard. Authentication, public hosting, upstream mutations, future LTV prediction and causal inference are outside scope. The upstream key stays on the server and is supplied through the local environment.
