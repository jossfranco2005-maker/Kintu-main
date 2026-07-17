import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/lib/ai/structured.server", () => ({ generateStructured: generateStructuredMock }));

import { chooseInsightsWithModel } from "@/lib/agents/insight-agent.server";
import type { FinancialInsightCandidate } from "@/lib/finance/insights";

const candidates: FinancialInsightCandidate[] = [
  {
    id: "budget_warning:food",
    kind: "budget_warning",
    priority: 90,
    title: "Presupuesto cerca del límite",
    message: "Hecho verificado A",
  },
  {
    id: "positive_balance:general",
    kind: "positive_balance",
    priority: 55,
    title: "Balance positivo",
    message: "Hecho verificado B",
  },
];

describe("structured insight selection integration", () => {
  beforeEach(() => generateStructuredMock.mockReset());

  it("consume selected_ids válido sin entrar al fallback", async () => {
    generateStructuredMock.mockResolvedValue({
      selected_ids: ["positive_balance:general"],
      closing: null,
    });

    const result = await chooseInsightsWithModel({ userText: "¿Cómo voy?", candidates });
    expect(result.selected.map((candidate) => candidate.id)).toEqual(["positive_balance:general"]);
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });
});
