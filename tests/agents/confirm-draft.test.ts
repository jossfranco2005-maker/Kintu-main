import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { saveConfirmedTransaction } from "@/lib/agents/orchestrator";

function draftQuery(result: Record<string, unknown>) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: result, error: null }));
  return builder;
}

describe("confirmed draft idempotency", () => {
  it("reutiliza la transacción existente sin volver a insertar", async () => {
    const from = vi.fn((table: string) => {
      if (table !== "transaction_drafts") {
        throw new Error(`No debía consultar ${table}`);
      }

      return draftQuery({
        id: "10000000-0000-4000-8000-000000000001",
        user_id: "10000000-0000-4000-8000-000000000002",
        conversation_id: "10000000-0000-4000-8000-000000000003",
        type: "expense",
        amount: "45.00",
        currency: "USD",
        date: "2026-07-10",
        category: "comida",
        merchant: "KFC",
        description: null,
        status: "SAVED",
        missing_fields: [],
        transaction_id: "10000000-0000-4000-8000-000000000004",
      });
    });

    const result = await saveConfirmedTransaction({
      supabase: { from } as unknown as SupabaseClient,
      userId: "10000000-0000-4000-8000-000000000002",
      conversationId: "10000000-0000-4000-8000-000000000003",
      draftId: "10000000-0000-4000-8000-000000000001",
    });

    expect(result.alreadySaved).toBe(true);
    expect(result.transactionId).toBe("10000000-0000-4000-8000-000000000004");
    expect(result.draft).toMatchObject({
      amount: 45,
      date: "2026-07-10",
      category: "comida",
      merchant: "KFC",
    });
    expect(from).toHaveBeenCalledTimes(1);
  });
});
