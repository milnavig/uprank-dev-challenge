import { isDeepStrictEqual } from "node:util";
import type { LeadPayload, RawDataset, RawRecord } from "./contracts";
export type FetchDatasetOptions = { apiKey: string; fetchImpl?: typeof fetch; requestTimeoutMs?: number; totalTimeoutMs?: number; retryDelayMs?: number };
export class ImportError extends Error {
  constructor(public readonly code: string) { super(`Import failed (${code}).`); }
}
const fail = (code: string): never => { throw new ImportError(code); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("INVALID_PAYLOAD");
  return value as Record<string, unknown>;
};
const identity = (value: unknown): string => typeof value === "string" && value.length > 0 && value === value.trim() && value.length <= 512 ? value : fail("INVALID_IDENTITY");
function unique<T>(rows: T[], key: (row: T) => string): T[] {
  const found = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    if (found.has(id) && !isDeepStrictEqual(found.get(id), row)) fail("DUPLICATE_CONFLICT");
    found.set(id, row);
  }
  return [...found.values()];
}
function records(value: unknown): RawRecord[] {
  if (!Array.isArray(value)) return fail("INVALID_PAYLOAD");
  return value.map(value => { const row = object(value); identity(row.id); return row as RawRecord; });
}
function referenceDate(value: string | null): string {
  if (!value) return fail("REFERENCE_INVALID");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) return fail("REFERENCE_INVALID");
  // Date.parse normalizes February 30; reject impossible source calendar dates first.
  const calendar = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date.slice(0, 10)) return fail("REFERENCE_INVALID");
  return new Date(date).toISOString();
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener("abort", onAbort, { once: true }); });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export async function fetchDataset(options: FetchDatasetOptions): Promise<{ data: RawDataset; referenceAt: string }> {
  if (!options.apiKey?.trim()) fail("MISSING_API_KEY");
  const fetchImpl = options.fetchImpl ?? fetch;
  const total = new AbortController();
  const totalTimer = setTimeout(() => total.abort(new ImportError("DEADLINE")), Math.min(options.totalTimeoutMs ?? 180_000, 180_000));
  let referenceAt: string | undefined, totalBytes = 0, count = 0;
  let active = 0;
  const waiting: (() => void)[] = [];
  const addCount = (n: number) => { count += n; if (count > 10_000) fail("RECORD_LIMIT"); };
  async function request(path: string, billing: boolean, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
    if (active >= 4) await abortable(new Promise<void>(resolve => waiting.push(resolve)), total.signal);
    active++;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (total.signal.aborted) throw total.signal.reason;
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(new ImportError("REQUEST_TIMEOUT")), Math.min(options.requestTimeoutMs ?? 15_000, 15_000));
        const signal = AbortSignal.any([total.signal, timeout.signal]);
        let retryAfter = options.retryDelayMs ?? 250;
        try {
          const url = new URL(`https://platform.up-rank.com.au/api/hiring-mock${path}`);
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
          const response = await abortable(fetchImpl(url, {
            method: "GET", redirect: "error", signal,
            headers: billing ? { Authorization: `Bearer ${options.apiKey}` } : { "X-API-Key": options.apiKey },
          }), signal);
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            const retryable = response.status === 429 || response.status >= 500;
            const header = response.headers.get("Retry-After");
            if (header) {
              const seconds = Number(header);
              retryAfter = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
            }
            if (!retryable || attempt === 1) fail(`HTTP_${response.status}`);
          } else {
            const normalized = referenceDate(response.headers.get("X-Mock-Reference-Date"));
            if (referenceAt && referenceAt !== normalized) fail("REFERENCE_CONFLICT");
            referenceAt = normalized;
            const reader = response.body?.getReader();
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
              if (reader) while (true) {
                const part = await abortable(reader.read(), signal);
                if (part.done) break;
                bytes += part.value.byteLength;
                totalBytes += part.value.byteLength;
                if (bytes > 2 * 1024 * 1024) fail("RESPONSE_LIMIT");
                if (totalBytes > 25 * 1024 * 1024) fail("TOTAL_RESPONSE_LIMIT");
                chunks.push(part.value);
              }
            } finally {
              // Cancellation itself can stall on a broken transport; never extend the request deadline.
              if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
            }
            let parsed: unknown;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
            catch { return fail("INVALID_JSON"); }
            return object(parsed);
          }
        } catch (error) {
          if (total.signal.aborted) throw total.signal.reason;
          if (error instanceof ImportError && error.code !== "REQUEST_TIMEOUT") throw error;
          if (attempt === 1) fail(timeout.signal.aborted ? "REQUEST_TIMEOUT" : "TRANSPORT");
        } finally { clearTimeout(timer); }
        await abortable(new Promise<void>(resolve => setTimeout(resolve, Math.min(2000, Math.max(0, retryAfter)))), total.signal);
      }
      return fail("TRANSPORT");
    } finally { active--; waiting.shift()?.(); }
  }
  async function billingList(path: string): Promise<RawRecord[]> {
    const all: RawRecord[] = [], cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 1; page <= 100; page++) {
      const result = await request(`/v1/${path}`, true, { limit: "100", ...(path === "subscriptions" ? { status: "all" } : {}), ...(cursor ? { starting_after: cursor } : {}) });
      const rows = records(result.data);
      if (rows.length > 100 || typeof result.has_more !== "boolean") fail("PAGINATION_INVALID");
      all.push(...rows);
      if (!result.has_more) { const deduped = unique(all, row => row.id); addCount(deduped.length); return deduped; }
      cursor = rows.at(-1)?.id;
      if (!cursor || cursors.has(cursor)) return fail("PAGINATION_STALLED");
      cursors.add(cursor);
    }
    return fail("PAGE_LIMIT");
  }
  async function productList(path: string): Promise<RawRecord[]> {
    const all: RawRecord[] = [];
    let expectedTotal: number | undefined;
    for (let page = 1; page <= 100; page++) {
      const result = await request(`/${path}`, false, { page: String(page), per_page: "100" });
      const rows = records(result.data), n = result.total, pages = result.total_pages;
      if (!Number.isSafeInteger(n) || (n as number) < 0 || !Number.isSafeInteger(pages) || (pages as number) < 0 || result.page !== page || result.per_page !== 100 || (pages !== Math.ceil((n as number) / 100) && !(n === 0 && pages === 1)) || (expectedTotal !== undefined && n !== expectedTotal)) fail("PAGINATION_INVALID");
      if ((pages as number) > 100) fail("PAGE_LIMIT");
      expectedTotal = n as number;
      if (rows.length !== Math.min(100, expectedTotal - (page - 1) * 100)) fail("PAGINATION_INCOMPLETE");
      all.push(...rows);
      if (page >= (pages as number)) { const deduped = unique(all, row => row.id); addCount(deduped.length); return deduped; }
    }
    return fail("PAGE_LIMIT");
  }
  try {
    const [clients, customers, subscriptions, invoices, tickets] = await Promise.all([
      productList("clients"), billingList("customers"), billingList("subscriptions"), billingList("invoices"), productList("support-tickets"),
    ]);
    const leads: LeadPayload[] = new Array(clients.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, clients.length) }, async () => {
      while (next < clients.length) {
        const index = next++, client = clients[index];
        const result = await request(`/clients/${encodeURIComponent(client.id)}/leads`, false);
        if (result.client_id !== client.id || !Array.isArray(result.data)) return fail("INVALID_LEADS_IDENTITY");
        const rows = result.data.map(row => object(row));
        const data = unique(rows, row => identity(row.month));
        leads[index] = { client_id: client.id, data }; addCount(1);
      }
    }));
    if (!referenceAt) fail("REFERENCE_INVALID");
    return { data: { clients, customers, subscriptions, invoices, tickets, leads }, referenceAt: referenceAt! };
  } catch (error) {
    total.abort(error instanceof ImportError ? error : new ImportError("IMPORT_FAILED"));
    throw error instanceof ImportError ? error : new ImportError("IMPORT_FAILED");
  } finally { clearTimeout(totalTimer); }
}
