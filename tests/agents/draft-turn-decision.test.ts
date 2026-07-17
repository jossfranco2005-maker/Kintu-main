import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/lib/ai/structured.server", () => ({ generateStructured: generateStructuredMock }));

import { decideDraftTurn } from "@/lib/agents/draft-turn-decision.server";
import type { StoredTransactionDraft } from "@/lib/agents/transaction-drafts.server";

const draft: StoredTransactionDraft = {
  id: "draft-1",
  userId: "user-1",
  conversationId: "conversation-1",
  type: "expense",
  amount: 30,
  currency: "USD",
  date: null,
  category: "transporte",
  merchant: null,
  description: null,
  status: "NEEDS_INFO",
  needs: ["date", "merchant"],
  transactionId: null,
};

describe("contextual draft turn decision", () => {
  beforeEach(() => generateStructuredMock.mockReset());

  it.each([
    ["¿Cuánto he gastado este mes?", "financial_query"],
    ["Ahora sí, gasté 15 en comida en KFC", "new_transaction"],
    ["el comercio del gasto pendiente fue KFC", "continue_draft"],
  ])("respeta la decisión estructurada para %s", async (text, action) => {
    generateStructuredMock.mockResolvedValue({ action, confidence: 0.94, reason: "contexto" });
    await expect(decideDraftTurn({ text, draft, history: [] })).resolves.toMatchObject({ action });
  });

  it("prioriza soporte sensible", async () => {
    const result = await decideDraftTurn({
      text: "Vi un cargo de 85 dólares que no reconozco",
      draft,
      history: [],
    });
    expect(result.action).toBe("support_or_sensitive");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("prioriza una cancelación compuesta", async () => {
    const result = await decideDraftTurn({
      text: "olvídalo, cancela ese gasto",
      draft,
      history: [],
    });
    expect(result.action).toBe("cancel_draft");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("representa el reemplazo seguro de un borrador", async () => {
    generateStructuredMock.mockResolvedValue({
      action: "replace_draft",
      confidence: 0.98,
      reason: "Cancela el gasto anterior y registra uno nuevo",
      currentRequestText: "Ahora registra 12 dólares en taxi.",
    });
    await expect(
      decideDraftTurn({
        text: "No continúes con ese gasto; ahora registra 12 dólares en taxi.",
        draft,
        history: [],
      }),
    ).resolves.toMatchObject({
      action: "replace_draft",
      currentRequestText: "Ahora registra 12 dólares en taxi.",
    });
  });
});
