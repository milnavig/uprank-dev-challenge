import { DashboardUnavailable, getDashboard } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getDashboard(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safe = error instanceof DashboardUnavailable
      ? error
      : new DashboardUnavailable("internal_error", "The dashboard could not be prepared.");
    return Response.json(
      { error: { code: safe.code, message: safe.message } },
      { status: safe.code === "data_unavailable" ? 503 : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
