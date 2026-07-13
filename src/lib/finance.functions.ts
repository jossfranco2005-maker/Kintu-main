import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { budgetState, firstOfMonth, nextMonthStart } from "@/lib/finance/budget";
import { normalizeCategory } from "@/lib/finance/categorize";
import { monthRangeForIsoDate, shiftIsoDate } from "@/lib/finance/date";
import { buildDailySeries } from "@/lib/finance/dashboard";
import {
  syncBudgetCurrentState,
  type BudgetEffectAlert,
} from "@/lib/finance/movement-effects.server";

export const listBudgets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const month = firstOfMonth();
    const monthEnd = nextMonthStart(month);
    const { data: budgets } = await supabase
      .from("budgets")
      .select("*")
      .eq("user_id", userId)
      .eq("month", month);
    const { data: txs } = await supabase
      .from("transactions")
      .select("category, amount")
      .eq("user_id", userId)
      .eq("type", "expense")
      .eq("status", "confirmed")
      .gte("date", month)
      .lt("date", monthEnd);
    const spentByCat: Record<string, number> = {};
    (txs || []).forEach((t) => {
      spentByCat[t.category] = (spentByCat[t.category] || 0) + Number(t.amount);
    });
    return {
      month,
      budgets: (budgets || []).map((b) => {
        const limitAmount = Number(b.limit_amount);
        const alertThreshold = Number(b.alert_threshold);
        const spent = spentByCat[b.category] || 0;
        const percentage = limitAmount > 0 ? spent / limitAmount : 0;

        return {
          ...b,
          limit_amount: limitAmount,
          alert_threshold: alertThreshold,
          threshold_percentage: Math.round(alertThreshold * 100),
          spent,
          percentage,
          remaining: Math.max(0, limitAmount - spent),
          overage: Math.max(0, spent - limitAmount),
          state: budgetState({ spent, limitAmount, alertThreshold }),
        };
      }),
    };
  });

export const upsertBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        category: z.string().min(1),
        limit_amount: z.number().positive(),
        alert_threshold: z.number().min(0.1).max(1),
        // Cuando el usuario elige "Otra categoría..." en el form, el
        // nombre debe conservarse tal cual (solo trim/lowercase), sin
        // pasar por normalizeCategory — esa función mapea texto libre a
        // una de las categorías fijas y cualquier cosa que no reconozca
        // termina cayendo en "otros", perdiendo la categoría personalizada.
        isCustom: z.boolean().optional().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const month = firstOfMonth();
    const category = data.isCustom
      ? data.category.trim().toLowerCase()
      : normalizeCategory(data.category);
    const { data: budget, error } = await supabase
      .from("budgets")
      .upsert(
        {
          user_id: userId,
          category,
          month,
          limit_amount: data.limit_amount,
          alert_threshold: data.alert_threshold,
        },
        { onConflict: "user_id,category,month" },
      )
      .select("id")
      .single();

    if (error || !budget) throw new Error(error?.message || "No se pudo guardar el presupuesto.");

    let alerts: BudgetEffectAlert[] = [];
    try {
      alerts = await syncBudgetCurrentState({ supabase, userId, budgetId: budget.id });
    } catch (syncError) {
      console.error("[budgets] No se pudo sincronizar la alerta del presupuesto:", syncError);
    }

    return { ok: true, category, alerts };
  });

export const deleteBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("budgets")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const month = firstOfMonth();
    const monthEnd = nextMonthStart(month);
    const { data: txs } = await supabase
      .from("transactions")
      .select("type, amount, category")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .gte("date", month)
      .lt("date", monthEnd);
    const incomeTxs = (txs || []).filter((t) => t.type === "income");
    const expenseTxs = (txs || []).filter((t) => t.type === "expense");
    const income = incomeTxs.reduce((s, t) => s + Number(t.amount), 0);
    const expense = expenseTxs.reduce((s, t) => s + Number(t.amount), 0);
    return {
      income,
      expense,
      net: income - expense,
      month,
      // Conteo de transacciones — el KintuAvatar lo usa para agregar/
      // marchitar exactamente una hoja por movimiento, no por monto.
      incomeCount: incomeTxs.length,
      expenseCount: expenseTxs.length,
    };
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const month = firstOfMonth();
    const monthEnd = nextMonthStart(month);

    // Previous month range, derived from the Ecuador-local current month.
    const prevMonth = monthRangeForIsoDate(shiftIsoDate(month, -1)).start;

    const [
      { data: monthTxs },
      { data: prevTxs },
      { data: recent },
      { data: alerts },
      { data: budgets },
    ] = await Promise.all([
      supabase
        .from("transactions")
        .select("type, amount, category, date")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .gte("date", month)
        .lt("date", monthEnd),
      supabase
        .from("transactions")
        .select("type, amount")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .gte("date", prevMonth)
        .lt("date", month),
      supabase
        .from("transactions")
        .select("id, type, amount, category, merchant, description, date, created_at")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("alerts")
        .select("id, level, message, created_at, acknowledged")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("budgets").select("*").eq("user_id", userId).eq("month", month),
    ]);

    const incomeTxs = (monthTxs || []).filter((t) => t.type === "income");
    const expenseTxs = (monthTxs || []).filter((t) => t.type === "expense");
    const income = incomeTxs.reduce((s, t) => s + Number(t.amount), 0);
    const expense = expenseTxs.reduce((s, t) => s + Number(t.amount), 0);
    const prevExpense = (prevTxs || [])
      .filter((t) => t.type === "expense")
      .reduce((s, t) => s + Number(t.amount), 0);
    const prevIncome = (prevTxs || [])
      .filter((t) => t.type === "income")
      .reduce((s, t) => s + Number(t.amount), 0);

    const byCategory: Record<string, number> = {};
    expenseTxs.forEach((t) => {
      byCategory[t.category] = (byCategory[t.category] || 0) + Number(t.amount);
    });
    const categories = Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    const incomeSeries = buildDailySeries(monthTxs || [], "income");
    const expenseSeries = buildDailySeries(monthTxs || [], "expense");

    const spentByCat: Record<string, number> = {};
    expenseTxs.forEach((t) => {
      spentByCat[t.category] = (spentByCat[t.category] || 0) + Number(t.amount);
    });

    return {
      month,
      income,
      expense,
      net: income - expense,
      prevExpense,
      prevIncome,
      categories,
      incomeSeries,
      expenseSeries,
      // Kept for compatibility with older consumers while they migrate.
      series: expenseSeries,
      recent: (recent || []).map((t) => ({ ...t, amount: Number(t.amount) })),
      alerts: alerts || [],
      budgets: (budgets || []).map((b) => {
        const limitAmount = Number(b.limit_amount);
        const alertThreshold = Number(b.alert_threshold);
        const spent = spentByCat[b.category] || 0;

        return {
          ...b,
          limit_amount: limitAmount,
          alert_threshold: alertThreshold,
          threshold_percentage: Math.round(alertThreshold * 100),
          spent,
          percentage: limitAmount > 0 ? spent / limitAmount : 0,
          remaining: Math.max(0, limitAmount - spent),
          overage: Math.max(0, spent - limitAmount),
          state: budgetState({ spent, limitAmount, alertThreshold }),
        };
      }),
      transactionCount: (monthTxs || []).length,
      // Conteo de transacciones por tipo — el KintuAvatar lo usa para
      // agregar/marchitar exactamente una hoja por movimiento.
      incomeCount: incomeTxs.length,
      expenseCount: expenseTxs.length,
    };
  });

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("alerts")
      .select("id, level, percentage, message, acknowledged, created_at, budget_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    const alerts = (data || []).map((a) => ({
      ...a,
      percentage: Number(a.percentage),
    }));
    return { alerts, unread: alerts.filter((a) => !a.acknowledged).length };
  });

export const acknowledgeAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("alerts").update({ acknowledged: true }).eq("user_id", userId);
    if (data.ids && data.ids.length) q = q.in("id", data.ids);
    else q = q.eq("acknowledged", false);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        category: z.string(),
        amount: z.number().gt(0, "El monto debe ser mayor a 0"),
        month: z.string(),
        alert_threshold: z.number().optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { category, amount, month, alert_threshold } = data;
    const { data: existing } = await supabase
      .from("budgets")
      .select("id")
      .eq("user_id", userId)
      .eq("category", category)
      .eq("month", month)
      .single();
    if (existing) throw new Error("Ya existe un presupuesto para esta categoría en este mes");
    const { data: budget, error } = await supabase
      .from("budgets")
      .insert({
        user_id: userId,
        category,
        limit_amount: amount,
        alert_threshold: alert_threshold ?? 0.8,
        month,
      })
      .select("id")
      .single();

    if (error || !budget) throw new Error(error?.message || "No se pudo crear el presupuesto.");

    let alerts: BudgetEffectAlert[] = [];
    try {
      alerts = await syncBudgetCurrentState({ supabase, userId, budgetId: budget.id });
    } catch (syncError) {
      console.error("[budgets] No se pudo sincronizar la alerta del presupuesto:", syncError);
    }

    return { ok: true, alerts };
  });
