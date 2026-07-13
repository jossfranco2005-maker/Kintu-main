export type KnowledgeArticle = {
  id: string;
  title: string;
  content: string;
  category: string;
  version: number;
  source: string;
};

export type RankedKnowledgeArticle = KnowledgeArticle & {
  score: number;
  matchedTerms: string[];
};

const STOP_WORDS = new Set([
  "a",
  "al",
  "algo",
  "como",
  "con",
  "de",
  "del",
  "el",
  "en",
  "es",
  "esta",
  "este",
  "hacer",
  "la",
  "las",
  "lo",
  "los",
  "me",
  "mi",
  "para",
  "por",
  "puedo",
  "que",
  "quiero",
  "se",
  "si",
  "su",
  "un",
  "una",
  "y",
]);

const SYNONYMS: Record<string, string[]> = {
  actualizar: ["cambiar", "editar", "modificar"],
  datos: ["perfil", "correo", "telefono", "nombre"],
  humano: ["persona", "agente", "asesor"],
  presupuesto: ["limite", "tope", "umbral"],
  cargo: ["movimiento", "consumo", "transaccion"],
};

export function normalizeSupportText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSupportText(value: string): string[] {
  const normalized = normalizeSupportText(value);

  if (!normalized) {
    return [];
  }

  const baseTokens = normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  const expanded = new Set(baseTokens);

  for (const token of baseTokens) {
    for (const [canonical, aliases] of Object.entries(SYNONYMS)) {
      if (token === canonical || aliases.includes(token)) {
        expanded.add(canonical);
        aliases.forEach((alias) => expanded.add(alias));
      }
    }
  }

  return [...expanded];
}

function fieldMatches(field: string, queryTerms: string[]): string[] {
  const tokens = new Set(tokenizeSupportText(field));
  return queryTerms.filter((term) => tokens.has(term));
}

export function rankKnowledgeArticles(
  query: string,
  articles: KnowledgeArticle[],
  limit = 3,
): RankedKnowledgeArticle[] {
  const queryTerms = tokenizeSupportText(query);

  if (queryTerms.length === 0) {
    return [];
  }

  const normalizedQuery = normalizeSupportText(query);

  return articles
    .map((article) => {
      const titleMatches = fieldMatches(article.title, queryTerms);
      const categoryMatches = fieldMatches(article.category, queryTerms);
      const contentMatches = fieldMatches(article.content, queryTerms);
      const matchedTerms = [...new Set([...titleMatches, ...categoryMatches, ...contentMatches])];

      let score = titleMatches.length * 5 + categoryMatches.length * 3 + contentMatches.length;

      const normalizedTitle = normalizeSupportText(article.title);
      const normalizedCategory = normalizeSupportText(article.category);

      if (normalizedTitle && normalizedQuery.includes(normalizedTitle)) {
        score += 8;
      }

      if (normalizedCategory && normalizedQuery.includes(normalizedCategory)) {
        score += 4;
      }

      return {
        ...article,
        score,
        matchedTerms,
      };
    })
    .filter((article) => article.score >= 2 && article.matchedTerms.length > 0)
    .sort((first, second) => {
      if (second.score !== first.score) {
        return second.score - first.score;
      }

      return first.title.localeCompare(second.title, "es");
    })
    .slice(0, limit);
}
