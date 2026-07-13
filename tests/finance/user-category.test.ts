import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  detectUserBudgetCategory,
  loadUserBudgetCategories,
  resolveCategoryFromBudgetSet,
} from "@/lib/finance/user-category.server";

describe("user budget categories", () => {
  it("preserves an existing custom budget category", () => {
    const categories = new Set(["mascotas", "viajes"]);
    expect(resolveCategoryFromBudgetSet(" Mascotas ", categories)).toBe("mascotas");
  });

  it("keeps the fixed deterministic taxonomy when no custom budget matches", () => {
    const categories = new Set<string>();
    expect(resolveCategoryFromBudgetSet("almuerzo", categories)).toBe("comida");
    expect(resolveCategoryFromBudgetSet("algo desconocido", categories)).toBe("otros");
  });

  it("detects a custom category inside natural language", () => {
    const categories = new Set(["mascotas", "viajes familiares"]);
    expect(detectUserBudgetCategory("Gasté 20 en Mascotas", categories)).toBe("mascotas");
    expect(detectUserBudgetCategory("Pago de viajes familiares", categories)).toBe(
      "viajes familiares",
    );
  });
});

describe("new user categories", () => {
  it("preserva una categoría nueva cuando el flujo lo autoriza", () => {
    expect(resolveCategoryFromBudgetSet("Mascotas", new Set(), { allowNewCategory: true })).toBe(
      "mascotas",
    );
  });

  it("rechaza fechas y montos como categorías nuevas", () => {
    expect(resolveCategoryFromBudgetSet("Ayer", new Set(), { allowNewCategory: true })).toBe(
      "otros",
    );
    expect(resolveCategoryFromBudgetSet("20 dólares", new Set(), { allowNewCategory: true })).toBe(
      "otros",
    );
  });
});

describe("loading user categories", () => {
  function queryResult(
    data: Array<{ category: string }>,
    error: { message: string } | null = null,
  ) {
    const result = { data, error };
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.then = (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return builder;
  }

  it("combina categorías de presupuestos y movimientos confirmados", async () => {
    const from = vi.fn((table: string) => {
      if (table === "budgets") return queryResult([{ category: "mascotas" }]);
      if (table === "transactions") return queryResult([{ category: "viajes" }]);
      throw new Error(`Tabla inesperada: ${table}`);
    });

    const categories = await loadUserBudgetCategories({
      supabase: { from } as unknown as SupabaseClient,
      userId: "user-1",
    });

    expect(categories).toEqual(new Set(["mascotas", "viajes"]));
  });

  it("mantiene las categorías de presupuesto si falla la consulta de movimientos", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const from = vi.fn((table: string) => {
      if (table === "budgets") return queryResult([{ category: "mascotas" }]);
      if (table === "transactions") return queryResult([], { message: "schema cache" });
      throw new Error(`Tabla inesperada: ${table}`);
    });

    const categories = await loadUserBudgetCategories({
      supabase: { from } as unknown as SupabaseClient,
      userId: "user-1",
    });

    expect(categories).toEqual(new Set(["mascotas"]));
    errorSpy.mockRestore();
  });
});
