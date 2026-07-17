import { describe, expect, it } from "vitest";

import { DraftTurnDecisionSchema } from "@/lib/agents/draft-turn-decision.server";
import { ExpenseCorrectionSchema, ExpenseFollowUpSchema } from "@/lib/agents/expense-flow";
import {
  FinancialResponsePlanSchema,
  HypotheticalExpenseSchema,
  InsightSelectionSchema,
} from "@/lib/agents/insight-agent.server";
import {
  BudgetIntentSchema,
  ExpenseExtractSchema,
  MessageUnderstandingSchema,
  NotificationDecisionSchema,
} from "@/lib/agents/schemas";
import {
  GeneralEducationSchema,
  SupportAnswerSchema,
  SupportSituationSchema,
} from "@/lib/agents/support-flow.server";

function expectEveryKeyRequired(
  schema: { safeParse: (value: unknown) => { success: boolean } },
  complete: Record<string, unknown>,
) {
  expect(schema.safeParse(complete).success).toBe(true);
  for (const key of Object.keys(complete)) {
    const incomplete = { ...complete };
    delete incomplete[key];
    expect(schema.safeParse(incomplete).success, `${key} debe ser requerido`).toBe(false);
  }
}

describe("strict structured-output contracts", () => {
  it("exige el plan financiero completo", () => {
    expectEveryKeyRequired(FinancialResponsePlanSchema, {
      fact_ids: ["net"],
      coverage: "single",
      style: "brief",
      format: "sentence",
      answer: "Balance verificado.",
      introduction: null,
      items: [],
      closing: null,
    });
  });

  it("exige selected_ids y closing en insights", () => {
    expectEveryKeyRequired(InsightSelectionSchema, {
      selected_ids: ["net"],
      closing: null,
    });
  });

  it("exige todos los campos de situación de soporte", () => {
    expectEveryKeyRequired(SupportSituationSchema, {
      state: "emotion_only",
      category: null,
      priority: null,
      subject: "current_user",
      reason: "Emoción aislada",
    });
  });

  it("exige el contrato completo de comprensión", () => {
    expectEveryKeyRequired(MessageUnderstandingSchema, {
      intent: "summary",
      transactionType: null,
      speechAct: "question",
      occurred: null,
      negated: false,
      future: false,
      hypothetical: false,
      correction: false,
      multipleOperations: false,
      confidence: 0.95,
      budgetAction: "none",
      dismissPendingState: false,
      currentRequestText: null,
    });
  });

  it("exige currentRequestText incluso cuando es null", () => {
    expectEveryKeyRequired(DraftTurnDecisionSchema, {
      action: "continue_draft",
      confidence: 0.9,
      reason: "Continúa el borrador",
      currentRequestText: null,
    });
  });

  it("mantiene requeridos los demás contratos estructurados", () => {
    expectEveryKeyRequired(ExpenseExtractSchema, {
      type: "expense",
      amount: 10,
      currency: "USD",
      date: "2026-07-17",
      category: "comida",
      merchant: "KFC",
      description: null,
    });
    expectEveryKeyRequired(BudgetIntentSchema, {
      category: null,
      limit_amount: null,
      alert_threshold: null,
    });
    expectEveryKeyRequired(NotificationDecisionSchema, {
      should_notify: false,
      level: null,
      title: null,
      message: null,
    });
    expectEveryKeyRequired(ExpenseFollowUpSchema, {
      amount: null,
      date: null,
      category: null,
      merchant: null,
      description: null,
    });
    expectEveryKeyRequired(ExpenseCorrectionSchema, {
      type: null,
      amount: null,
      date: null,
      category: null,
      merchant: null,
      description: null,
    });
    expectEveryKeyRequired(SupportAnswerSchema, {
      can_answer: false,
      answer: null,
      used_article_ids: [],
      missing_reason: null,
    });
    expectEveryKeyRequired(GeneralEducationSchema, { answer: "Información general." });
    expectEveryKeyRequired(HypotheticalExpenseSchema, { amount: null, category: null });
  });
});
