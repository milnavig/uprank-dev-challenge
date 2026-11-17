# UpRank decision dashboard

A one-page dashboard built with Next.js, TypeScript and Postgres. It combines the supplied billing and product APIs to show client call priorities, retention, leads by trade, revenue and observed LTV, and advertising adoption/retention. The bonus separates voluntary cancellations from payment failures and summarises voluntary feedback.

## Run locally

Requirements: Node.js 22.12+ and a running Docker Linux engine. Commands below run from the repository root.

```sh
npm ci
```

Copy `.env.example` to `.env` and replace `API_KEY` with the supplied hiring-mock key. The included database URL and Compose credentials are for this dedicated local database only.

```sh
docker compose -p uprank-challenge up -d --wait postgres
npm run db:init
npm run data:import
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). If Docker Desktop uses a named Linux context, prefix the Docker command with `docker --context desktop-linux compose ...`.

For a production-mode local run, stop the development server and run:

```sh
npm run build
npm run start
```

Import makes bounded GET requests to both mock APIs and publishes a complete Postgres snapshot atomically. Reloading the dashboard reads that snapshot; it does not repeat the import. Run `npm run data:import` explicitly to refresh. A failed import preserves the previous complete snapshot with a warning. Without a complete snapshot, the page explains how to prepare the data.

The app binds to loopback and has no authentication. Postgres is exposed only on `127.0.0.1:55432` and uses a named volume. The database guard permits only loopback connections to `uprank_challenge` or `uprank_challenge_test`, without URL query overrides. This is a local review setup.

## Check

```sh
npm run typecheck
npm test
npm run build
```

The real-Postgres integration case requires a separate database. Create it once; omit `createdb` if it already exists:

```sh
docker compose -p uprank-challenge exec -T postgres createdb -U uprank uprank_challenge_test
```

Then run all tests with the test connection. PowerShell:

```powershell
$env:TEST_DATABASE_URL='postgresql://uprank:uprank_local_only@127.0.0.1:55432/uprank_challenge_test'
npm test
```

macOS/Linux shell:

```sh
TEST_DATABASE_URL=postgresql://uprank:uprank_local_only@127.0.0.1:55432/uprank_challenge_test npm test
```

With the test connection, all 60 tests run. Without it, 59 run and the real-Postgres case is explicitly skipped. The tests cover domain boundaries and missing data, importer pagination/retries/limits, database rollback and snapshot recovery, formatting and canonical-value sorting. There is no separate lint script.

Dependency audit, 17 November 2026: `npm audit --omit=dev` reported no production dependency findings. The full audit reported five high-severity package entries in the Vitest/Vite development chain, originating from the [picomatch ReDoS advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), which lists no patched version. Dependency versions were preserved rather than applying npm's proposed major-version downgrade automatically.

## Review

- [Implementation decisions](WRITEUP.md): metric definitions, architecture, tradeoffs, advertising assumptions and bonus rationale.
- [Acceptance walkthrough](REVIEWER-GUIDE.md): reviewer checks and reference values for the supplied snapshot.
- `src/lib/domain.ts`: pure server calculations and exclusions.
- `src/lib/importer.ts`: GET-only source import and validation.
- `src/lib/store.ts`: Postgres snapshots and atomic publication.
- `src/lib/dashboard.ts`: shared loader for the page and `GET /api/dashboard`.
- `src/components/dashboard.tsx`: presentation and interactions.
- `src/components/ui/LICENSE.shadcn.md`: origin and MIT notice for adapted UI primitives.

Retention is measured at personal three-/six-calendar-month anniversaries. Missing leads are not zero. Revenue pools net paid cash and client-months; observed LTV is historical cash per eligible client, not a forecast. Advertising groups are fixed at month 1 and the comparison is explicitly assumption-based; it does not establish causation.

The repository contains source and synthetic test fixtures, not an API key or a database snapshot. Configure your own local `.env` and run the import to obtain data.
