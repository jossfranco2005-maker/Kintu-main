import { describe, expect, it } from "vitest";

import { validateGroundedSupportAnswer } from "@/lib/agents/support-flow.server";
import type { KnowledgeArticle } from "@/lib/agents/support-retrieval";

const article: KnowledgeArticle = {
  id: "article-1",
  title: "Artículo aprobado",
  content: "Contenido autorizado",
  category: "soporte",
  version: 2,
  source: "kintu-kb/v2",
};

describe("grounded support answers", () => {
  it("acepta únicamente referencias que pertenecen a los artículos recuperados", () => {
    const result = validateGroundedSupportAnswer(
      {
        can_answer: true,
        answer: "Respuesta respaldada.",
        used_article_ids: ["article-1"],
        missing_reason: null,
      },
      [article],
    );

    expect(result?.answer).toBe("Respuesta respaldada.");
    expect(result?.usedArticles).toEqual([article]);
  });

  it("rechaza una cita inventada por el modelo", () => {
    const result = validateGroundedSupportAnswer(
      {
        can_answer: true,
        answer: "Respuesta sin respaldo.",
        used_article_ids: ["article-invented"],
        missing_reason: null,
      },
      [article],
    );

    expect(result).toBeNull();
  });

  it("rechaza una respuesta cuando el modelo declara que no puede responder", () => {
    const result = validateGroundedSupportAnswer(
      {
        can_answer: false,
        answer: null,
        used_article_ids: [],
        missing_reason: "No existe el procedimiento.",
      },
      [article],
    );

    expect(result).toBeNull();
  });
});
