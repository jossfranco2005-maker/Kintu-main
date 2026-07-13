import { normalizeCategory } from "@/lib/finance/categorize";

const ECUADOR_TIME_ZONE = "America/Guayaquil";

export type DuplicateMovement = {
  date: string;
  type: "income" | "expense";
  amount: number | string;
  category: string;
  description?: string | null;
  merchant?: string | null;
  created_at?: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function movementTimeInEcuador(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ECUADOR_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour ?? "00"}:${values.minute ?? "00"}`;
}

export function movementBaseFingerprint(movement: DuplicateMovement): string {
  return [
    movement.date,
    movement.type,
    Number(movement.amount).toFixed(2),
    normalizeCategory(movement.category),
    normalizeText(movement.merchant),
    normalizeText(movement.description),
  ].join("|");
}

export function areMovementsDuplicates(left: DuplicateMovement, right: DuplicateMovement): boolean {
  if (movementBaseFingerprint(left) !== movementBaseFingerprint(right)) return false;

  const leftTime = movementTimeInEcuador(left.created_at);
  const rightTime = movementTimeInEcuador(right.created_at);

  // Si ambos archivos tienen hora, la usamos para distinguir compras reales
  // repetidas el mismo día. Si alguno no tiene hora, el resto de campos basta.
  return !leftTime || !rightTime || leftTime === rightTime;
}
