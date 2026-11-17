import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortRows } from "./sort";

describe("comparison table sorting", () => {
  const rows = [{ name: "Unknown", value: null }, { name: "B", value: 2 }, { name: "A", value: 10 }, { name: "Zero", value: 0 }];
  it("ranks canonical numbers rather than their formatted strings, with missing values last", () => {
    assert.deepStrictEqual(sortRows(rows, row => row.value, "desc").map(row => row.name), ["A", "B", "Zero", "Unknown"]);
    assert.deepStrictEqual(sortRows(rows, row => row.value, "asc").map(row => row.name), ["Zero", "B", "A", "Unknown"]);
  });
  it("supports alphabetical comparison without mutating the server model", () => {
    assert.deepStrictEqual(sortRows(rows, row => row.name, "asc").map(row => row.name), ["A", "B", "Unknown", "Zero"]);
    assert.strictEqual(rows[0].name, "Unknown");
  });
  it("preserves the original order for tied and unavailable values", () => {
    const tied = [{ id: 1, value: 2 }, { id: 2, value: null }, { id: 3, value: 2 }, { id: 4, value: null }];
    assert.deepStrictEqual(sortRows(tied, row => row.value, "desc").map(row => row.id), [1, 3, 2, 4]);
  });
});
