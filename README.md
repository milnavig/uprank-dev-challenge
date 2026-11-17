# UpRank decision dashboard

A one-page dashboard for a subscription business serving trade companies. Billing and product data are joined on the server, with client call priorities shown first.

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

Tables have sortable headings and horizontal controls where needed. Navigation follows the visible section; counts, exclusions and uncertainty remain alongside the results.

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

Import makes bounded **GET-only** requests to the supplied billing and product APIs and publishes a complete Postgres snapshot atomically. Page reloads read that snapshot. Run `npm run data:import` explicitly to refresh it; the UI displays the source reference date and import time separately.

A failed import preserves the previous complete snapshot with a warning. Without a complete snapshot, the page gives setup instructions instead of sample metrics.

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

## Data and metric choices

- **Health:** explainable weighted signals, with missing inputs marked provisional. The score prioritises calls; it is not a cancellation probability.
- **Retention:** subscription state at each client's personal three-/six-calendar-month anniversary. Each horizon has its own mature denominator; reactivation can count at the anniversary.
- **Leads:** the latest three complete UTC calendar months. Explicit zeros count; missing months lower coverage. Averages give each included client equal weight within a trade.
- **Revenue and observed LTV:** net paid cash and observed client-months over the same eligible population. Active clients are measured up to the reference date. LTV is historical value, not a forecast or profit.
- **Advertising:** groups are fixed at the first-month landmark. Historical activation semantics require the visible A1/A2 assumptions; the comparison is descriptive and does not establish causation.

[WRITEUP.md](WRITEUP.md) explains the architecture, definitions, tradeoffs and bonus rationale. [REVIEWER-GUIDE.md](REVIEWER-GUIDE.md) provides an acceptance walkthrough and reference values.

## Screenshots

Captured from the running application using the supplied API snapshot at **1 November 2026, 00:00 UTC**. Values are computed from imported data; no dashboard fixture is used for these images.

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

The browser receives prepared metrics, not contacts, full source payloads or the API key. Secrets and database snapshots are not included in the repository.

This is a **local review setup** without authentication or public hosting. The app binds to loopback; Postgres is exposed on `127.0.0.1:55432`. Database writes are restricted to the dedicated local `uprank_challenge` and `uprank_challenge_test` databases, without URL query overrides. There is no scheduled sync or source mutation.

Adapted UI primitives retain their origin and MIT notice in [LICENSE.shadcn.md](src/components/ui/LICENSE.shadcn.md).
