export type SortDirection = "asc" | "desc";
export function sortRows<T>(rows: readonly T[], value: (row: T) => string | number | null, direction: SortDirection): T[] {
  return [...rows].sort((a, b) => {
    const left = value(a), right = value(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    const comparison = typeof left === "number" && typeof right === "number"
      ? left - right : String(left).localeCompare(String(right), "en-AU");
    return direction === "asc" ? comparison : -comparison;
  });
}
