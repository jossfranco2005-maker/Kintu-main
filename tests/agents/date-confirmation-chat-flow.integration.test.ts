import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateStructured: vi.fn(),
  findActive: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock("@/lib/ai/structured.server", () => ({ generateStructured: mocks.generateStructured }));
vi.mock("@/lib/finance/user-category.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/user-category.server")>()),
  loadUserBudgetCategories: vi.fn().mockResolvedValue(new Set<string>()),
}));
vi.mock("@/lib/agents/transaction-drafts.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/transaction-drafts.server")>()),
  findActiveTransactionDraft: mocks.findActive,
  updateTransactionDraft: mocks.updateDraft,
}));

import { processChatMessage } from "@/lib/agents/chat-flow.server";

const activeDraft = {
  id: "draft-1",
  userId: "user-1",
  conversationId: "conversation-1",
  type: "expense" as const,
  amount: 300,
  currency: "USD" as const,
  date: null,
  category: "otros",
  merchant: "tienda de computadoras",
  description: "computadora",
  status: "NEEDS_INFO" as const,
  needs: ["date"] as const,
  transactionId: null,
};

function historySupabase(): SupabaseClient {
  const from = vi.fn((table: string) => {
    if (table !== "messages") throw new Error(`Tabla inesperada: ${table}`);
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: async () => ({
        data: [
          { role: "user", content: "Sí, fue en 2025." },
          {
            role: "assistant",
            content:
              "El 20 de julio de 2026 todavía no ha ocurrido. Como indicas que la transacción ya se realizó, ¿te refieres al 20 de julio de 2025?",
          },
          {
            role: "user",
            content: "Me compré una computadora por 300 dólares el 20 de julio.",
          },
        ],
        error: null,
      }),
    };
    return builder;
  });
  return { from } as unknown as SupabaseClient;
}

describe("deterministic year confirmation through chat flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findActive.mockResolvedValue(activeDraft);
    mocks.updateDraft.mockImplementation(async (_supabase, params) => ({
      ...activeDraft,
      ...params.draft,
      needs: params.needs,
      status: params.needs.length === 0 ? "AWAITING_CONFIRMATION" : "NEEDS_INFO",
    }));
  });

  it("conserva la fecha sugerida aunque transaction-follow-up devuelva null", async () => {
    mocks.generateStructured
      .mockResolvedValueOnce({
        action: "continue_draft",
        confidence: 0.98,
        reason: "Confirma el año solicitado",
        currentRequestText: null,
      })
      .mockResolvedValueOnce({
        amount: null,
        date: null,
        category: null,
        merchant: null,
        description: null,
      });

    const result = await processChatMessage({
      text: "Sí, fue en 2025.",
      userId: "user-1",
      conversationId: "conversation-1",
      supabase: historySupabase(),
    });

    expect(result.draft).toMatchObject({
      amount: 300,
      date: "2025-07-20",
      category: "otros",
      merchant: "tienda de computadoras",
      needs: [],
    });
    expect(result.reply).toContain("20 de julio de 2025");
    expect(result.reply).not.toContain("2025-07-20");
  });
});
