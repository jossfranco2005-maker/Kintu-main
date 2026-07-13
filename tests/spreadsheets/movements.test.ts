import { describe, expect, it } from "vitest";

import {
  buildMovementExportFilename,
  buildMovementExportRows,
  buildMovementTemplateExamples,
  MOVEMENT_TEMPLATE_HEADERS,
} from "@/lib/spreadsheets/movements";

describe("movement spreadsheet export", () => {
  it("exports the real filtered transactions instead of template examples", () => {
    const rows = buildMovementExportRows([
      {
        date: "2026-07-11",
        created_at: "2026-07-11T19:43:00.000Z",
        type: "expense",
        category: "comida",
        amount: "45.00",
        status: "confirmed",
        description: null,
        merchant: "KFC",
        source: "chat",
      },
      {
        date: "2026-07-11",
        created_at: "2026-07-11T20:51:00.000Z",
        type: "expense",
        category: "comida",
        amount: 10,
        status: "confirmed",
        description: null,
        merchant: "McDonald's",
        source: "manual",
      },
    ]);

    expect(rows).toEqual([
      {
        Fecha: "2026-07-11",
        Hora: "14:43:00",
        Tipo: "gasto",
        Categoria: "Comida",
        Monto: 45,
        Estado: "confirmado",
        Descripcion: "",
        Comercio: "KFC",
        Origen: "chat",
      },
      {
        Fecha: "2026-07-11",
        Hora: "15:51:00",
        Tipo: "gasto",
        Categoria: "Comida",
        Monto: 10,
        Estado: "confirmado",
        Descripcion: "",
        Comercio: "McDonald's",
        Origen: "manual",
      },
    ]);
  });

  it("keeps template examples separate from the empty import sheet", () => {
    expect(MOVEMENT_TEMPLATE_HEADERS).toEqual([
      "Fecha",
      "Hora",
      "Tipo",
      "Categoria",
      "Monto",
      "Estado",
      "Descripcion",
      "Comercio",
    ]);

    const examples = buildMovementTemplateExamples(new Date("2026-07-12T12:00:00Z"));
    expect(examples).toHaveLength(3);
    expect(examples[0].Comercio).toBe("Restaurante de ejemplo");
  });

  it("uses a timestamped export filename to avoid opening an older download", () => {
    expect(buildMovementExportFilename(new Date("2026-07-12T14:30:45Z"))).toBe(
      "mis_movimientos_kintu_20260712_093045.xlsx",
    );
  });
});
