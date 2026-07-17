import { describe, expect, it } from "vitest";

import {
  currentMonthRangeInEcuador,
  formatIsoDateInSpanish,
  inspectTransactionDateIssue,
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

  it.each([
    ["06/07/2026", "2026-07-06"],
    ["6/7/2026", "2026-07-06"],
    ["06-07-2026", "2026-07-06"],
    ["6 de julio de 2026", "2026-07-06"],
    ["el 6 de julio", "2026-07-06"],
    ["el día 6", "2026-07-06"],
    ["día 6", "2026-07-06"],
  ])("resuelve el formato local %s", (text, expected) => {
    expect(resolveTransactionDate(null, text, "2026-07-17")).toBe(expected);
  });

  it("no asigna silenciosamente el año anterior si la fecha aún sería futura", () => {
    expect(resolveTransactionDate(null, "el 20 de diciembre", "2026-07-17")).toBeNull();
  });

  it("rechaza fechas locales inexistentes", () => {
    expect(resolveTransactionDate(null, "31/02/2026", "2026-07-17")).toBeNull();
  });

  it("expone una aclaración sin perder la fecha sugerida", () => {
    expect(inspectTransactionDateIssue("Gasté el 20 de julio", "2026-07-17")).toEqual({
      kind: "future_without_year",
      mentionedDate: "2026-07-20",
      suggestedDate: "2025-07-20",
    });
  });

  it("detecta una fecha futura con año explícito", () => {
    expect(
      inspectTransactionDateIssue("Compré algo el 20 de julio de 2026", "2026-07-17"),
    ).toMatchObject({ kind: "future_explicit", mentionedDate: "2026-07-20" });
  });

  it("no acepta una fecha futura extraída por el modelo", () => {
    expect(resolveTransactionDate("2026-07-20", "Compré algo", "2026-07-17")).toBeNull();
  });

  it("presenta fechas ISO en español natural", () => {
    expect(formatIsoDateInSpanish("2025-07-20")).toBe("20 de julio de 2025");
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
