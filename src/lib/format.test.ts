import { describe, expect, it } from "vitest";
import { formatAud, formatCount, formatDecimal, formatLeadPeriod, formatPercent, formatPercentagePoints, formatTrade, formatUtc } from "./format";

describe("dashboard presentation formatting", () => {
  it("labels the three closed months from the snapshot date, including year rollover", () => {
    expect(formatLeadPeriod("2026-11-01T00:00:00Z")).toBe("Aug 2026 – Oct 2026");
    expect(formatLeadPeriod("2026-01-15T10:00:00Z")).toBe("Oct 2025 – Dec 2025");
    expect(formatLeadPeriod("invalid")).toBe("Period unavailable");
  });
  it("renders canonical trade values in the English interface without changing unknown categories", () => {
    expect(formatTrade("Не указан")).toBe("Unspecified");
    expect(formatTrade("hvac")).toBe("HVAC");
    expect(formatTrade("plumber")).toBe("Plumber");
    expect(formatTrade("specialist trade")).toBe("specialist trade");
  });
  it("keeps missing values distinct from known zeros", () => {
    expect(formatPercent(null)).toBe("Not enough data");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatAud(null)).toBe("Not enough data");
    expect(formatAud(0)).toBe("$0.00");
    expect(formatDecimal(null)).toBe("Not enough data");
    expect(formatDecimal(0)).toBe("0.0");
  });
  it("rounds only for display using Australian conventions", () => {
    expect(formatPercent(2 / 3)).toBe("66.7%");
    expect(formatAud(1234.567)).toBe("$1,234.57");
    expect(formatDecimal(12.34)).toBe("12.3");
    expect(formatCount(1234)).toBe("1,234");
    expect(formatPercentagePoints(12.345)).toBe("+12.3 pp");
    expect(formatPercentagePoints(-2.26)).toBe("−2.3 pp");
  });
  it("does not turn a positive fraction into zero or a near-complete share into certainty", () => {
    expect(formatPercent(0.00001)).toBe("< 0.1%");
    expect(formatPercent(0.999999)).toBe("> 99.9%");
    expect(formatPercent(0.9995)).toBe("> 99.9%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatAud(0.001)).toBe("< $0.01");
    expect(formatAud(-0.001)).toBe("−< $0.01");
    expect(formatDecimal(0.001)).toBe("< 0.1");
    expect(formatPercentagePoints(0.001)).toBe("+< 0.1 pp");
    expect(formatPercentagePoints(null)).toBe("Not enough data");
  });
  it("labels UTC explicitly and never displays invalid dates", () => {
    expect(formatUtc("2026-11-01T00:00:00Z")).toBe("1 Nov 2026, 00:00 UTC");
    expect(formatUtc("invalid")).toBe("Date unavailable");
  });
});
