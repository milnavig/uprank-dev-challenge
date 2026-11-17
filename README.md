# UpRank decision dashboard

A single page that brings billing and product data together, starting with the clients who need a call. The other views show how long clients stay, which trades get results, and what those relationships earn.

**Next.js · TypeScript · React · Postgres · Tailwind CSS**

![Client priorities, health scores and measured risk signals](docs/screenshots/overview.png)

## What it covers

| View | Decision it supports |
| --- | --- |
| [Client priorities](docs/screenshots/overview.png) | Who needs a call, in what order, and why |
| [Retention](docs/screenshots/retention.png) | Who stays at months 3/6 and when final departures occur |
| [Leads by trade](docs/screenshots/leads.png) | Which trades receive more leads, with sample size and coverage |
| [Revenue and observed LTV](docs/screenshots/economics.png) | How monthly revenue, observed duration and historical value compare |
| [Advertising](docs/screenshots/advertising.png) | Current adoption and subsequent retention in fixed first-month groups |
| [Cancellation reasons — bonus](docs/screenshots/cancellations.png) | Voluntary departures versus payment failures, and voluntary feedback |

Tables can be sorted by their headings, and wide tables have horizontal scroll controls. Each comparison includes the client counts and data gaps needed to judge the result.

## Run locally

Requires **Node.js 22.17+** and a running Docker Linux engine. Verified with Node 24.18 and Postgres 17. Run commands from the repository root.

### 1. Install and configure

```sh
npm ci
cp .env.example .env
```

Set `API_KEY` in `.env` to the supplied hiring-mock key. Keep the included `DATABASE_URL` for the Compose database. The example contains a placeholder key and dedicated local database credentials.

### 2. Prepare data and start

```sh
docker compose -p uprank-challenge up -d --wait postgres
npm run db:init
npm run data:import
npm run dev
```

Open **[http://127.0.0.1:3000](http://127.0.0.1:3000)**. If Docker Desktop's default context points to a different engine, use `docker --context desktop-linux compose ...` for the Docker command.

For a production-mode local run, stop the development server and use:

```sh
npm run build
npm run start
```

The import reads both APIs and saves a complete snapshot in Postgres. Reloading the page uses that snapshot; run `npm run data:import` again to refresh it. The dashboard shows both the source reference date and the time of the import.

If an import fails, the previous complete snapshot stays available with a warning. Before the first successful import, the page shows setup instructions.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm audit
```

Tests use the **built-in Node.js test runner and strict assertions**, with `tsx` loading TypeScript. The full suite has 60 scenarios covering metric boundaries, incomplete data, source pagination/retries/limits, Postgres snapshot recovery, formatting and sorting.

To include the real-Postgres integration suite, create its separate database once:

```sh
docker compose -p uprank-challenge exec -T postgres createdb -U uprank uprank_challenge_test
```

Then run with the test connection. PowerShell:

```powershell
$env:TEST_DATABASE_URL='postgresql://uprank:uprank_local_only@127.0.0.1:55432/uprank_challenge_test'
npm test
```

macOS/Linux:

```sh
TEST_DATABASE_URL=postgresql://uprank:uprank_local_only@127.0.0.1:55432/uprank_challenge_test npm test
```

Omit `createdb` if the database already exists. Without `TEST_DATABASE_URL`, the database suite is explicitly skipped and the other 59 tests run. There is no separate lint script.

Verified on the submitted implementation: **60 tests passed**, type checking and production build passed, and **`npm audit` reported 0 vulnerabilities**, including development dependencies.

## Design decisions

I put the call list first so someone opening the dashboard can decide where to spend their time. The remaining views help explain the broader picture: retention, results and revenue by trade, and advertising. Client editing, calling and scheduled synchronisation would need separate workflows.

### Sources and identity

Billing supplies customers, subscriptions and invoices. Product supplies clients, monthly leads, onboarding dates, support tickets, last login and advertising status. Both APIs are fully paginated; subscriptions are requested with `status=all` so cancelled clients remain in the history.

The join uses product `stripe_customer_id` and billing `customer.id`; names are only display labels. Subscription and invoice ownership must agree with that relationship. Unmatched records stay unmatched, and a product client without billing is excluded only from calculations that need it. Missing trades appear as **Unspecified**.

The dataset stops at **1 November 2026, 00:00 UTC**, so all periods use `X-Mock-Reference-Date` rather than the computer's clock. Calendar boundaries use UTC. Cash totals stay in integer AUD cents, with rounding only for display. Missing values remain distinct from explicit zeroes and false flags.

### Client call priority

I used six rules that can be checked against the source data. The list considers product clients in `live` or `onboarding` status, unless billing shows they have already left.

| Signal | Trigger | Risk points |
| --- | --- | ---: |
| No leads | Zero in the latest complete UTC month, with full-month service eligibility | 30 |
| Falling leads | Previous month had at least 5; current month has a positive count no more than half the previous count | 20 |
| Payment problem | A current subscription is `past_due` | 35 |
| Support spike | At least 3 tickets in the last 30 days and at least twice `max(previous 30-day count, 1)` | 15 |
| Long onboarding | Still onboarding more than 14 days after signup | 25 |
| Inactivity | A live client has not logged in for at least 30 days | 15 |

Risk is the sum of triggered points, capped at 100. **Health = 100 − risk**, so lower health means higher call priority. Clients with a triggered signal are ranked by risk, then by number of triggered signals, then stable client ID. Initially ten rows are shown; the rest expand on the same page.

I gave payment problems and zero leads the largest deductions because both warrant prompt attention. The decline rule needs at least five leads in the prior month to avoid escalating small fluctuations. A zero month is not penalised again as a decline. An unpaid invoice after a payment attempt adds context, without another deduction.

The weights are a starting point for deciding whom to review. They do not estimate a cancellation probability. Unknown signals stay visible, and partial assessments are labelled provisional.

### Retention and departure timing

I measure retention at each client's three- and six-calendar-month anniversaries from their first subscription start. A client counts as retained if a subscription covers that anniversary. Each horizon has its own denominator: clients must have reached it and have a known outcome. A returned client can count as retained at the anniversary even if there was an earlier gap.

This avoids counting recent clients as lost simply because they have not reached the milestone yet. The measure checks whether they are subscribed on that date; it allows earlier gaps.

Departure timing is calculated separately for clients with no remaining subscription. Their final end date is grouped into **up to 3 months**, **over 3 through 6 months**, and **after 6 months** from first start. Overlapping subscriptions do not create duplicate clients. Unknown dates are reported separately. `ended_at` is preferred; use of `canceled_at` as a fallback is flagged as an estimated boundary.

### Leads by trade

For leads, I use the latest three complete UTC calendar months. A month counts only when the client was live and subscribed throughout. I first average the observed eligible months for each client, then average those client results within the trade. Each included business gets equal weight, even when the amount of available history differs.

An explicit zero contributes zero. An absent month is excluded from the average and reduces coverage. Each trade shows its included clients and observed versus eligible client-months. A comparison is marked **limited data** if it has fewer than 5 clients, fewer than 10 observed client-months, or coverage below 80%. These thresholds are visibility rules, not statistical confidence intervals.

### Revenue and observed LTV

For revenue, I use paid invoice amounts less post-payment credit notes. Open, void and uncollectible invoices contribute no paid revenue. The advertising management fee is already included in billing; `ads.monthly_budget` goes to the ad platform and is excluded.

For each trade, let `cash` be total net collections in AUD, `months` the total observed subscription time, and `N` the eligible client count:

```text
Revenue per client-month = cash / months
Average observed months = months / N
Observed LTV = Revenue per client-month × Average observed months
             = cash / N
```

All three values use the same clients. Subscription intervals are merged before their duration is added; active clients are measured up to the reference date. One financial month is **2,629,800 seconds**, or 30.4375 days. Clients with less than one financial month or incomplete monetary history are excluded from both revenue and LTV, with counts shown. Calculations use unrounded values.

Pooling cash and time keeps the brief's LTV formula consistent and avoids averaging inflated monthly rates from very short histories. **Observed LTV** describes collections over the available history. It does not forecast the remaining lifetime of active clients, and costs are unavailable for a profit calculation.

### Advertising and retention

I kept current adoption separate from the historical comparison. Adoption is the share of billing-retained clients with a known advertising flag who currently have it enabled. For retention, clients must still be subscribed at their first-calendar-month anniversary. At that date, they enter either **activated by month 1** or **not activated by month 1**. Later activation does not move them between groups. Three- and six-month outcomes are measured from the original subscription start using the retention definition above.

Fixing the groups at a shared age avoids assigning earlier subscription time to advertising adopted later. The second group includes later adopters, so this comparison answers a narrower question than today's enabled/disabled split. Clients who left before the first-month anniversary remain in overall retention and are excluded from this comparison.

The API does not guarantee the historical meaning of `enabled_at`; the estimate depends on A1 and A2 in **Assumptions** below. Conflicting evidence, such as an earlier billing add-on date, makes that client's history unclassifiable. Ambiguous histories are excluded; unavailable results remain empty rather than becoming zero. If clients reach the comparison point but none has classifiable advertising history, the response reports `insufficient_history`. Current adoption remains separate.

Trade, acquisition period and client motivation can differ between groups. The result describes an association and cannot establish that advertising causes retention or that its extra cost causes departures.

### Bonus selection

I chose cancellation reasons for the bonus because the response depends on why the client left. A voluntary cancellation raises questions about value, expectations or onboarding; failed payments point to collection and recovery. The view separates the two, then breaks down recorded feedback for voluntary cancellations.

Both types appeared in the initial data inspection, and the existing billing records were enough to build the view. Each client who has finally left is counted once. Cancelling an old subscription or removing an add-on does not by itself count as leaving. Reason shares use all terminal departures; feedback shares use voluntary departures and include missing answers. Counts are recalculated from the imported snapshot.

### Backend and storage

Next.js handles both the page and backend. The import saves source records in Postgres, and shared server logic joins them and calculates all six views. Two tables are enough to keep the import history and source records, so there is no second set of derived totals to maintain.

A complete import is published in one transaction. If a later import fails, the last complete snapshot remains available with a warning. Pagination, concurrency, retries, response sizes and overall import time are bounded. This suits the finite challenge dataset; regular imports at production scale would need retention and cleanup policies.

I kept refresh explicit so opening the dashboard does not trigger hundreds of API requests. The tradeoff is that the data stays at the displayed import time until the command is run again. Authentication, public hosting and a production synchronisation service are outside this submission.

## Assumptions

These are the source assumptions behind the calculations. They need to be checked separately from the thresholds and formulas chosen above.

| Assumption | Status and consequence |
| --- | --- |
| **A1 — First advertising activation.** `enabled_at` records the first activation and is preserved after disabling or re-enabling. | Unconfirmed. The historical comparison is labelled assumption-based in the UI. This field's meaning must be confirmed with the source owner. |
| **A2 — No previous advertising.** `enabled=false` with a null activation date means the client has never activated advertising. | Unconfirmed. The rule is used only where available billing records do not contradict it. A missing date alone is not used to classify an enabled client. |
| **Available history.** Fully paginated source collections provide the available subscription and payment history for the observation period. | Pagination checks establish a complete download, not the existence of unreported historical events. Missing or contradictory fields are excluded from dependent metrics. Earlier omitted records could change retention, duration and collected value. |
| **Service duration.** Billing subscription intervals are a usable proxy for the duration of the client relationship. | Financial exposure is measured from those intervals, with overlaps merged. Lead comparisons additionally require the recorded go-live date. Actual delivery interruptions that are absent from both systems cannot be detected. |

If A1 or A2 is disproved, the historical advertising comparison needs a reliable activation event history before it can be interpreted. Until that history is available, retain the current adoption count and treat the retention comparison as unavailable. The implementation excludes detectable conflicts; it cannot verify a source guarantee that the API does not provide.

Health thresholds require business validation before operational use. Lead-volume comparisons do not measure enquiry quality or paid-job conversion. Observed LTV covers collected revenue over the available history, and the API provides neither the costs needed for profit nor the future lifetime of active clients.

## Screenshots

Screenshots from the running app, using the supplied API data as at **1 November 2026, 00:00 UTC**.

<details>
<summary>Retention and departure timing</summary>

![Personal three- and six-month retention and departure-age bands](docs/screenshots/retention.png)

</details>

<details>
<summary>Lead results and data coverage</summary>

![Monthly leads by trade, client counts and data coverage](docs/screenshots/leads.png)

</details>

<details>
<summary>Revenue and observed lifetime value</summary>

![Trade economics sorted by observed LTV, including duration and exclusions](docs/screenshots/economics.png)

</details>

<details>
<summary>Advertising and retention</summary>

![Advertising adoption, visible assumptions and fixed-group retention comparison](docs/screenshots/advertising.png)

</details>

<details>
<summary>Cancellation reasons — bonus</summary>

![Voluntary cancellations, payment failures and voluntary feedback](docs/screenshots/cancellations.png)

</details>

<details>
<summary>Mobile layout</summary>

<img src="docs/screenshots/mobile.png" width="390" alt="Client dashboard on a narrow screen with horizontal section navigation" />

</details>

## Implementation map

| Path | Responsibility |
| --- | --- |
| `src/lib/importer.ts` | Bounded GET-only import, pagination and validation |
| `src/lib/store.ts` | Postgres import runs, source records and atomic publication |
| `src/lib/domain.ts` | Pure joins, metric calculations and exclusions |
| `src/lib/dashboard.ts` | Shared server loader for the page and `/api/dashboard` |
| `src/components/dashboard.tsx` | The six views and their interactions |
| `src/lib/*.test.ts` | Synthetic, transport and isolated database checks |
