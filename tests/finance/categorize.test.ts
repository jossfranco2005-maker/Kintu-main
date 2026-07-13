import { describe, expect, it } from "vitest";

import { detectCategory, normalizeCategory } from "@/lib/finance/categorize";

describe("categorization", () => {
  it("detecta categorías con evidencia en lenguaje natural", () => {
    expect(detectCategory("pagué un taxi")).toBe("transporte");
    expect(detectCategory("compré medicinas en la farmacia")).toBe("salud");
    expect(detectCategory("almorcé fuera")).toBe("comida");
  });

  it("no inventa la categoría otros cuando no hay evidencia", () => {
    expect(detectCategory("gasté 25 dólares")).toBeNull();
  });

  it("mantiene otros solo en los flujos que permiten respaldo", () => {
    expect(normalizeCategory("categoría desconocida")).toBe("otros");
  });
});
