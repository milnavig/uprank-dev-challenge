import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchDataset } from "./importer";

const referenceAt = "2026-11-01T00:00:00.000Z";
const response = (body: unknown, date: string | null = referenceAt, status = 200) => new Response(JSON.stringify(body), {
  status, headers: date ? { "X-Mock-Reference-Date": date } : {},
});
const product = (data: unknown[] = [], page = 1, total = data.length) => ({ data, page, per_page: 100, total, total_pages: Math.max(1, Math.ceil(total / 100)) });
const billing = (data: unknown[] = [], has_more = false) => ({ data, has_more });
function source(override?: (url: URL, init?: RequestInit) => Response | Promise<Response | undefined> | undefined) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const custom = await override?.(url, init);
    if (custom) return custom;
    if (url.pathname.endsWith("/clients")) return response(product([{ id: "cl_1", ads: { enabled: "dirty" } }]));
    if (url.pathname.endsWith("/support-tickets")) return response(product());
    if (url.pathname.endsWith("/leads")) return response({ client_id: url.pathname.split("/").at(-2), data: [] });
    return response(billing());
  }) as typeof fetch;
}

describe("fetchDataset", () => {
  it("walks both pagination contracts, requests all subscriptions, and every client's leads", async () => {
    const calls: URL[] = [];
    const clients = Array.from({ length: 101 }, (_, i) => ({ id: `cl_${i}` }));
    const result = await fetchDataset({ apiKey: "test-key", fetchImpl: source((url, init) => {
      calls.push(url);
      assert.strictEqual(init?.method, "GET");
      const headers = new Headers(init?.headers);
      if (url.pathname.includes("/v1/")) {
        assert.strictEqual(headers.get("Authorization"), "Bearer test-key");
        assert.strictEqual(headers.has("X-API-Key"), false);
        assert.strictEqual(url.searchParams.get("limit"), "100");
      } else {
        assert.strictEqual(headers.get("X-API-Key"), "test-key");
        assert.strictEqual(headers.has("Authorization"), false);
      }
      if (url.pathname.endsWith("/subscriptions")) assert.strictEqual(url.searchParams.get("status"), "all");
      if (url.pathname.endsWith("/customers")) return response(url.searchParams.has("starting_after") ? billing([{ id: "cus_2" }]) : billing([{ id: "cus_1" }], true));
      if (url.pathname.endsWith("/clients")) {
        const page = Number(url.searchParams.get("page"));
        return response(product(page === 1 ? clients.slice(0, 100) : clients.slice(100), page, 101));
      }
    }) });
    assert.strictEqual(result.referenceAt, referenceAt);
    assert.deepStrictEqual(result.data.customers.map(x => x.id), ["cus_1", "cus_2"]);
    assert.strictEqual((result.data.clients).length, 101);
    assert.strictEqual((result.data.leads).length, 101);
    assert.strictEqual((calls.filter(x => x.pathname.endsWith("/leads"))).length, 101);
    assert.strictEqual(calls.some(x => x.searchParams.get("starting_after") === "cus_1"), true);
  });

  it("preserves dirty optional fields for the domain", async () => {
    const result = await fetchDataset({ apiKey: "test", fetchImpl: source() });
    assert.deepStrictEqual(result.data.clients[0].ads, { enabled: "dirty" });
  });

  it("normalizes a calendar-only reference header to UTC midnight and matches timestamp responses", async () => {
    const result = await fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing(), "2026-11-01") : undefined) });
    assert.strictEqual(result.referenceAt, "2026-11-01T00:00:00.000Z");
  });

  for (const date of ["2026-02-30", "2026-02-30T00:00:00.000Z"]) {
    it("rejects an impossible calendar reference date (%s)".replace("%s", String(date)), async () => {
      await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing(), date) : undefined) }), { message: new RegExp("REFERENCE_INVALID") });
    });
  }

  for (const date of [null, "2026-10-01T00:00:00.000Z", "invalid"]) {
    it("rejects missing, conflicting or invalid reference dates (%s)".replace("%s", String(date)), async () => {
      await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/leads") ? response({ client_id: "cl_1", data: [] }, date) : undefined) }), { message: new RegExp(/REFERENCE/) });
    });
  }

  it("deduplicates equal IDs regardless of key order and rejects conflicting duplicate IDs", async () => {
    const good = await fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing([{ id: "a", name: "one" }, { name: "one", id: "a" }])) : undefined) });
    assert.strictEqual((good.data.customers).length, 1);
    await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing([{ id: "a" }, { id: "a", name: "different" }])) : undefined) }), { message: new RegExp(/DUPLICATE_CONFLICT/) });
  });

  for (const [path, body, code] of [
    ["/customers", { data: [{ id: "a" }], has_more: "yes" }, "PAGINATION_INVALID"],
    ["/clients", { ...product(), total_pages: 2 }, "PAGINATION_INVALID"],
    ["/clients", product([{ id: 2 }]), "INVALID_IDENTITY"],
    ["/customers", billing([{ id: " cus_padded" }]), "INVALID_IDENTITY"],
    ["/clients", product([{ id: "cl_padded " }]), "INVALID_IDENTITY"],
    ["/leads", { client_id: "wrong", data: [] }, "INVALID_LEADS_IDENTITY"],
    ["/leads", { client_id: "cl_1", data: [{ month: "2026-01", leads: 2 }, { month: "2026-01", leads: 3 }] }, "DUPLICATE_CONFLICT"],
  ]) {
    it("rejects malformed identity or completeness metadata on %s".replace("%s", String(path)), async () => {
      await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith(path as string) ? response(body) : undefined) }), { message: new RegExp(code as string) });
    });
  }

  it("rejects a cursor that fails to advance", async () => {
    await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing([{ id: "same" }], true)) : undefined) }), { message: new RegExp(/PAGINATION/) });
  });

  it("retries transport, 429 and 5xx at most once; never retries authorization", async () => {
    for (const status of [0, 429, 503, 401]) {
      let calls = 0;
      const task = fetchDataset({ apiKey: "secret", retryDelayMs: 0, fetchImpl: source(url => {
        if (!url.pathname.endsWith("/customers")) return;
        calls++;
        if (status === 0) throw new Error("secret upstream payload");
        return response({ error: "secret upstream payload" }, referenceAt, status);
      }) });
      await assert.rejects(task, { message: new RegExp(status === 401 ? "HTTP_401" : status === 0 ? "TRANSPORT" : `HTTP_${status}`) });
      assert.strictEqual(calls, status === 401 ? 1 : 2);
    }
  });

  it("bounds concurrency to four including all lead reads", async () => {
    let active = 0, peak = 0;
    const result = await fetchDataset({ apiKey: "test", fetchImpl: source(async url => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (url.pathname.endsWith("/clients")) return response(product(Array.from({ length: 12 }, (_, i) => ({ id: `cl_${i}` }))));
    }) });
    assert.strictEqual((result.data.leads).length, 12);
    assert.ok(peak <= 4);
  });

  it("bounds hung transports and oversized streamed bodies without leaking errors", async () => {
    await assert.rejects(fetchDataset({ apiKey: "secret", requestTimeoutMs: 10, totalTimeoutMs: 30, retryDelayMs: 0, fetchImpl: (() => new Promise(() => {})) as typeof fetch }), { message: new RegExp(/TIMEOUT|DEADLINE/) });
    await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "X-Mock-Reference-Date": referenceAt } }) : undefined) }), { message: new RegExp(/RESPONSE_LIMIT/) });
  });

  it("bounds a response whose body reader and cancel operation never finish", async () => {
    const task = fetchDataset({ apiKey: "test", requestTimeoutMs: 5, totalTimeoutMs: 20, retryDelayMs: 0, fetchImpl: source(url => url.pathname.endsWith("/customers") ? new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) }), { headers: { "X-Mock-Reference-Date": referenceAt } }) : undefined) });
    await assert.rejects(Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error("test wait exceeded")), 150))]), { message: new RegExp(/TIMEOUT|DEADLINE/) });
  });

  it("rejects snapshots above the total byte, record and page caps", async () => {
    await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/clients") ? response({ ...product(), total: 10001, total_pages: 101 }) : undefined) }), { message: new RegExp("PAGE_LIMIT") });
    await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => {
      if (url.pathname.includes("/v1/")) {
        const offset = url.searchParams.has("starting_after") ? Number(url.searchParams.get("starting_after")!.split("_").at(-1)) + 1 : 0;
        return response(billing(Array.from({ length: 100 }, (_, i) => ({ id: `id_${offset + i}` })), offset < 3300));
      }
    }) }), { message: new RegExp("RECORD_LIMIT") });
    await assert.rejects(fetchDataset({ apiKey: "test", fetchImpl: source(url => {
      if (url.pathname.endsWith("/clients")) return response(product(Array.from({ length: 30 }, (_, i) => ({ id: `cl_${i}` }))));
      if (url.pathname.endsWith("/leads")) return response({ client_id: url.pathname.split("/").at(-2), data: [{ month: "2026-01", extra: "x".repeat(1024 * 1024) }] });
    }) }), { message: new RegExp("TOTAL_RESPONSE_LIMIT") });
  });
});
