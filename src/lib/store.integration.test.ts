import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { closeDatabase, importSnapshot, initializeDatabase, loadLatestSnapshot } from "./store";

const referenceAt = "2026-11-01T00:00:00.000Z";
function fixture(clientId = "fixture_client") {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const body = url.pathname.endsWith("/leads") ? { client_id: clientId, data: [{ month: "2026-10", leads: 0 }] }
      : url.pathname.endsWith("/clients") ? { data: [{ id: clientId }], page: 1, per_page: 100, total: 1, total_pages: 1 }
      : url.pathname.endsWith("/support-tickets") ? { data: [], page: 1, per_page: 100, total: 0, total_pages: 0 }
      : { data: [], has_more: false };
    return new Response(JSON.stringify(body), { headers: { "X-Mock-Reference-Date": referenceAt } });
  }) as typeof fetch;
}

afterEach(async () => { await closeDatabase(); });
describe("local database target guard", () => {
  it.each([
    "postgresql://user:password@remote.example/uprank_challenge",
    "postgresql://user:password@127.0.0.1/production",
    "postgresql://user:password@127.0.0.1/uprank_challenge?host=remote.example",
  ])("rejects an unsafe database URL without exposing it", async databaseUrl => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    try {
      await expect(initializeDatabase()).rejects.toMatchObject({ code: "configuration_error" });
    } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("isolated Postgres snapshot persistence (requires TEST_DATABASE_URL)", () => {
  it("durably records running/failed, rolls back partial publication, and reloads the previous complete snapshot", async () => {
    const testUrl = process.env.TEST_DATABASE_URL!;
    const target = new URL(testUrl);
    expect(target.pathname).toBe("/uprank_challenge_test");
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(target.hostname);
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testUrl;
    const inspect = new Pool({ connectionString: testUrl });
    const started = new Date();
    const constraint = `reject_partial_${Date.now()}`;
    let initialized = false;
    try {
      await initializeDatabase();
      initialized = true;
      const first = await importSnapshot({ apiKey: "fixture", fetchImpl: fixture() });
      expect(first.meta.lastImportStatus).toBe("succeeded");
      expect((await loadLatestSnapshot()).data.leads[0].data).toEqual([{ month: "2026-10", leads: 0 }]);
      let release: () => void = () => {};
      const gate = new Promise<void>(resolve => { release = resolve; });
      let entered: () => void = () => {};
      const fetching = new Promise<void>(resolve => { entered = resolve; });
      const pending = importSnapshot({ apiKey: "secret", retryDelayMs: 0, fetchImpl: (async () => { entered(); await gate; throw new Error("secret raw provider error"); }) as typeof fetch });
      await fetching;
      expect((await loadLatestSnapshot()).meta.lastImportStatus).toBe("running");
      release();
      await expect(pending).rejects.toThrow("TRANSPORT");
      expect((await loadLatestSnapshot()).meta).toMatchObject({ snapshotId: first.meta.snapshotId, lastImportStatus: "failed" });
      await inspect.query(`ALTER TABLE source_records ADD CONSTRAINT ${constraint} CHECK (source_id <> 'reject_partial') NOT VALID`);
      await expect(importSnapshot({ apiKey: "fixture", fetchImpl: fixture("reject_partial") })).rejects.toMatchObject({ code: "storage_unavailable" });
      await closeDatabase();
      const reloaded = await loadLatestSnapshot();
      expect(reloaded.meta.snapshotId).toBe(first.meta.snapshotId);
      expect(reloaded.data).toEqual(first.data);
      const runs = await inspect.query("SELECT id, status, error_code FROM import_runs WHERE started_at >= $1 ORDER BY sequence", [started]);
      expect(runs.rows.map(row => row.status)).toEqual(["succeeded", "failed", "failed"]);
      expect(runs.rows[1].error_code).toBe("TRANSPORT");
      const unpublished = await inspect.query("SELECT count(*)::integer AS count FROM source_records r JOIN import_runs i ON i.id=r.run_id WHERE i.status <> 'succeeded' AND i.started_at >= $1", [started]);
      expect(unpublished.rows[0].count).toBe(0);
    } finally {
      if (initialized) {
        await inspect.query(`ALTER TABLE source_records DROP CONSTRAINT IF EXISTS ${constraint}`);
        await inspect.query("DELETE FROM import_runs WHERE started_at >= $1", [started]);
      }
      await inspect.end();
      await closeDatabase();
      if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    }
  });
});
