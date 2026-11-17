import { Database, RefreshCw, TrendingUp } from "lucide-react";
import { Dashboard } from "@/components/dashboard";
import { Button } from "@/components/ui/button";
import { DashboardUnavailable, getDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Page() {
  try { return <Dashboard data={await getDashboard()} />; }
  catch (error) {
    const known = error instanceof DashboardUnavailable;
    return <main className="setup-shell"><a className="brand setup-brand" href="/"><span className="brand-mark"><TrendingUp aria-hidden="true" /></span>UpRank<span className="brand-dot">.</span></a><div className="setup-card"><span className="setup-icon"><Database aria-hidden="true" /></span><p className="eyebrow">DATA UNAVAILABLE</p><h1>Dashboard data unavailable</h1><p>{known ? error.message : "The dashboard could not read a complete snapshot. Check the local application and database, then try again."}</p><div className="setup-steps"><h2>Prepare your local data</h2><ol><li>Configure the server connection in your local environment.</li><li>Initialise the local database with <code>npm run db:init</code>.</li><li>Import a complete snapshot with <code>npm run data:import</code>.</li></ol></div><Button asChild><a href="/"><RefreshCw aria-hidden="true" />Retry dashboard</a></Button><p className="setup-reference">Diagnostic code: <code>{known ? error.code : "internal_error"}</code></p></div></main>;
  }
}
