import { describe, expect, it } from "vitest";
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
      expect(init?.method).toBe("GET");
      const headers = new Headers(init?.headers);
      if (url.pathname.includes("/v1/")) {
        expect(headers.get("Authorization")).toBe("Bearer test-key");
        expect(headers.has("X-API-Key")).toBe(false);
        expect(url.searchParams.get("limit")).toBe("100");
      } else {
        expect(headers.get("X-API-Key")).toBe("test-key");
        expect(headers.has("Authorization")).toBe(false);
      }
      if (url.pathname.endsWith("/subscriptions")) expect(url.searchParams.get("status")).toBe("all");
      if (url.pathname.endsWith("/customers")) return response(url.searchParams.has("starting_after") ? billing([{ id: "cus_2" }]) : billing([{ id: "cus_1" }], true));
      if (url.pathname.endsWith("/clients")) {
        const page = Number(url.searchParams.get("page"));
        return response(product(page === 1 ? clients.slice(0, 100) : clients.slice(100), page, 101));
      }
    }) });
    expect(result.referenceAt).toBe(referenceAt);
    expect(result.data.customers.map(x => x.id)).toEqual(["cus_1", "cus_2"]);
    expect(result.data.clients).toHaveLength(101);
    expect(result.data.leads).toHaveLength(101);
    expect(calls.filter(x => x.pathname.endsWith("/leads"))).toHaveLength(101);
    expect(calls.some(x => x.searchParams.get("starting_after") === "cus_1")).toBe(true);
  });

  it("preserves dirty optional fields for the domain", async () => {
    const result = await fetchDataset({ apiKey: "test", fetchImpl: source() });
    expect(result.data.clients[0].ads).toEqual({ enabled: "dirty" });
  });

  it("normalizes a calendar-only reference header to UTC midnight and matches timestamp responses", async () => {
    const result = await fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing(), "2026-11-01") : undefined) });
    expect(result.referenceAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it.each(["2026-02-30", "2026-02-30T00:00:00.000Z"])("rejects an impossible calendar reference date (%s)", async date => {
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing(), date) : undefined) })).rejects.toThrow("REFERENCE_INVALID");
  });

  it.each([null, "2026-10-01T00:00:00.000Z", "invalid"])("rejects missing, conflicting or invalid reference dates (%s)", async date => {
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/leads") ? response({ client_id: "cl_1", data: [] }, date) : undefined) })).rejects.toThrow(/REFERENCE/);
  });

  it("deduplicates equal IDs regardless of key order and rejects conflicting duplicate IDs", async () => {
    const good = await fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing([{ id: "a", name: "one" }, { name: "one", id: "a" }])) : undefined) });
    expect(good.data.customers).toHaveLength(1);
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing([{ id: "a" }, { id: "a", name: "different" }])) : undefined) })).rejects.toThrow(/DUPLICATE_CONFLICT/);
  });

  it.each([
    ["/customers", { data: [{ id: "a" }], has_more: "yes" }, "PAGINATION_INVALID"],
    ["/clients", { ...product(), total_pages: 2 }, "PAGINATION_INVALID"],
    ["/clients", product([{ id: 2 }]), "INVALID_IDENTITY"],
    ["/customers", billing([{ id: " cus_padded" }]), "INVALID_IDENTITY"],
    ["/clients", product([{ id: "cl_padded " }]), "INVALID_IDENTITY"],
    ["/leads", { client_id: "wrong", data: [] }, "INVALID_LEADS_IDENTITY"],
    ["/leads", { client_id: "cl_1", data: [{ month: "2026-01", leads: 2 }, { month: "2026-01", leads: 3 }] }, "DUPLICATE_CONFLICT"],
  ])("rejects malformed identity or completeness metadata on %s", async (path, body, code) => {
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith(path as string) ? response(body) : undefined) })).rejects.toThrow(code as string);
  });

  it("rejects a cursor that fails to advance", async () => {
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? response(billing([{ id: "same" }], true)) : undefined) })).rejects.toThrow(/PAGINATION/);
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
      await expect(task).rejects.toThrow(status === 401 ? "HTTP_401" : status === 0 ? "TRANSPORT" : `HTTP_${status}`);
      expect(calls).toBe(status === 401 ? 1 : 2);
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
    expect(result.data.leads).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("bounds hung transports and oversized streamed bodies without leaking errors", async () => {
    await expect(fetchDataset({ apiKey: "secret", requestTimeoutMs: 10, totalTimeoutMs: 30, retryDelayMs: 0, fetchImpl: (() => new Promise(() => {})) as typeof fetch })).rejects.toThrow(/TIMEOUT|DEADLINE/);
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/customers") ? new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "X-Mock-Reference-Date": referenceAt } }) : undefined) })).rejects.toThrow(/RESPONSE_LIMIT/);
  });

  it("bounds a response whose body reader and cancel operation never finish", async () => {
    const task = fetchDataset({ apiKey: "test", requestTimeoutMs: 5, totalTimeoutMs: 20, retryDelayMs: 0, fetchImpl: source(url => url.pathname.endsWith("/customers") ? new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) }), { headers: { "X-Mock-Reference-Date": referenceAt } }) : undefined) });
    await expect(Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error("test wait exceeded")), 150))])).rejects.toThrow(/TIMEOUT|DEADLINE/);
  });

  it("rejects snapshots above the total byte, record and page caps", async () => {
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => url.pathname.endsWith("/clients") ? response({ ...product(), total: 10001, total_pages: 101 }) : undefined) })).rejects.toThrow("PAGE_LIMIT");
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => {
      if (url.pathname.includes("/v1/")) {
        const offset = url.searchParams.has("starting_after") ? Number(url.searchParams.get("starting_after")!.split("_").at(-1)) + 1 : 0;
        return response(billing(Array.from({ length: 100 }, (_, i) => ({ id: `id_${offset + i}` })), offset < 3300));
      }
    }) })).rejects.toThrow("RECORD_LIMIT");
    await expect(fetchDataset({ apiKey: "test", fetchImpl: source(url => {
      if (url.pathname.endsWith("/clients")) return response(product(Array.from({ length: 30 }, (_, i) => ({ id: `cl_${i}` }))));
      if (url.pathname.endsWith("/leads")) return response({ client_id: url.pathname.split("/").at(-2), data: [{ month: "2026-01", extra: "x".repeat(1024 * 1024) }] });
    }) })).rejects.toThrow("TOTAL_RESPONSE_LIMIT");
  });
});
