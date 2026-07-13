const ECUADOR_TIME_ZONE = "America/Guayaquil";

const CATEGORY_LABELS: Record<string, string> = {
  comida: "Comida",
  transporte: "Transporte",
  servicios: "Servicios",
  entretenimiento: "Entretenimiento",
  salud: "Salud",
  hogar: "Hogar",
  educacion: "Educación",
  ropa: "Ropa",
  otros: "Otros",
};

export const MOVEMENT_TEMPLATE_HEADERS = [
  "Fecha",
  "Hora",
  "Tipo",
  "Categoria",
  "Monto",
  "Estado",
  "Descripcion",
  "Comercio",
] as const;

export const MOVEMENT_EXPORT_HEADERS = [...MOVEMENT_TEMPLATE_HEADERS, "Origen"] as const;

export type MovementExportSource = {
  date: string;
  created_at?: string | null;
  type: string;
  category: string;
  amount: number | string;
  status?: string | null;
  description?: string | null;
  merchant?: string | null;
  source?: string | null;
};

export type MovementExportRow = {
  Fecha: string;
  Hora: string;
  Tipo: "ingreso" | "gasto";
  Categoria: string;
  Monto: number;
  Estado: string;
  Descripcion: string;
  Comercio: string;
  Origen: string;
};

export type MovementTemplateExampleRow = Omit<MovementExportRow, "Origen">;

function normalizeStatus(status: string | null | undefined): string {
  if (status === "confirmed") return "confirmado";
  if (status === "pending") return "pendiente";
  return status || "";
}

function formatTimeInZone(value: string | null | undefined, timeZone = ECUADOR_TIME_ZONE): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour ?? "00"}:${values.minute ?? "00"}:${values.second ?? "00"}`;
}

export function buildMovementExportRows(
  transactions: readonly MovementExportSource[],
): MovementExportRow[] {
  return transactions.map((transaction) => ({
    Fecha: transaction.date,
    Hora: formatTimeInZone(transaction.created_at),
    Tipo: transaction.type === "income" ? "ingreso" : "gasto",
    Categoria: CATEGORY_LABELS[transaction.category] || transaction.category,
    Monto: Number(transaction.amount),
    Estado: normalizeStatus(transaction.status),
    Descripcion: transaction.description || "",
    Comercio: transaction.merchant || "",
    Origen: transaction.source || "",
  }));
}

export function buildMovementTemplateExamples(
  referenceDate = new Date(),
): MovementTemplateExampleRow[] {
  const currentDate = referenceDate.toISOString().slice(0, 10);
  const previousDate = new Date(referenceDate.getTime() - 86_400_000).toISOString().slice(0, 10);

  return [
    {
      Fecha: currentDate,
      Hora: "14:30:00",
      Tipo: "gasto",
      Categoria: "comida",
      Monto: 12.5,
      Estado: "confirmado",
      Descripcion: "Almuerzo con el equipo",
      Comercio: "Restaurante de ejemplo",
    },
    {
      Fecha: currentDate,
      Hora: "09:15:00",
      Tipo: "ingreso",
      Categoria: "otros",
      Monto: 1500,
      Estado: "confirmado",
      Descripcion: "Ingreso de ejemplo",
      Comercio: "Empresa de ejemplo",
    },
    {
      Fecha: previousDate,
      Hora: "18:20:00",
      Tipo: "gasto",
      Categoria: "transporte",
      Monto: 3.75,
      Estado: "pendiente",
      Descripcion: "Traslado de ejemplo",
      Comercio: "Taxi de ejemplo",
    },
  ];
}

export function buildMovementExportFilename(referenceDate = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECUADOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(referenceDate);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}${values.month}${values.day}`;
  const time = `${values.hour}${values.minute}${values.second}`;
  return `mis_movimientos_kintu_${date}_${time}.xlsx`;
}
