import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { RawDataset, SnapshotMeta } from "./contracts";
import { fetchDataset, ImportError, type FetchDatasetOptions } from "./importer";

export class StoreError extends Error {
  constructor(public readonly code: "data_unavailable" | "configuration_error" | "storage_unavailable") {
    super(code === "data_unavailable" ? "No complete snapshot is available. Run the local data import." : code === "configuration_error" ? "Configure a dedicated local challenge database." : "The local snapshot store is unavailable.");
  }
}
let pool: Pool | undefined;
function database(): Pool {
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL ?? ""); }
  catch { throw new StoreError("configuration_error"); }
  // Query overrides can redirect pg to a different host/database despite a safe URL authority.
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["/uprank_challenge", "/uprank_challenge_test"].includes(url.pathname) || url.search || url.hash) throw new StoreError("configuration_error");
  if (!pool) {
    pool = new Pool({ connectionString: url.toString(), max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000, statement_timeout: 10_000 });
    // A dropped idle connection must not terminate the application or log credentials.
    pool.on("error", () => {});
  }
  return pool;
}
const safeStorageError = (error: unknown): StoreError => error instanceof StoreError ? error : new StoreError("storage_unavailable");
export async function initializeDatabase(): Promise<void> {
  try {
    await database().query(`
      CREATE TABLE IF NOT EXISTS import_runs (
        id uuid PRIMARY KEY,
        sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
        status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
        started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        completed_at timestamptz,
        reference_at timestamptz,
        counts jsonb,
        error_code text,
        CHECK (status <> 'succeeded' OR (completed_at IS NOT NULL AND reference_at IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS source_records (
        run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('customer','subscription','invoice','client','leads','support_ticket')),
        source_id text NOT NULL,
        payload jsonb NOT NULL,
        PRIMARY KEY (run_id, kind, source_id)
      );
    `);
  } catch (error) { throw safeStorageError(error); }
}
export async function closeDatabase(): Promise<void> {
  const current = pool; pool = undefined;
  if (current) await current.end();
}
const kinds = { clients: "client", customers: "customer", subscriptions: "subscription", invoices: "invoice", tickets: "support_ticket", leads: "leads" } as const;
function metadata(row: { id: string; reference_at: Date; completed_at: Date }, status: SnapshotMeta["lastImportStatus"]): SnapshotMeta {
  return { snapshotId: row.id, referenceAt: row.reference_at.toISOString(), importedAt: row.completed_at.toISOString(), lastImportStatus: status };
}
export async function loadLatestSnapshot(): Promise<{ data: RawDataset; meta: SnapshotMeta }> {
  let client: PoolClient | undefined;
  try {
    client = await database().connect();
    // Select the run once and read its complete records under one stable database snapshot.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const runs = await client.query("SELECT id,reference_at,completed_at FROM import_runs WHERE status='succeeded' ORDER BY sequence DESC LIMIT 1");
    if (!runs.rowCount) throw new StoreError("data_unavailable");
    const latest = await client.query("SELECT status FROM import_runs ORDER BY sequence DESC LIMIT 1");
    const records = await client.query("SELECT kind,payload FROM source_records WHERE run_id=$1 ORDER BY kind,source_id", [runs.rows[0].id]);
    const data: RawDataset = { clients: [], customers: [], subscriptions: [], invoices: [], tickets: [], leads: [] };
    for (const [key, kind] of Object.entries(kinds)) {
      // JSONB payloads were accepted at the importer boundary; field-level validation remains in domain.
      (data[key as keyof RawDataset] as unknown[]) = records.rows.filter(row => row.kind === kind).map(row => row.payload);
    }
    await client.query("COMMIT");
    return { data, meta: metadata(runs.rows[0], latest.rows[0].status) };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw safeStorageError(error);
  } finally { client?.release(); }
}
export async function importSnapshot(options: FetchDatasetOptions): Promise<{ data: RawDataset; meta: SnapshotMeta }> {
  const id = randomUUID();
  const db = database();
  try { await db.query("INSERT INTO import_runs(id,status) VALUES ($1,'running')", [id]); }
  catch { throw new StoreError("storage_unavailable"); }
  let client: PoolClient | undefined;
  try {
    const { data, referenceAt } = await fetchDataset(options);
    client = await db.connect();
    await client.query("BEGIN");
    const counts: Record<string, number> = {};
    for (const [key, kind] of Object.entries(kinds)) {
      const rows = data[key as keyof RawDataset];
      counts[kind] = rows.length;
      for (let offset = 0; offset < rows.length; offset += 250) {
        const batch = rows.slice(offset, offset + 250);
        const ids = batch.map(row => "client_id" in row && kind === "leads" ? row.client_id : (row as { id: string }).id);
        await client.query("INSERT INTO source_records(run_id,kind,source_id,payload) SELECT $1,$2,unnest($3::text[]),unnest($4::jsonb[])", [id, kind, ids, batch.map(row => JSON.stringify(row))]);
      }
    }
    const result = await client.query("UPDATE import_runs SET status='succeeded', completed_at=clock_timestamp(), reference_at=$2, counts=$3 WHERE id=$1 RETURNING id,reference_at,completed_at", [id, referenceAt, JSON.stringify(counts)]);
    await client.query("COMMIT");
    return { data, meta: metadata(result.rows[0], "succeeded") };
  } catch (error) {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); client = undefined; }
    const safe = error instanceof ImportError ? error : safeStorageError(error);
    try { await db.query("UPDATE import_runs SET status='failed',completed_at=clock_timestamp(),error_code=$2 WHERE id=$1 AND status='running'", [id, safe.code]); }
    catch { throw new StoreError("storage_unavailable"); }
    throw safe;
  } finally { client?.release(); }
}
