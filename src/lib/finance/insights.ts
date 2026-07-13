import { budgetState } from "@/lib/finance/budget";
import { formatMoney } from "@/lib/finance/categorize";

export type InsightTransaction = {
  type: "income" | "expense";
  amount: number;
  category: string;
};

export type InsightBudget = {
  id: string;
  category: string;
  limitAmount: number;
  alertThreshold: number;
};

export type PeriodFinancialSummary = {
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
  byCategory: Record<string, number>;
  incomeByCategory?: Record<string, number>;
  expenseByCategory?: Record<string, number>;
};

export type FinancialInsightSnapshot = {
  month: string;
  current: PeriodFinancialSummary;
  previous: PeriodFinancialSummary;
  budgets: InsightBudget[];
};

export type FinancialInsightKind =
  | "no_data"
  | "budget_exceeded"
  | "budget_warning"
  | "negative_balance"
  | "expense_growth"
  | "expense_decrease"
  | "top_category"
  | "missing_budget"
  | "positive_balance";

export type FinancialInsightCandidate = {
  id: string;
  kind: FinancialInsightKind;
  priority: number;
  title: string;
  message: string;
};

export function summarizeInsightTransactions(
  transactions: InsightTransaction[],
): PeriodFinancialSummary {
  const byCategory: Record<string, number> = {};
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};
  let income = 0;
  let expense = 0;

  for (const transaction of transactions) {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const category = transaction.category || "otros";
    if (transaction.type === "income") {
      income += amount;
      incomeByCategory[category] = (incomeByCategory[category] || 0) + amount;
      continue;
    }

    expense += amount;
    byCategory[category] = (byCategory[category] || 0) + amount;
    expenseByCategory[category] = (expenseByCategory[category] || 0) + amount;
  }

  return {
    income,
    expense,
    net: income - expense,
    transactionCount: transactions.length,
    byCategory,
    incomeByCategory,
    expenseByCategory,
  };
}

function percentageChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function percentageOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function displayCategory(category: string): string {
  if (!category) return "Otros";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function insightId(kind: FinancialInsightKind, suffix = "general"): string {
  return `${kind}:${suffix}`;
}

export function buildFinancialInsightCandidates(
  snapshot: FinancialInsightSnapshot,
): FinancialInsightCandidate[] {
  const { current, previous, budgets } = snapshot;
  const candidates: FinancialInsightCandidate[] = [];

  if (current.transactionCount === 0) {
    return [
      {
        id: insightId("no_data"),
        kind: "no_data",
        priority: 100,
        title: "Aún no hay movimientos confirmados",
        message:
          "Todavía no tengo movimientos confirmados de este mes para analizar. Registra ingresos o gastos y podré darte un resumen personalizado.",
      },
    ];
  }

  for (const budget of budgets) {
    const spent = current.byCategory[budget.category] || 0;
    const state = budgetState({
      spent,
      limitAmount: budget.limitAmount,
      alertThreshold: budget.alertThreshold,
    });

    if (state === "exceeded") {
      candidates.push({
        id: insightId("budget_exceeded", budget.id),
        kind: "budget_exceeded",
        priority: 100,
        title: `Presupuesto excedido en ${displayCategory(budget.category)}`,
        message: `En ${displayCategory(budget.category)} llevas ${formatMoney(spent)} frente a un límite de ${formatMoney(budget.limitAmount)}; el exceso es de ${formatMoney(Math.max(0, spent - budget.limitAmount))}.`,
      });
      continue;
    }

    if (state === "warning") {
      const percentage = percentageOf(spent, budget.limitAmount);
      candidates.push({
        id: insightId("budget_warning", budget.id),
        kind: "budget_warning",
        priority: 90,
        title: `Presupuesto cerca del límite en ${displayCategory(budget.category)}`,
        message: `Has utilizado el ${Math.round(percentage)}% del presupuesto de ${displayCategory(budget.category)}; te quedan ${formatMoney(Math.max(0, budget.limitAmount - spent))}.`,
      });
    }
  }

  if (current.net < 0) {
    candidates.push({
      id: insightId("negative_balance"),
      kind: "negative_balance",
      priority: 95,
      title: "Balance mensual negativo",
      message: `Este mes tus gastos superan tus ingresos por ${formatMoney(Math.abs(current.net))}.`,
    });
  } else if (current.income > 0 && current.net > 0) {
    const margin = percentageOf(current.net, current.income);
    candidates.push({
      id: insightId("positive_balance"),
      kind: "positive_balance",
      priority: 55,
      title: "Balance mensual positivo",
      message: `Mantienes un balance positivo de ${formatMoney(current.net)}, equivalente al ${Math.round(margin)}% de tus ingresos del mes.`,
    });
  }

  const expenseChange = percentageChange(current.expense, previous.expense);
  if (expenseChange !== null && expenseChange >= 10) {
    candidates.push({
      id: insightId("expense_growth"),
      kind: "expense_growth",
      priority: 80,
      title: "Tus gastos aumentaron",
      message: `Tus gastos subieron ${Math.round(expenseChange)}% frente al mes anterior, de ${formatMoney(previous.expense)} a ${formatMoney(current.expense)}.`,
    });
  } else if (expenseChange !== null && expenseChange <= -10) {
    candidates.push({
      id: insightId("expense_decrease"),
      kind: "expense_decrease",
      priority: 50,
      title: "Tus gastos disminuyeron",
      message: `Tus gastos bajaron ${Math.round(Math.abs(expenseChange))}% frente al mes anterior.`,
    });
  }

  const topCategory = Object.entries(current.byCategory).sort(
    (first, second) => second[1] - first[1],
  )[0];

  if (topCategory) {
    const [category, amount] = topCategory;
    const share = percentageOf(amount, current.expense);

    if (share >= 35) {
      candidates.push({
        id: insightId("top_category", category),
        kind: "top_category",
        priority: 70,
        title: `Mayor concentración en ${displayCategory(category)}`,
        message: `${displayCategory(category)} representa el ${Math.round(share)}% de tus gastos del mes, con ${formatMoney(amount)} acumulados.`,
      });
    }

    const hasBudget = budgets.some((budget) => budget.category === category);
    if (!hasBudget && amount > 0) {
      candidates.push({
        id: insightId("missing_budget", category),
        kind: "missing_budget",
        priority: 60,
        title: `Sin presupuesto en ${displayCategory(category)}`,
        message: `${displayCategory(category)} es una de tus categorías principales y aún no tiene un presupuesto mensual definido.`,
      });
    }
  }

  return candidates.sort((first, second) => {
    if (first.priority !== second.priority) return second.priority - first.priority;
    return first.id.localeCompare(second.id);
  });
}

export function buildDeterministicFinancialSummary(
  snapshot: FinancialInsightSnapshot,
  selectedCandidates?: FinancialInsightCandidate[],
  closing?: string | null,
): string {
  const { current } = snapshot;
  const candidates = selectedCandidates ?? buildFinancialInsightCandidates(snapshot).slice(0, 2);

  if (current.transactionCount === 0) {
    return candidates[0]?.message ?? "Todavía no hay movimientos confirmados este mes.";
  }

  const parts = [
    `Este mes registras ingresos por ${formatMoney(current.income)}, gastos por ${formatMoney(current.expense)} y un balance de ${formatMoney(current.net)}.`,
    ...candidates.map((candidate) => candidate.message),
  ];

  if (closing?.trim()) {
    parts.push(closing.trim());
  }

  return parts.join(" ");
}
