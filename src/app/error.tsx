"use client";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="setup-shell"><div className="setup-card" role="alert"><span className="setup-icon"><TriangleAlert aria-hidden="true" /></span><p className="eyebrow">PAGE ERROR</p><h1>Dashboard unavailable</h1><p>The page encountered an unexpected error. Retry the view, or check the local application if the issue continues.</p><Button onClick={reset}><RefreshCw aria-hidden="true" />Try again</Button></div></main>;
}
