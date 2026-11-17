"use client";

import { useEffect, useState } from "react";
import { Activity, ArrowDown, ArrowUp, ArrowUpDown, BarChart3, ChevronDown, Clock3, Database, Info, Layers3, Megaphone, Phone, ShieldCheck, TriangleAlert, TrendingUp, Users } from "lucide-react";
import type { DashboardData, HorizonResult, RiskClient } from "@/lib/contracts";
import { formatAud, formatCount as count, formatDecimal, formatLeadPeriod, formatPercent, formatPercentagePoints, formatTrade, formatUtc } from "@/lib/format";
import { sortRows, type SortDirection } from "@/lib/sort";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const navigation = [
  { href: "#priorities", label: "Client priorities", icon: Phone },
  { href: "#retention", label: "Retention", icon: Users },
  { href: "#leads", label: "Lead performance", icon: BarChart3 },
  { href: "#economics", label: "Revenue & LTV", icon: TrendingUp },
  { href: "#advertising", label: "Advertising", icon: Megaphone },
  { href: "#cancellations", label: "Cancellation reasons", icon: Layers3 },
];

const qualityNotes: Record<string, { title: string; detail: string }> = {
  missing_billing_join: {
    title: "Clients without linked billing",
    detail: "No matching billing account was found. Metrics that require subscription or payment history exclude these clients.",
  },
  short_economic_history: {
    title: "Clients with short service history",
    detail: "Less than one standard month of service has been observed. These clients are excluded from revenue and LTV comparisons.",
  },
  unlinked_billing_customer: {
    title: "Billing accounts without a matching client",
    detail: "These accounts are excluded from client-based comparisons because they cannot be linked to a client record.",
  },
};

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="section-heading"><div><h2>{title}</h2><p className="section-description">{description}</p></div></div>;
}

function nextSort<Key extends string>(current: { key: Key; direction: SortDirection }, key: Key): { key: Key; direction: SortDirection } {
  return { key, direction: current.key === key ? current.direction === "desc" ? "asc" : "desc" : key === "trade" ? "asc" : "desc" };
}

function SortHeading({ label, active, direction, onSort, disabled = false }: { label: string; active: boolean; direction: SortDirection; onSort: () => void; disabled?: boolean }) {
  const Icon = active ? direction === "desc" ? ArrowDown : ArrowUp : ArrowUpDown;
  return <TableHead aria-sort={disabled ? undefined : active ? direction === "desc" ? "descending" : "ascending" : "none"}><button className="sort-heading" type="button" disabled={disabled} onClick={onSort}>{label}{!disabled && <Icon aria-hidden="true" />}</button></TableHead>;
}

function HorizonContext({ result }: { result: HorizonResult }) {
  return <div className="horizon-context">
    <p><strong>{count(result.retainedCount)}</strong> retained of <strong>{count(result.eligibleCount)}</strong> eligible clients</p>
    <div className="context-grid">
      <span>{count(result.notRetainedCount)} not retained</span>
      {result.notMaturedCount > 0 && <span>{count(result.notMaturedCount)} not yet {result.months} months</span>}
      {result.unknownStartCount > 0 && <span>{count(result.unknownStartCount)} unknown start date</span>}
      {result.unknownOutcomeCount > 0 && <span>{count(result.unknownOutcomeCount)} unknown subscription state</span>}
      {result.estimatedDateCount > 0 && <span>{count(result.estimatedDateCount)} using estimated dates</span>}
    </div>
    {result.smallSample && <Badge variant="warning">Small sample · fewer than 5 eligible clients</Badge>}
    {result.value === null && <p className="muted">No eligible clients with a known outcome.</p>}
  </div>;
}

function RiskRow({ client, index }: { client: RiskClient; index: number }) {
  const partial = client.assessed < client.applicable;
  const level = client.risk >= 50 ? "High" : client.risk >= 20 ? "Medium" : "Low";
  return <li className="risk-row"><div className="queue-rank" aria-label={`Priority ${index + 1}`}>{String(index + 1).padStart(2, "0")}</div>
    <div className="client-info"><div className="client-title"><h3>{client.businessName}</h3><Badge variant={level === "High" ? "danger" : level === "Medium" ? "warning" : "outline"}>{level} priority</Badge></div><p className="client-trade">{formatTrade(client.trade)}</p>
      <ul className="risk-reasons">{client.reasons.map((reason, i) => <li key={`${reason}-${i}`}><span aria-hidden="true" />{reason}</li>)}</ul>
      <details className="signal-details"><summary>View signals · {count(client.assessed)}/{count(client.applicable)} assessed <ChevronDown aria-hidden="true" /></summary><ul>{client.signals.map(signal => <li key={signal.id}><span>{signal.label}</span><span className={`signal-${signal.state}`}>{signal.state === "triggered" ? `Flagged · −${count(signal.weight)} health` : signal.state === "clear" ? "Clear" : signal.state === "unknown" ? "Unknown" : "Not applicable"}</span></li>)}</ul></details>
    </div><div className="health-score"><span className="score-label">Health score</span><strong>{count(client.health)}<span>/100</span></strong><span className={partial ? "provisional" : "muted"}>{partial ? "Provisional" : "Assessed"}</span></div>
  </li>;
}

export function Dashboard({ data }: { data: DashboardData }) {
  const [showAll, setShowAll] = useState(false);
  const [leadSort, setLeadSort] = useState<{ key: "trade" | "value" | "nClients" | "coverage"; direction: SortDirection }>({ key: "value", direction: "desc" });
  const [economicSort, setEconomicSort] = useState<{ key: "trade" | "monthlyRevenueAud" | "observedLtvAud" | "avgObservedMonths"; direction: SortDirection }>({ key: "observedLtvAud", direction: "desc" });
  const leadRows = sortRows(data.leadsByTrade, row => row[leadSort.key], leadSort.direction);
  const economicRows = sortRows(data.economicsByTrade, row => row[economicSort.key], economicSort.direction);
  const [activeSection, setActiveSection] = useState(navigation[0].href);
  useEffect(() => {
    let frame = 0;
    function updateSection() {
      frame = 0;
      let current = navigation[0].href;
      const readingLine = window.matchMedia("(max-width: 760px)").matches ? 200 : 160;
      for (const { href } of navigation) {
        const section = document.getElementById(href.slice(1));
        if (section && section.getBoundingClientRect().top <= readingLine) current = href;
      }
      // The last section may be too short to reach the reading line.
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = navigation[navigation.length - 1].href;
      setActiveSection(current);
    }
    function scheduleUpdate() {
      if (!frame) frame = window.requestAnimationFrame(updateSection);
    }
    function followHash() {
      const target = navigation.find(item => item.href === window.location.hash);
      if (target) document.getElementById(target.href.slice(1))?.scrollIntoView({ behavior: "instant", block: "start" });
      scheduleUpdate();
    }
    // Streaming can mount the section after the browser's initial anchor scroll.
    followHash();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("hashchange", followHash);
    window.addEventListener("pageshow", followHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("hashchange", followHash);
      window.removeEventListener("pageshow", followHash);
    };
  }, []);
  useEffect(() => {
    const link = document.querySelector<HTMLAnchorElement>(".sidebar a[aria-current='location']");
    const menu = link?.parentElement;
    if (link && menu && menu.scrollWidth > menu.clientWidth) {
      menu.scrollLeft = link.offsetLeft - menu.offsetLeft - (menu.clientWidth - link.offsetWidth) / 2;
    }
  }, [activeSection]);
  const visibleClients = showAll ? data.atRisk.rows : data.atRisk.rows.slice(0, 10);
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to dashboard</a>
    <aside className="sidebar" aria-label="Dashboard navigation"><a className="brand" href="#main"><span className="brand-mark"><TrendingUp aria-hidden="true" /></span>UpRank<span className="brand-dot">.</span></a><nav>{navigation.map(({ href, label, icon: Icon }) => <a key={href} href={href} aria-current={activeSection === href ? "location" : undefined} className={activeSection === href ? "nav-link nav-primary" : "nav-link"}><Icon aria-hidden="true" /><span>{label}</span></a>)}</nav></aside>
    <div className="workspace"><header className="topbar"><span>{navigation.find(item => item.href === activeSection)?.label}</span><span className="read-only"><Database aria-hidden="true" />Read-only snapshot</span></header>
    <main id="main" className="main-content">
      <div className="page-heading"><h1>Client dashboard</h1></div>
      <div className="snapshot-strip"><div><Clock3 aria-hidden="true" /><span>Data as at <strong>{formatUtc(data.meta.referenceAt)}</strong></span></div><span>Imported {formatUtc(data.meta.importedAt)}</span></div>
      {data.meta.lastImportStatus === "failed" && <div className="notice notice-warning" role="status"><TriangleAlert aria-hidden="true" /><div><strong>The latest import failed.</strong><p>You’re viewing the previous complete snapshot shown above. Retry the local import to update it.</p></div></div>}
      {data.meta.lastImportStatus === "running" && <div className="notice" role="status"><Clock3 aria-hidden="true" /><div><strong>A new import is in progress.</strong><p>This page continues to show the last complete snapshot. Reload after the local import finishes.</p></div></div>}
      {data.quality.issues.length > 0 && <details className="quality-notice"><summary><Info aria-hidden="true" /><span>Data coverage <span className="muted">· Review exclusions</span></span><ChevronDown aria-hidden="true" /></summary><ul>{data.quality.issues.map(issue => <li key={issue.code}><strong>{count(issue.count)}</strong><div><h3>{qualityNotes[issue.code]?.title ?? "Other data limitations"}</h3><p>{qualityNotes[issue.code]?.detail ?? issue.message}</p></div></li>)}</ul></details>}

      <section id="priorities" className="dashboard-section"><SectionHeading title="Client priorities" description="Clients with triggered risk signals, ordered by call priority." />
        <div className="priority-layout"><Card className="queue-card"><CardHeader className="queue-header"><div className="inline-heading"><div><h3>Clients to call</h3><p>Lowest health first · lower score means higher risk.</p></div></div><Badge variant="warning">{count(data.atRisk.total)} to review</Badge></CardHeader>
          {visibleClients.length ? <ol className="risk-list" id="client-queue">{visibleClients.map((client, i) => <RiskRow client={client} index={i} key={client.clientId} />)}</ol> : <div className="empty-state"><ShieldCheck aria-hidden="true" /><h3>No flagged clients in this snapshot</h3><p>No assessed client has a triggered signal. Check the unassessed count before drawing a portfolio-wide conclusion.</p></div>}
          {data.atRisk.rows.length > 10 && <div className="queue-footer"><span>Showing {count(visibleClients.length)} of {count(data.atRisk.total)} clients</span><Button variant="outline" aria-expanded={showAll} aria-controls="client-queue" onClick={() => setShowAll(!showAll)}>{showAll ? "Show first 10" : "Show all clients"}<ChevronDown aria-hidden="true" className={showAll ? "rotated" : ""} /></Button></div>}
        </Card><div className="priority-aside"><Card className="priority-summary"><CardContent><h3>Assessment coverage</h3><dl><div><dt>Eligible for assessment</dt><dd>{count(data.atRisk.eligibleCount)}</dd></div><div><dt>Could not be assessed</dt><dd>{count(data.atRisk.unevaluatedCount)}</dd></div><div><dt>Portfolio clients</dt><dd>{count(data.quality.clientCount)}</dd></div></dl></CardContent></Card><div className="explanation-card"><h3>Score calculation</h3><p>Health = 100 minus flagged signal points. Missing signals make the score provisional. Scores prioritise calls; they are not cancellation probabilities.</p></div></div></div>
      </section>

      <section id="retention" className="dashboard-section"><SectionHeading title="Client retention" description="Retention at each client’s 3- and 6-month anniversary, measured independently from their first subscription start." />
        <div className="retention-grid">{data.retention.horizons.map(result => <Card className="retention-card" key={result.months}><CardContent><div className="metric-heading"><span className="eyebrow">{result.months}-MONTH RETENTION</span><Activity aria-hidden="true" /></div><div className={`metric-value ${result.value === null ? "metric-unavailable" : ""}`}>{formatPercent(result.value)}</div>{result.value !== null && <meter className="metric-meter" min={0} max={1} value={result.value} aria-label={`${result.months}-month retention`} />}<HorizonContext result={result} /></CardContent></Card>)}</div>
        <Card className="departure-card"><CardHeader><div><h3>Departure timing</h3><p>Final departures among {count(data.retention.departures.totalChurned)} churned clients, grouped by subscription age.</p></div></CardHeader><CardContent><div className="departure-grid">{data.retention.departures.bands.map(band => <div className="departure-band" key={band.code}><span>{band.label}</span><strong>{count(band.count)}<span> clients</span></strong><div className="band-share">{formatPercent(band.share)} of departures with known timing</div>{band.share !== null && <meter min={0} max={1} value={band.share} aria-label={`${band.label} share`} />}</div>)}</div><div className="footnote-line"><span>{count(data.retention.departures.unknownDatesCount)} departures with unknown timing</span><span>{count(data.retention.departures.reactivatedCount)} reactivated clients tracked separately</span></div><p className="method-note">At the snapshot: {count(data.retention.snapshot.retainedCount)} retained · {count(data.retention.snapshot.churnedCount)} churned · {count(data.retention.snapshot.unknownCount)} unknown. A return before an anniversary can count as retained at that point; these cards are not a funnel.</p></CardContent></Card>
      </section>

      <section id="leads" className="dashboard-section"><SectionHeading title="Leads by trade" description={`${formatLeadPeriod(data.meta.referenceAt)} · Average leads per client per full month, by trade. Missing observations are not zero.`} />
        <Card><Table aria-label="Lead performance by trade"><TableHeader><TableRow><SortHeading label="Trade" disabled={leadRows.length < 2} active={leadSort.key === "trade"} direction={leadSort.direction} onSort={() => setLeadSort(current => nextSort(current, "trade"))} /><SortHeading label="Leads / month" disabled={leadRows.length < 2} active={leadSort.key === "value"} direction={leadSort.direction} onSort={() => setLeadSort(current => nextSort(current, "value"))} /><SortHeading label="Clients in average" disabled={leadRows.length < 2} active={leadSort.key === "nClients"} direction={leadSort.direction} onSort={() => setLeadSort(current => nextSort(current, "nClients"))} /><TableHead>Observed / eligible<br />client-months</TableHead><SortHeading label="Coverage" disabled={leadRows.length < 2} active={leadSort.key === "coverage"} direction={leadSort.direction} onSort={() => setLeadSort(current => nextSort(current, "coverage"))} /><TableHead>Clients outside average /<br />unknown eligibility</TableHead></TableRow></TableHeader><TableBody>{leadRows.map(row => <TableRow key={row.trade}><TableCell><strong className="trade-name">{formatTrade(row.trade)}</strong>{row.smallSample && <span className="table-warning">Limited data</span>}</TableCell><TableCell className="table-value">{formatDecimal(row.value)}</TableCell><TableCell>{count(row.nClients)}</TableCell><TableCell>{count(row.observedClientMonths)} <span className="muted">/ {count(row.eligibleClientMonths)}</span></TableCell><TableCell>{formatPercent(row.coverage)}</TableCell><TableCell className="table-detail">{count(row.clientsWithoutObservations)} not in average<br />{count(row.unknownEligibilityCount)} with unknown eligibility</TableCell></TableRow>)}</TableBody></Table>{data.leadsByTrade.length === 0 && <p className="table-empty">No trades have lead observations in this snapshot.</p>}<div className="table-note"><p>Coverage measures only eligible client-months. A client outside the average may have no full service month in this period; this does not imply a missing lead count. Limited data: fewer than 5 clients, fewer than 10 observed client-months, or coverage below 80%. Select a column heading to sort.</p></div></Card>
      </section>

      <section id="economics" className="dashboard-section"><SectionHeading title="Revenue and observed LTV" description="Net paid revenue and observed subscription duration by trade. Active clients are measured up to the snapshot. All amounts are AUD." />
        <Card><Table aria-label="Revenue and observed lifetime value by trade"><TableHeader><TableRow><SortHeading label="Trade" disabled={economicRows.length < 2} active={economicSort.key === "trade"} direction={economicSort.direction} onSort={() => setEconomicSort(current => nextSort(current, "trade"))} /><SortHeading label="Revenue / client-month" disabled={economicRows.length < 2} active={economicSort.key === "monthlyRevenueAud"} direction={economicSort.direction} onSort={() => setEconomicSort(current => nextSort(current, "monthlyRevenueAud"))} /><SortHeading label="Observed LTV" disabled={economicRows.length < 2} active={economicSort.key === "observedLtvAud"} direction={economicSort.direction} onSort={() => setEconomicSort(current => nextSort(current, "observedLtvAud"))} /><SortHeading label="Avg. observed months" disabled={economicRows.length < 2} active={economicSort.key === "avgObservedMonths"} direction={economicSort.direction} onSort={() => setEconomicSort(current => nextSort(current, "avgObservedMonths"))} /><TableHead>Eligible clients</TableHead><TableHead>Active clients</TableHead><TableHead>Excluded clients</TableHead></TableRow></TableHeader><TableBody>{economicRows.map(row => <TableRow key={row.trade}><TableCell><strong className="trade-name">{formatTrade(row.trade)}</strong>{row.smallSample && <span className="table-warning">Small sample</span>}</TableCell><TableCell className="table-value">{formatAud(row.monthlyRevenueAud)}</TableCell><TableCell className="table-value">{formatAud(row.observedLtvAud)}</TableCell><TableCell>{formatDecimal(row.avgObservedMonths)}</TableCell><TableCell>{count(row.eligibleClientCount)}</TableCell><TableCell>{count(row.activeClientCount)}</TableCell><TableCell>{count(row.excludedClientCount)}</TableCell></TableRow>)}</TableBody></Table>{data.economicsByTrade.length === 0 && <p className="table-empty">No eligible financial history is available in this snapshot.</p>}<div className="table-note"><p>Revenue per client-month uses total net paid revenue divided by total observed subscription months, rather than averaging client rates. Observed LTV is historical net revenue per eligible client, including active clients. It is not a lifetime forecast.</p></div><details className="method-details"><summary>View calculation totals <ChevronDown aria-hidden="true" /></summary><Table aria-label="Exact pooled financial calculation bases"><TableHeader><TableRow><TableHead>Trade</TableHead><TableHead>Net revenue (AUD cents)</TableHead><TableHead>Subscription exposure (seconds)</TableHead><TableHead>Eligible clients</TableHead></TableRow></TableHeader><TableBody>{economicRows.map(row => <TableRow key={row.trade}><TableCell>{formatTrade(row.trade)}</TableCell><TableCell>{count(row.netRevenueCents)}</TableCell><TableCell>{count(row.exposureSeconds)}</TableCell><TableCell>{count(row.eligibleClientCount)}</TableCell></TableRow>)}</TableBody></Table></details></Card>
      </section>

      <section id="advertising" className="dashboard-section"><SectionHeading title="Advertising and retention" description="Current adoption and a separate, descriptive comparison of clients who had a subscription at the end of their first month." />
        <Card className="adoption-card"><CardContent><div><h3>Advertising enabled at snapshot</h3><p>{count(data.ads.adoption.enabledCount)} enabled of {count(data.ads.adoption.eligibleCount)} retained clients with a known flag · {count(data.ads.adoption.unknownCount)} unknown</p></div><strong className={data.ads.adoption.value === null ? "adoption-unavailable" : ""}>{formatPercent(data.ads.adoption.value)}</strong></CardContent></Card>
        <Card className="ads-comparison"><CardHeader><div><h3>Early adoption & subsequent retention</h3><p>Groups are fixed at the end of month 1; horizons are measured from the original subscription start.</p></div><Badge variant={data.ads.historyStatus === "assumption_based" ? "warning" : data.ads.historyStatus === "verified" ? "default" : "outline"}>{data.ads.historyStatus === "assumption_based" ? "Assumption-based estimate" : data.ads.historyStatus === "verified" ? "Verified history" : "Insufficient history"}</Badge></CardHeader><CardContent>
          {data.ads.historyStatus === "assumption_based" && <div className="assumption-notice"><TriangleAlert aria-hidden="true" /><div><strong>Two unverified assumptions are used for this comparison.</strong><p><b>A1 · First activation.</b> enabled_at is assumed to record the first activation and remain unchanged after disabling or reactivation.</p><p><b>A2 · No date means never.</b> A false flag with no activation date is assumed to mean no past activation in the available history.</p></div></div>}
          <p className="causality-note"><ShieldCheck aria-hidden="true" /><span><strong>Association, not causation.</strong> Clients choose advertising; trade, budget, engagement and acquisition timing may differ. This comparison cannot show that advertising caused retention.</span></p>
          {data.ads.historyStatus === "insufficient_history" && <p className="notice">Historical groups cannot be established with the available data. Retention comparisons are unavailable.</p>}
          <p className="method-note">Only clients subscribed at the end of month 1 are compared. The later/no-adoption group includes clients who enabled advertising after month 1.</p>
          <div className="ads-groups">{data.ads.groups.map(group => <div className="ad-group" key={group.id}><div className="group-header"><span className={`group-dot ${group.id === "early" ? "group-dot-teal" : ""}`} /><h4>{group.label}</h4><span>{count(group.count)} clients</span></div><div className="group-horizons">{group.horizons.map(result => <div key={result.months}><span className="eyebrow">AT {result.months} MONTHS</span><strong className={`group-value ${result.value === null ? "metric-unavailable" : ""}`}>{formatPercent(result.value)}</strong><HorizonContext result={result} /></div>)}</div></div>)}</div>
          <div className="ads-differences"><span>Retention difference · early minus later/no adoption<br /><span className="muted">pp = percentage points</span></span>{data.ads.differences.map(difference => <div key={difference.months}><strong>{formatPercentagePoints(difference.percentagePoints)}</strong><span>at {difference.months} months</span></div>)}</div>
          <div className="exclusions"><h4>Excluded before grouping</h4><p>Each client is counted in the first applicable category below.</p><dl><div><dt>Unknown subscription start</dt><dd>{count(data.ads.exclusions.unknownStart)}</dd></div><div><dt>Not yet at the end of month 1</dt><dd>{count(data.ads.exclusions.notReachedLandmark)}</dd></div><div><dt>Unknown subscription state at month 1</dt><dd>{count(data.ads.exclusions.unknownLandmarkState)}</dd></div><div><dt>No active subscription at month 1</dt><dd>{count(data.ads.exclusions.notActiveAtLandmark)}</dd></div><div><dt>Unknown advertising history</dt><dd>{count(data.ads.exclusions.unknownAdHistory)}</dd></div></dl></div>
        </CardContent></Card>
      </section>

      <section id="cancellations" className="dashboard-section"><SectionHeading title="Cancellation reasons" description="Final departures, separated by cancellation reason and voluntary feedback." />
        <div className="cancellation-grid"><Card><CardHeader><div><h3>Cancellation reasons</h3><p>{count(data.cancellationReasons.total)} terminally churned clients · {count(data.cancellationReasons.unknownDateCount)} with unknown departure dates</p></div></CardHeader><CardContent><ul className="reason-list">{data.cancellationReasons.reasons.map(reason => <li key={reason.code}><span>{reason.label.charAt(0).toUpperCase() + reason.label.slice(1)}</span><strong>{count(reason.count)}<span>{formatPercent(reason.share)}</span></strong></li>)}</ul>{data.cancellationReasons.reasons.length === 0 && <p className="muted">No cancellation reasons are available.</p>}<p className="method-note">Shares use the terminal-departure population. Unknown or conflicting reasons remain visible.</p></CardContent></Card><Card><CardHeader><div><h3>Voluntary cancellation feedback</h3><p>{count(data.cancellationReasons.voluntaryCount)} clients who requested cancellation.</p></div></CardHeader><CardContent><ul className="reason-list">{data.cancellationReasons.voluntaryFeedback.map(reason => <li key={reason.code}><span>{reason.label.charAt(0).toUpperCase() + reason.label.slice(1)}</span><strong>{count(reason.count)}<span>{formatPercent(reason.share)}</span></strong></li>)}</ul>{data.cancellationReasons.voluntaryFeedback.length === 0 && <p className="muted">No voluntary cancellation feedback is available.</p>}<p className="method-note">Feedback shares use voluntary cancellations, including missing feedback, rather than all departures.</p></CardContent></Card></div>
      </section>
      <footer className="page-footer"><span>Amounts in AUD · Dates in UTC</span><details><summary>Snapshot reference</summary><code>{data.meta.snapshotId}</code><p>{count(data.quality.customerCount)} billing customers · {count(data.quality.invoiceCount)} invoices · {count(data.quality.ticketCount)} support tickets</p></details></footer>
    </main></div>
  </div>;
}
