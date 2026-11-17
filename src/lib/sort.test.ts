import { describe, expect, it } from "vitest";
import { sortRows } from "./sort";

describe("comparison table sorting", () => {
  const rows = [{ name: "Unknown", value: null }, { name: "B", value: 2 }, { name: "A", value: 10 }, { name: "Zero", value: 0 }];
  it("ranks canonical numbers rather than their formatted strings, with missing values last", () => {
    expect(sortRows(rows, row => row.value, "desc").map(row => row.name)).toEqual(["A", "B", "Zero", "Unknown"]);
    expect(sortRows(rows, row => row.value, "asc").map(row => row.name)).toEqual(["Zero", "B", "A", "Unknown"]);
  });
  it("supports alphabetical comparison without mutating the server model", () => {
    expect(sortRows(rows, row => row.name, "asc").map(row => row.name)).toEqual(["A", "B", "Unknown", "Zero"]);
    expect(rows[0].name).toBe("Unknown");
  });
  it("preserves the original order for tied and unavailable values", () => {
    const tied = [{ id: 1, value: 2 }, { id: 2, value: null }, { id: 3, value: 2 }, { id: 4, value: null }];
    expect(sortRows(tied, row => row.value, "desc").map(row => row.id)).toEqual([1, 3, 2, 4]);
  });
});
