// Deterministic budget math. LLM never returns a number that becomes a DB write.

import { currentMonthRangeInEcuador, monthRangeForIsoDate } from "@/lib/finance/date";

export type BudgetRow = {
  id: string;
  category: string;
  month: string; // YYYY-MM-DD (first day)
  limit_amount: number;
  alert_threshold: number;
};

export type BudgetState = "normal" | "warning" | "exceeded";

export type BudgetStatus = {
  budget: BudgetRow;
  spent: number;
  percentage: number; // 0-1+
  thresholdPercentage: number; // 0-1
  state: BudgetState;
  crossedThreshold: boolean;
  exceeded: boolean;
  remaining: number;
  overage: number;
};

export function firstOfMonth(d: Date = new Date()): string {
  return currentMonthRangeInEcuador(d).start;
}

export function nextMonthStart(monthStart: string): string {
  return monthRangeForIsoDate(monthStart).end;
}

export function budgetState(params: {
  spent: number;
  limitAmount: number;
  alertThreshold: number;
}): BudgetState {
  const { spent, limitAmount, alertThreshold } = params;

  if (limitAmount <= 0) return "normal";
  if (spent >= limitAmount) return "exceeded";
  if (spent >= limitAmount * alertThreshold) return "warning";
  return "normal";
}

export function evaluateBudget(
  budget: BudgetRow,
  monthSpent: number,
  previousSpent: number,
): BudgetStatus {
  const percentage = budget.limit_amount > 0 ? monthSpent / budget.limit_amount : 0;
  const thresholdAmt = budget.limit_amount * budget.alert_threshold;
  const wasBelow = previousSpent < thresholdAmt;
  const nowAtOrAbove = monthSpent >= thresholdAmt;
  const wasNotExceeded = previousSpent < budget.limit_amount;
  const nowExceeded = monthSpent >= budget.limit_amount;

  return {
    budget,
    spent: monthSpent,
    percentage,
    thresholdPercentage: budget.alert_threshold,
    state: budgetState({
      spent: monthSpent,
      limitAmount: budget.limit_amount,
      alertThreshold: budget.alert_threshold,
    }),
    crossedThreshold: wasBelow && nowAtOrAbove,
    exceeded: wasNotExceeded && nowExceeded,
    remaining: Math.max(0, budget.limit_amount - monthSpent),
    overage: Math.max(0, monthSpent - budget.limit_amount),
  };
}

export function alertMessage(status: BudgetStatus): string {
  const pct = Math.round(status.percentage * 100);
  if (status.exceeded) {
    return `Cruzaste el presupuesto de ${status.budget.category}: llevas ${pct}% de USD ${status.budget.limit_amount.toFixed(0)} y te excediste por USD ${status.overage.toFixed(2)}. Vale la pena revisar en qué se está yendo este mes.`;
  }
  return `Vas en ${pct}% del presupuesto de ${status.budget.category}. Te quedan USD ${status.remaining.toFixed(2)} para lo que resta del mes.`;
}
