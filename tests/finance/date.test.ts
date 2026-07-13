import { describe, expect, it } from "vitest";

import {
  currentMonthRangeInEcuador,
  isValidIsoDate,
  monthRangeForIsoDate,
  resolveTransactionDate,
  shiftIsoDate,
} from "@/lib/finance/date";

describe("date helpers", () => {
  it("valida fechas ISO reales", () => {
    expect(isValidIsoDate("2026-07-11")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("11-07-2026")).toBe(false);
  });

  it("resuelve ayer y anteayer sin depender del modelo", () => {
    expect(resolveTransactionDate(null, "Ayer gasté 10", "2026-07-11")).toBe("2026-07-10");
    expect(resolveTransactionDate(null, "Anteayer pagué", "2026-07-11")).toBe("2026-07-09");
  });

  it("conserva una fecha ISO válida extraída", () => {
    expect(resolveTransactionDate("2026-06-30", "pagué ese día", "2026-07-11")).toBe("2026-06-30");
  });

  it("construye rangos mensuales cerrados por la izquierda y abiertos por la derecha", () => {
    expect(monthRangeForIsoDate("2026-07-12")).toEqual({
      start: "2026-07-01",
      end: "2026-08-01",
    });
    expect(monthRangeForIsoDate("2026-12-31")).toEqual({
      start: "2026-12-01",
      end: "2027-01-01",
    });
  });

  it("determina el mes actual usando la hora local de Ecuador", () => {
    // En UTC ya es 1 de agosto, pero en Ecuador todavía es 31 de julio.
    const now = new Date("2026-08-01T03:30:00.000Z");
    expect(currentMonthRangeInEcuador(now)).toEqual({
      start: "2026-07-01",
      end: "2026-08-01",
    });
  });

  it("desplaza fechas entre meses", () => {
    expect(shiftIsoDate("2026-07-01", -1)).toBe("2026-06-30");
  });
});

describe("weekday transaction dates", () => {
  it("resuelve el día de la semana más reciente", () => {
    expect(resolveTransactionDate(null, "el lunes", "2026-07-12")).toBe("2026-07-06");
  });

  it("resuelve un día marcado como pasado", () => {
    expect(resolveTransactionDate(null, "el martes pasado", "2026-07-14")).toBe("2026-07-07");
  });

  it("no adivina un día futuro con este", () => {
    expect(resolveTransactionDate(null, "este viernes", "2026-07-08")).toBeNull();
  });
});
