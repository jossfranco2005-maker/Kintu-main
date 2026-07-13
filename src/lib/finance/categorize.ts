// Funciones deterministas de categorías.
// No utilizan el modelo de inteligencia artificial.

export const CATEGORIES = [
  "comida",
  "transporte",
  "hogar",
  "salud",
  "educacion",
  "entretenimiento",
  "servicios",
  "ropa",
  "otros",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  comida: [
    "comida",
    "almuerzo",
    "almorcé",
    "almorce",
    "almorzar",
    "cena",
    "desayuno",
    "restaurante",
    "mercado",
    "supermercado",
    "café",
    "cafe",
    "pan",
  ],
  transporte: ["taxi", "uber", "bus", "gasolina", "combustible", "pasaje", "parqueo"],
  hogar: ["arriendo", "alquiler", "muebles", "hogar"],
  salud: ["farmacia", "médico", "medico", "hospital", "medicina", "consulta"],
  educacion: ["libro", "curso", "colegio", "universidad", "matrícula", "matricula"],
  entretenimiento: ["cine", "netflix", "spotify", "juego", "concierto", "salida"],
  servicios: ["luz", "agua", "internet", "teléfono", "telefono", "gas", "recibo"],
  ropa: ["ropa", "zapato", "camisa", "pantalón", "pantalon", "zapatilla"],
  otros: [],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function containsKeyword(normalizedText: string, keyword: string): boolean {
  const normalizedKeyword = normalizeText(keyword);
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(normalizedKeyword)}(?:$|[^a-z0-9])`,
    "u",
  );
  return pattern.test(normalizedText);
}

/**
 * Busca una categoría solamente cuando existe evidencia.
 *
 * A diferencia de guessCategory, esta función devuelve null
 * cuando no encuentra una categoría.
 */
export function detectCategory(text: string): Category | null {
  const normalized = normalizeText(text);

  const exactCategory = CATEGORIES.find((category) => category === normalized);

  if (exactCategory) {
    return exactCategory;
  }

  for (const category of CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[category];

    if (keywords.some((keyword) => containsKeyword(normalized, keyword))) {
      return category;
    }
  }

  return null;
}

/**
 * Mantiene el comportamiento anterior para formularios donde
 * "otros" sí es un valor de respaldo permitido.
 */
export function guessCategory(text: string): Category {
  return detectCategory(text) ?? "otros";
}

export function normalizeCategory(input: string | undefined | null): Category {
  if (!input) {
    return "otros";
  }

  const normalized = input.toLowerCase().trim();

  if ((CATEGORIES as readonly string[]).includes(normalized)) {
    return normalized as Category;
  }

  return guessCategory(normalized);
}

export function formatMoney(amount: number, currency = "USD"): string {
  return `${currency} ${amount.toFixed(2)}`;
}
