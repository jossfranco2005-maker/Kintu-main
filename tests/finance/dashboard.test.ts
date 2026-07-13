import { describe, expect, it } from "vitest";

import { buildDailySeries } from "@/lib/finance/dashboard";

describe("buildDailySeries", () => {
  const rows = [
    { type: "income", amount: "100.50", date: "2026-07-02" },
    { type: "income", amount: 49.5, date: "2026-07-02T18:30:00Z" },
    { type: "expense", amount: 25, date: "2026-07-03" },
    { type: "expense", amount: "10", date: "2026-07-01" },
  ];

  it("aggregates real income rows by day", () => {
    expect(buildDailySeries(rows, "income")).toEqual([{ date: "2026-07-02", amount: 150 }]);
  });

  it("aggregates and sorts expense rows", () => {
    expect(buildDailySeries(rows, "expense")).toEqual([
      { date: "2026-07-01", amount: 10 },
      { date: "2026-07-03", amount: 25 },
    ]);
  });

  it("does not synthesize a series when there are no matching rows", () => {
    expect(buildDailySeries([], "income")).toEqual([]);
  });

  it("ignores invalid or non-positive amounts", () => {
    expect(
      buildDailySeries(
        [
          { type: "income", amount: "not-a-number", date: "2026-07-01" },
          { type: "income", amount: 0, date: "2026-07-01" },
          { type: "income", amount: -10, date: "2026-07-01" },
        ],
        "income",
      ),
    ).toEqual([]);
  });

  it("ignores invalid dates instead of inventing a point", () => {
    expect(buildDailySeries([{ type: "expense", amount: 10, date: "today" }], "expense")).toEqual(
      [],
    );
  });
});
