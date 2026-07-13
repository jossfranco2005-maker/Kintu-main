import type { SupabaseClient } from "@supabase/supabase-js";

import {
  alertMessage,
  budgetState,
  evaluateBudget,
  nextMonthStart,
  type BudgetRow,
  type BudgetState,
  type BudgetStatus,
} from "@/lib/finance/budget";
import {
  collectAffectedBudgetBuckets,
  previousSpentFromCurrent,
  type MovementChange,
} from "@/lib/finance/movement-effects";

export type BudgetEffectAlert = {
  alertId: string;
  budgetId: string;
  category: string;
  level: "threshold" | "exceeded";
  message: string;
  percentage: number;
};

type StoredBudget = {
  id: string;
  user_id: string;
  category: string;
  month: string;
  limit_amount: number | string;
  alert_threshold: number | string;
};

function toBudgetRow(budget: StoredBudget): BudgetRow {
  return {
    id: budget.id,
    category: budget.category,
    month: budget.month,
    limit_amount: Number(budget.limit_amount),
    alert_threshold: Number(budget.alert_threshold),
  };
}

async function calculateMonthlySpent(params: {
  supabase: SupabaseClient;
  userId: string;
  category: string;
  month: string;
}): Promise<number> {
  const monthEnd = nextMonthStart(params.month);
  const { data: transactions, error } = await params.supabase
    .from("transactions")
    .select("amount")
    .eq("user_id", params.userId)
    .eq("type", "expense")
    .eq("status", "confirmed")
    .eq("category", params.category)
    .gte("date", params.month)
    .lt("date", monthEnd);

  if (error) {
    throw new Error(`No se pudo calcular el gasto mensual: ${error.message}`);
  }

  return (transactions || []).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
}

async function acknowledgeStaleBudgetAlerts(params: {
  supabase: SupabaseClient;
  userId: string;
  budgetId: string;
  state: BudgetState;
}): Promise<void> {
  const staleLevels: Array<"threshold" | "exceeded"> =
    params.state === "normal"
      ? ["threshold", "exceeded"]
      : params.state === "warning"
        ? ["exceeded"]
        : ["threshold"];

  const { error } = await params.supabase
    .from("alerts")
    .update({ acknowledged: true })
    .eq("user_id", params.userId)
    .eq("budget_id", params.budgetId)
    .eq("acknowledged", false)
    .in("level", staleLevels);

  if (error) {
    throw new Error(`No se pudieron cerrar alertas anteriores: ${error.message}`);
  }
}

async function insertBudgetAlert(params: {
  supabase: SupabaseClient;
  userId: string;
  budget: BudgetRow;
  status: BudgetStatus;
  level: "threshold" | "exceeded";
}): Promise<BudgetEffectAlert | null> {
  const { data: duplicate, error: duplicateError } = await params.supabase
    .from("alerts")
    .select("id")
    .eq("user_id", params.userId)
    .eq("budget_id", params.budget.id)
    .eq("level", params.level)
    .eq("acknowledged", false)
    .limit(1)
    .maybeSingle();

  if (duplicateError) {
    throw new Error(`No se pudo verificar alertas previas: ${duplicateError.message}`);
  }
  if (duplicate) return null;

  const message = alertMessage(params.status);
  const percentage = Math.min(999, Math.round(params.status.percentage * 100));
  const { data: insertedAlert, error: alertError } = await params.supabase
    .from("alerts")
    .insert({
      budget_id: params.budget.id,
      user_id: params.userId,
      level: params.level,
      percentage,
      message,
    })
    .select("id")
    .single();

  if (alertError || !insertedAlert) {
    throw new Error(alertError?.message || "No se pudo crear la alerta presupuestaria.");
  }

  return {
    alertId: insertedAlert.id,
    budgetId: params.budget.id,
    category: params.budget.category,
    level: params.level,
    message,
    percentage,
  };
}

/**
 * Evalúa un presupuesto recién creado o editado contra los gastos que ya
 * existen. Así un presupuesto que nace por debajo del gasto actual también
 * produce una alerta y su notificación correspondiente.
 */
export async function syncBudgetCurrentState(params: {
  supabase: SupabaseClient;
  userId: string;
  budgetId: string;
}): Promise<BudgetEffectAlert[]> {
  const { data: storedBudget, error: budgetError } = await params.supabase
    .from("budgets")
    .select("id, user_id, category, month, limit_amount, alert_threshold")
    .eq("id", params.budgetId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (budgetError) {
    throw new Error(`No se pudo revisar el presupuesto: ${budgetError.message}`);
  }
  if (!storedBudget) return [];

  const budget = toBudgetRow(storedBudget as StoredBudget);
  const currentSpent = await calculateMonthlySpent({
    supabase: params.supabase,
    userId: params.userId,
    category: budget.category,
    month: budget.month,
  });
  const state = budgetState({
    spent: currentSpent,
    limitAmount: budget.limit_amount,
    alertThreshold: budget.alert_threshold,
  });

  await acknowledgeStaleBudgetAlerts({
    supabase: params.supabase,
    userId: params.userId,
    budgetId: budget.id,
    state,
  });

  if (state === "normal") return [];

  const status = evaluateBudget(budget, currentSpent, 0);
  const level: "threshold" | "exceeded" = state === "exceeded" ? "exceeded" : "threshold";
  const created = await insertBudgetAlert({
    supabase: params.supabase,
    userId: params.userId,
    budget,
    status,
    level,
  });

  return created ? [created] : [];
}

/**
 * Recalcula los presupuestos afectados por cambios ya persistidos. Solo crea
 * una alerta cuando el cambio cruza el umbral o el límite. También cierra la
 * alerta anterior cuando el presupuesto cambia de estado.
 */
export async function syncBudgetEffects(params: {
  supabase: SupabaseClient;
  userId: string;
  changes: MovementChange[];
}): Promise<BudgetEffectAlert[]> {
  const { supabase, userId, changes } = params;
  const alerts: BudgetEffectAlert[] = [];

  for (const bucket of collectAffectedBudgetBuckets(changes)) {
    const { data: storedBudget, error: budgetError } = await supabase
      .from("budgets")
      .select("id, user_id, category, month, limit_amount, alert_threshold")
      .eq("user_id", userId)
      .eq("category", bucket.category)
      .eq("month", bucket.month)
      .maybeSingle();

    if (budgetError) {
      throw new Error(`No se pudo revisar el presupuesto: ${budgetError.message}`);
    }
    if (!storedBudget) continue;

    const budget = toBudgetRow(storedBudget as StoredBudget);
    const currentSpent = await calculateMonthlySpent({
      supabase,
      userId,
      category: bucket.category,
      month: bucket.month,
    });
    const previousSpent = previousSpentFromCurrent(currentSpent, changes, bucket);
    const status = evaluateBudget(budget, currentSpent, previousSpent);

    await acknowledgeStaleBudgetAlerts({
      supabase,
      userId,
      budgetId: budget.id,
      state: status.state,
    });

    if (!status.crossedThreshold && !status.exceeded) continue;

    const level: "threshold" | "exceeded" = status.exceeded ? "exceeded" : "threshold";
    const created = await insertBudgetAlert({
      supabase,
      userId,
      budget,
      status,
      level,
    });

    if (created) alerts.push(created);
  }

  return alerts;
}
