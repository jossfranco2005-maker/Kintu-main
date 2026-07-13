import { describe, expect, it } from "vitest";

import { rankKnowledgeArticles, type KnowledgeArticle } from "@/lib/agents/support-retrieval";

const articles: KnowledgeArticle[] = [
  {
    id: "article-profile",
    title: "Cómo actualizar mis datos personales",
    content: "Edita tu nombre, teléfono o correo desde tu perfil.",
    category: "cuenta",
    version: 1,
    source: "kintu-kb/v1",
  },
  {
    id: "article-budget",
    title: "Cómo fijar un presupuesto mensual",
    content: "Puedes establecer un límite y un umbral por categoría.",
    category: "presupuesto",
    version: 1,
    source: "kintu-kb/v1",
  },
  {
    id: "article-human",
    title: "Cómo hablar con un humano",
    content: "Describe el problema y se abrirá un ticket.",
    category: "soporte",
    version: 1,
    source: "kintu-kb/v1",
  },
];

describe("approved knowledge retrieval", () => {
  it("prioriza el artículo que responde sobre cambio de correo", () => {
    const result = rankKnowledgeArticles("¿Cómo cambio mi correo?", articles);

    expect(result[0]?.id).toBe("article-profile");
    expect(result[0]?.score).toBeGreaterThan(0);
  });

  it("prioriza presupuesto por intención y contenido", () => {
    const result = rankKnowledgeArticles("quiero definir un límite mensual", articles);

    expect(result[0]?.id).toBe("article-budget");
  });

  it("no devuelve artículos para una consulta totalmente ajena", () => {
    const result = rankKnowledgeArticles("¿Cuál es el clima de mañana?", articles);

    expect(result).toEqual([]);
  });
});
