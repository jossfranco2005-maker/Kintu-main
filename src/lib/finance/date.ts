export const ECUADOR_TIME_ZONE = "America/Guayaquil";

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const MONTH_INDEX: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function normalizeDateText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Devuelve la fecha actual de Ecuador en formato YYYY-MM-DD.
 */
export function todayInEcuador(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECUADOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Devuelve el rango mensual [inicio, fin) para una fecha ISO.
 * `end` es el primer día del mes siguiente y se usa con `.lt("date", end)`.
 */
export function monthRangeForIsoDate(isoDate: string): { start: string; end: string } {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`Fecha ISO inválida: ${isoDate}`);
  }

  const [year, month] = isoDate.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));

  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: nextMonth.toISOString().slice(0, 10),
  };
}

/**
 * Rango del mes actual según la zona horaria de Ecuador.
 */
export function currentMonthRangeInEcuador(now = new Date()): { start: string; end: string } {
  return monthRangeForIsoDate(todayInEcuador(now));
}

/**
 * Comprueba que una fecha tenga formato YYYY-MM-DD
 * y que represente un día existente.
 */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Suma o resta días a una fecha ISO.
 */
export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

export function containsTransactionDateExpression(text: string): boolean {
  const normalized = normalizeDateText(text);
  return (
    /\b(?:hoy|ayer|anteayer)\b/.test(normalized) ||
    /\b(?:el|este)\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+pasado)?\b/.test(
      normalized,
    ) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(normalized) ||
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/.test(normalized) ||
    /\b(?:(?:el\s+)?dia\s+\d{1,2}|(?:el\s+)?\d{1,2}\s+de\s+[a-z]+(?:\s+de\s+\d{4})?)\b/.test(
      normalized,
    )
  );
}

function buildValidIsoDate(year: number, month: number, day: number): string | null {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

function resolveLocalDateExpression(originalText: string, today: string): string | null {
  const normalized = normalizeDateText(originalText);
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  const numeric = normalized.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (numeric) {
    return buildValidIsoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  }

  const named = normalized.match(
    /\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (named) {
    const day = Number(named[1]);
    const month = MONTH_INDEX[named[2]];
    const year = named[3] ? Number(named[3]) : currentYear;
    const resolved = buildValidIsoDate(year, month, day);
    if (!named[3] && resolved && resolved > today) return null;
    return resolved;
  }

  const dayOnly = normalized.match(/\b(?:el\s+)?dia\s+(\d{1,2})\b/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    const currentCandidate = buildValidIsoDate(currentYear, currentMonth, day);
    if (currentCandidate && day <= currentDay) return currentCandidate;

    const previousMonth = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    return buildValidIsoDate(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, day);
  }

  return null;
}

export type TransactionDateIssue = {
  kind: "future_without_year" | "future_explicit" | "invalid";
  mentionedDate: string | null;
  suggestedDate: string | null;
};

export function inspectTransactionDateIssue(
  originalText: string,
  today = todayInEcuador(),
): TransactionDateIssue | null {
  const normalized = normalizeDateText(originalText);
  const named = normalized.match(
    /\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (!named) return null;

  const [currentYear] = today.split("-").map(Number);
  const day = Number(named[1]);
  const month = MONTH_INDEX[named[2]];
  const explicitYear = named[3] ? Number(named[3]) : null;
  const candidate = buildValidIsoDate(explicitYear ?? currentYear, month, day);
  if (!candidate) return { kind: "invalid", mentionedDate: null, suggestedDate: null };
  if (candidate <= today) return null;

  if (explicitYear) {
    return { kind: "future_explicit", mentionedDate: candidate, suggestedDate: null };
  }

  return {
    kind: "future_without_year",
    mentionedDate: candidate,
    suggestedDate: buildValidIsoDate(currentYear - 1, month, day),
  };
}

export function formatIsoDateInSpanish(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = Object.entries(MONTH_INDEX).find(
    ([name, value]) => value === month && name !== "setiembre",
  )?.[0];
  return `${day} de ${monthName ?? month} de ${year}`;
}

function resolveWeekdayExpression(originalText: string, today: string): string | null {
  const normalized = normalizeDateText(originalText);
  const match = normalized.match(
    /\b(el|este)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+(pasado))?\b/,
  );
  if (!match) return null;

  const [, determiner, weekdayName, pastMarker] = match;
  const targetWeekday = WEEKDAY_INDEX[weekdayName];
  const [year, month, day] = today.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  const currentWeekday = current.getUTCDay();

  if (pastMarker) {
    let daysBack = (currentWeekday - targetWeekday + 7) % 7;
    if (daysBack === 0) daysBack = 7;
    return shiftIsoDate(today, -daysBack);
  }

  if (determiner === "este") {
    const mondayBasedCurrent = currentWeekday === 0 ? 6 : currentWeekday - 1;
    const mondayBasedTarget = targetWeekday === 0 ? 6 : targetWeekday - 1;
    const offset = mondayBasedTarget - mondayBasedCurrent;

    // Si "este viernes" todavía no ocurrió, no adivinamos una fecha futura
    // dentro de un flujo que registra movimientos ya realizados.
    return offset <= 0 ? shiftIsoDate(today, offset) : null;
  }

  const daysBack = (currentWeekday - targetWeekday + 7) % 7;
  return shiftIsoDate(today, -daysBack);
}

/**
 * Resuelve fechas simples de manera determinista.
 *
 * Prioridad:
 * 1. La fecha ISO extraída por el modelo.
 * 2. Palabras conocidas: hoy, ayer y anteayer.
 * 3. Días de la semana ya ocurridos ("el lunes", "el martes pasado").
 * 4. null cuando no hay evidencia suficiente.
 */
export function resolveTransactionDate(
  extractedDate: string | null | undefined,
  originalText: string,
  today = todayInEcuador(),
): string | null {
  const candidate = extractedDate?.trim();

  if (candidate && isValidIsoDate(candidate) && candidate <= today) {
    return candidate;
  }

  const normalizedText = normalizeDateText(originalText);
  const isoFromText = originalText.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (isoFromText && isValidIsoDate(isoFromText) && isoFromText <= today) {
    return isoFromText;
  }

  if (/\banteayer\b/.test(normalizedText)) {
    return shiftIsoDate(today, -2);
  }

  if (/\bayer\b/.test(normalizedText)) {
    return shiftIsoDate(today, -1);
  }

  if (/\bhoy\b/.test(normalizedText)) {
    return today;
  }

  const localDate = resolveLocalDateExpression(originalText, today);
  if (localDate) return localDate;

  return resolveWeekdayExpression(originalText, today);
}
