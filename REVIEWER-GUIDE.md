# UpRank challenge — reviewer acceptance guide

Reviewer: ____________________  Date: ____________________

Reviewed revision/package: ____________________

This is a local, read-only decision dashboard. All five required views and the cancellation-reasons bonus are on one page. Billing and product records come from the supplied mock APIs, are stored in Postgres, and are joined and calculated on the server. The browser receives prepared results.

## 1. Prepare the review

Follow [README.md](README.md) for the exact setup: Node.js 22.12+, a running local Postgres through Docker Compose, the supplied API key in `.env`, then:

```text
npm ci
npm run db:init
npm run data:import
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Postgres must be running before `db:init`. The README includes Compose and production-mode local commands. Do not commit or paste the API key into the browser.

Import is explicit: reloading the page reads the most recent complete database snapshot, rather than polling the source APIs. The reference date and import time are displayed separately. A failed new import preserves the previous complete snapshot with a warning.

Read [WRITEUP.md](WRITEUP.md) for the implementation rationale, metric choices, limitations and bonus decision.

## 2. Functional acceptance walkthrough

Allow approximately 10–15 minutes after setup. Mark the result yourself; these boxes are not a claim of reviewer acceptance.

| Check | Action and expected result | Result |
| --- | --- | --- |
| Actionable client list | Open **Client priorities**. Clients are ranked by ascending health / descending risk. Each has a trade, a health score, measured reasons and assessment coverage. Lower health means higher priority | ☐ Pass ☐ Fail |
| Explainable ranking | Expand **View signals** for a client. Triggered signals show their point deductions; clear, unknown and inapplicable states remain distinct. Partial assessments are labelled provisional | ☐ Pass ☐ Fail |
| Complete call list | Select **Show all clients**, then **Show first 10**. The same-page list expands and collapses. The control also works with Enter | ☐ Pass ☐ Fail |
| Retention | Open **Retention**. Three- and six-month results have separate mature denominators. Recent clients are excluded only from horizons they have not reached. Nonzero unknown/estimated-date counts are visible | ☐ Pass ☐ Fail |
| Departure timing | Check the three bands: months 1–3, 4–6 and after 6. Shares use departures with known timing; unknown dates are separate. These bands are not the difference between the two retention percentages | ☐ Pass ☐ Fail |
| Leads by trade | Open **Lead performance**. The closed-month period, average leads, client counts, eligible/observed months, coverage and limited-data flags are available. Clients outside the average are not automatically labelled as missing observations | ☐ Pass ☐ Fail |
| Useful comparisons | Sort lead results in both directions using a column heading. Open **Revenue & LTV** and compare monthly revenue, observed duration and LTV using their sortable headings. The arrow and accessible sort direction change with the rows | ☐ Pass ☐ Fail |
| Financial interpretation | Revenue and LTV are labelled AUD. Observed LTV uses the same eligible group as monthly revenue and duration. Active clients are measured up to the reference date; it is historical value, not a lifetime forecast | ☐ Pass ☐ Fail |
| Calculation evidence | Expand **View calculation totals**. Net collected cents, exposure seconds and eligible client counts are available. Display rounding does not change underlying calculations | ☐ Pass ☐ Fail |
| Advertising | Open **Advertising**. Current adoption is separate from the fixed first-month groups. Each group's R3/R6 has its own denominator; differences are percentage points. A1/A2 and the descriptive, noncausal limitation stay visible | ☐ Pass ☐ Fail |
| Bonus | Open **Cancellation reasons**. Final client departures are separated into voluntary cancellations and payment failures. Voluntary feedback uses the voluntary denominator and includes missing answers | ☐ Pass ☐ Fail |
| Data coverage | Expand **Data coverage**. Counts and the effects of exclusions are explained in ordinary language. Unmatched records are not joined by business name or silently invented | ☐ Pass ☐ Fail |
| Navigation | Use every menu item, manually scroll, use Back/Forward, and reload a URL containing a section hash. One menu item follows the visible section; navigation remains within the single page | ☐ Pass ☐ Fail |
| Small screen and keyboard | At a narrow viewport, the navigation remains available. Wide tables show working horizontal controls and can be scrolled with the keyboard. Section titles are not covered by the navigation; page content does not overflow | ☐ Pass ☐ Fail |

For the supplied snapshot at **1 November 2026, 00:00 UTC**, reference values are:

| View | Expected reference values |
| --- | --- |
| Priority list | 19 clients; first 10 initially displayed |
| Retention | R3: 184/204 = 90.2%; R6: 156/175 = 89.1% |
| Departures | 20 in months 1–3; 4 in months 4–6; 40 after month 6 |
| Lead comparison | Plumber: 14.1 leads/month across 51 included clients; Landscaper: 1.6 across 3 clients, flagged limited data |
| Financial comparison | Highest observed LTV: Roofer, $4,245.86; highest revenue/client-month: Electrician, $471.39 |
| Advertising | Adoption: 67/173 = 38.7%. Fixed groups: 25 early adopters and 197 not activated by month 1; horizon denominators are smaller than group totals where follow-up is immature |
| Bonus | 64 terminal departures: 55 voluntary, 9 payment failure. Voluntary feedback includes 5 missing answers |
| Data coverage | 1 product client without linked billing; 15 clients with short financial exposure; 2 billing accounts without a product client |

These are verification references, not hardcoded application values. If the API reference date changes, review the definitions and newly imported data rather than treating these old counts as acceptance constants.

## 3. Definitions to assess

The brief delegates metric definitions and thresholds to the candidate. The following are implementation choices, not additional requirements attributed to UpRank.

| Metric | Definition |
| --- | --- |
| Health | 100 minus flagged risk points, bounded at zero. Zero leads in the latest eligible full month: 30 points. Falling leads: 20, when the previous month had at least 5 and the current positive count is at most half. A zero count is not penalised twice |
| Other risk signals | Current past-due subscription: 35. Support: 15 when the latest 30 days have at least 3 tickets and at least twice `max(previous 30-day count, 1)`. Onboarding over 14 days: 25. Live client with no login for at least 30 days: 15 |
| R3/R6 | Subscription state at the personal three-/six-calendar-month anniversary from the first subscription start. Reactivation can count at the anniversary; this is not an uninterrupted survival curve |
| Leads | Latest three complete UTC calendar months. Averages are calculated within each eligible client, then averaged equally across clients in a trade. Missing observations are excluded and lower coverage; explicit zero observations remain zero |
| Limited lead data | Fewer than 5 included clients, fewer than 10 observed client-months, or coverage below 80% |
| Revenue/client-month | Total net paid cash, after post-payment credit corrections, divided by total observed client-months for the eligible trade group. One standard month is 2,629,800 seconds. Incomplete financial histories and exposure below one standard month are excluded |
| Observed LTV | Revenue/client-month × average observed months over the same clients. Equivalently, total net paid cash / eligible clients. Unpaid invoices and external advertising-platform spend do not become UpRank paid revenue |
| Advertising groups | Clients subscribed at the first-calendar-month landmark are grouped by activation by that date versus no activation by that date. The second group includes later adopters. Outcomes are measured at months 3/6 from the original subscription start |

Advertising history is **assumption-based**, not verified: A1 assumes `enabled_at` preserves the first activation through disabling/re-enabling; A2 assumes false with no date means no prior activation. Ambiguous histories are excluded. The comparison cannot establish that advertising caused retention or cancellations. If reliable evidence disproves the assumptions and groups cannot be reconstructed, the historical comparison must not be treated as valid.

## 4. Technical verification

```text
npm run typecheck
npm test
npm run build
```

All 60 tests run when the separate `TEST_DATABASE_URL` is configured as described in README. Otherwise the real-Postgres integration case is explicitly skipped and the other 59 run. The database case verifies run states, rollback and preserving the prior complete snapshot after failure. Synthetic domain fixtures cover date boundaries, returns, dirty joins, missing leads, cash/LTV and ads assumptions. Import tests exercise the actual pagination and bounded retry implementation with controlled responses.

Check `GET /api/dashboard`: it returns prepared metrics with `Cache-Control: no-store`, without the API key, contacts or complete upstream collections. Database writes are intentionally restricted to the dedicated local challenge databases.

The author has exercised missing-snapshot retry, empty metrics, disabled sorting without comparable rows, and a failed-import warning using isolated local test data. Those checks supplement the real API import; the running main dashboard uses the real imported snapshot.

## 5. Review boundaries and outcome

Authentication, public hosting, source mutations, scheduled sync, CRM profiles, calling/messaging and causal inference are outside this local dashboard's scope.

Overall result: ☐ Accepted ☐ Changes requested

Required changes / comments:

________________________________________________________________________

________________________________________________________________________
