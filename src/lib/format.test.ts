import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAud, formatCount, formatDecimal, formatLeadPeriod, formatPercent, formatPercentagePoints, formatTrade, formatUtc } from "./format";

describe("dashboard presentation formatting", () => {
  it("labels the three closed months from the snapshot date, including year rollover", () => {
    assert.strictEqual(formatLeadPeriod("2026-11-01T00:00:00Z"), "Aug 2026 – Oct 2026");
    assert.strictEqual(formatLeadPeriod("2026-01-15T10:00:00Z"), "Oct 2025 – Dec 2025");
    assert.strictEqual(formatLeadPeriod("invalid"), "Period unavailable");
  });
  it("renders canonical trade values in the English interface without changing unknown categories", () => {
    assert.strictEqual(formatTrade("Не указан"), "Unspecified");
    assert.strictEqual(formatTrade("hvac"), "HVAC");
    assert.strictEqual(formatTrade("plumber"), "Plumber");
    assert.strictEqual(formatTrade("specialist trade"), "specialist trade");
  });
  it("keeps missing values distinct from known zeros", () => {
    assert.strictEqual(formatPercent(null), "Not enough data");
    assert.strictEqual(formatPercent(0), "0.0%");
    assert.strictEqual(formatAud(null), "Not enough data");
    assert.strictEqual(formatAud(0), "$0.00");
    assert.strictEqual(formatDecimal(null), "Not enough data");
    assert.strictEqual(formatDecimal(0), "0.0");
  });
  it("rounds only for display using Australian conventions", () => {
    assert.strictEqual(formatPercent(2 / 3), "66.7%");
    assert.strictEqual(formatAud(1234.567), "$1,234.57");
    assert.strictEqual(formatDecimal(12.34), "12.3");
    assert.strictEqual(formatCount(1234), "1,234");
    assert.strictEqual(formatPercentagePoints(12.345), "+12.3 pp");
    assert.strictEqual(formatPercentagePoints(-2.26), "−2.3 pp");
  });
  it("does not turn a positive fraction into zero or a near-complete share into certainty", () => {
    assert.strictEqual(formatPercent(0.00001), "< 0.1%");
    assert.strictEqual(formatPercent(0.999999), "> 99.9%");
    assert.strictEqual(formatPercent(0.9995), "> 99.9%");
    assert.strictEqual(formatPercent(1), "100.0%");
    assert.strictEqual(formatAud(0.001), "< $0.01");
    assert.strictEqual(formatAud(-0.001), "−< $0.01");
    assert.strictEqual(formatDecimal(0.001), "< 0.1");
    assert.strictEqual(formatPercentagePoints(0.001), "+< 0.1 pp");
    assert.strictEqual(formatPercentagePoints(null), "Not enough data");
  });
  it("labels UTC explicitly and never displays invalid dates", () => {
    assert.strictEqual(formatUtc("2026-11-01T00:00:00Z"), "1 Nov 2026, 00:00 UTC");
    assert.strictEqual(formatUtc("invalid"), "Date unavailable");
  });
});
