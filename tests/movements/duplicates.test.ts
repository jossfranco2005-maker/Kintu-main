import { describe, expect, it } from "vitest";

import { areMovementsDuplicates } from "@/lib/movements/duplicates";

const base = {
  date: "2026-07-10",
  type: "expense" as const,
  amount: 10,
  category: "comida",
  description: null,
  merchant: "McDonald's",
};

describe("movement duplicate detection", () => {
  it("detecta el mismo movimiento aunque created_at tenga otro día", () => {
    expect(
      areMovementsDuplicates(
        { ...base, created_at: "2026-07-11T20:51:06.000Z" },
        { ...base, created_at: "2026-07-10T20:51:06.000Z" },
      ),
    ).toBe(true);
  });

  it("distingue dos compras iguales hechas en minutos distintos", () => {
    expect(
      areMovementsDuplicates(
        { ...base, created_at: "2026-07-10T19:42:00.000Z" },
        { ...base, created_at: "2026-07-10T19:43:00.000Z" },
      ),
    ).toBe(false);
  });

  it("usa los campos base cuando el archivo no incluye hora", () => {
    expect(
      areMovementsDuplicates(
        { ...base, created_at: "2026-07-10T19:42:00.000Z" },
        { ...base, created_at: null },
      ),
    ).toBe(true);
  });
});
