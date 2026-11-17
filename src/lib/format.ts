const missing = "Not enough data";
const decimal = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const count = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value);

export const formatCount = (value: number): string => count.format(value);
export function formatLeadPeriod(referenceAt: string): string {
  const reference = new Date(referenceAt);
  if (!Number.isFinite(reference.getTime())) return "Period unavailable";
  const year = reference.getUTCFullYear(), month = reference.getUTCMonth();
  const label = new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
  return `${label.format(new Date(Date.UTC(year, month - 3, 1)))} – ${label.format(new Date(Date.UTC(year, month - 1, 1)))}`;
}
export function formatTrade(value: string): string {
  const labels: Record<string, string> = {
    "Не указан": "Unspecified", plumber: "Plumber", electrician: "Electrician",
    roofer: "Roofer", hvac: "HVAC", painter: "Painter", builder: "Builder", landscaper: "Landscaper",
  };
  return labels[value] ?? value;
}
export function formatDecimal(value: number | null): string {
  if (!valid(value)) return missing;
  if (value !== 0 && Math.abs(value) < 0.05) return `${value < 0 ? "−" : ""}< 0.1`;
  return decimal.format(value);
}
export function formatAud(value: number | null): string {
  if (!valid(value)) return missing;
  if (value !== 0 && Math.abs(value) < 0.005) return `${value < 0 ? "−" : ""}< $0.01`;
  return currency.format(value);
}
export function formatPercent(value: number | null): string {
  if (!valid(value)) return missing;
  if (value > 0 && value < 0.0005) return "< 0.1%";
  if (value < 1 && value >= 0.9995) return "> 99.9%";
  return `${decimal.format(value * 100)}%`;
}
export function formatPercentagePoints(value: number | null): string {
  if (!valid(value)) return missing;
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatDecimal(Math.abs(value))} pp`;
}
export function formatUtc(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  const time = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(date);
  return `${day}, ${time} UTC`;
}
