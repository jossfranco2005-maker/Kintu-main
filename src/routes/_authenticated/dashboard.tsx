import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "@/lib/finance.functions";
import { getNotifications } from "@/lib/notifications.functions";
import { KintuAvatar, deriveKintuLevel, KintuLevelBar } from "@/components/kintu/KintuAvatar";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  Eye,
  EyeOff,
  Lightbulb,
  ChevronRight,
  Bell,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

const CATEGORY_LABEL: Record<string, string> = {
  comida: "Comida",
  transporte: "Transporte",
  servicios: "Servicios",
  entretenimiento: "Entretenimiento",
  salud: "Salud",
  hogar: "Hogar",
  educacion: "Educación",
  ropa: "Ropa",
  otros: "Otros",
};

const CATEGORY_EMOJI: Record<string, string> = {
  comida: "🍔",
  transporte: "🚗",
  servicios: "💡",
  entretenimiento: "🎬",
  salud: "🩺",
  hogar: "🏠",
  educacion: "📚",
  ropa: "👕",
  otros: "📦",
};

const SEGMENT_COLORS: Record<string, string> = {
  comida: "#7C6FE0",
  servicios: "#F59E0B",
  entretenimiento: "#3B82F6",
  transporte: "#EF4444",
  salud: "#EC4899",
  hogar: "#64748B",
  educacion: "#22C55E",
  ropa: "#F97316",
  otros: "#94A3B8",
};

const monthName = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("es-EC", { month: "long", year: "numeric", timeZone: "UTC" });
};

const money = (n: number) =>
  n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function buildSparkPath(series: { amount: number }[]) {
  if (series.length < 2) return "";
  const max = Math.max(1, ...series.map((s) => s.amount));
  const pts = series.map((s, i) => ({
    x: (i / (series.length - 1)) * 100,
    y: 36 - (s.amount / max) * 32,
  }));
  return "M " + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ");
}

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const dashFn = useServerFn(getDashboard);
  const notificationsFn = useServerFn(getNotifications);
  const navigate = useNavigate();
  const [hideBalance, setHideBalance] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      return data;
    },
    enabled: !!user?.id,
  });

  const q = useQuery({
    queryKey: ["finance", "dashboard"],
    queryFn: () => dashFn(),
    refetchInterval: 30000,
  });
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsFn(),
    refetchInterval: 30000,
  });

  const d = q.data;
  const unreadNotifications = notificationsQuery.data?.unreadCount ?? 0;

  if (q.isLoading || !d) {
    return (
      <div className="flex-1 mx-auto w-full max-w-6xl px-6 py-10">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 rounded-md bg-muted" />
          <div className="grid md:grid-cols-3 gap-6">
            <div className="h-40 rounded-3xl bg-muted" />
            <div className="h-40 rounded-3xl bg-muted" />
            <div className="h-40 rounded-3xl bg-muted" />
          </div>
          <div className="h-72 rounded-3xl bg-muted" />
        </div>
      </div>
    );
  }

  const expenseDelta =
    d.prevExpense === 0 ? 0 : ((d.expense - d.prevExpense) / d.prevExpense) * 100;
  const prevNet = d.prevIncome - d.prevExpense;
  const netDelta = prevNet === 0 ? 0 : ((d.net - prevNet) / Math.abs(prevNet)) * 100;
  const savingsRate =
    d.income > 0 ? Math.max(0, Math.min(100, ((d.income - d.expense) / d.income) * 100)) : 0;
  const totalCatExpense = d.categories.reduce((s, c) => s + c.amount, 0) || 1;
  const { level: treeLevel, progressPct: treeProgress } = deriveKintuLevel(savingsRate);

  const RADIUS = 42;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const gaugeOffset = CIRCUMFERENCE * (1 - savingsRate / 100);
  const savingsMsg =
    savingsRate >= 40
      ? "¡Vas por buen camino!"
      : savingsRate >= 15
        ? "Vas bien, seguí así."
        : "Intenta ahorrar un poco más.";

  const topCategories = d.categories.slice(0, 4);
  let cumulative = 0;
  const donutSegments = topCategories.map((c) => {
    const pct = c.amount / totalCatExpense;
    const dash = pct * CIRCUMFERENCE;
    const seg = {
      color: SEGMENT_COLORS[c.category] ?? "#94A3B8",
      dasharray: `${dash} ${CIRCUMFERENCE - dash}`,
      dashoffset: -cumulative * CIRCUMFERENCE,
    };
    cumulative += pct;
    return seg;
  });

  const expenseSpark = buildSparkPath(d.expenseSeries);
  const incomeSpark = buildSparkPath(d.incomeSeries);

  const worstBudget = d.budgets.length
    ? [...d.budgets].sort(
        (a, b) =>
          Number(b.spent) / Number(b.limit_amount) - Number(a.spent) / Number(a.limit_amount),
      )[0]
    : null;
  const worstPct = worstBudget
    ? Math.round((Number(worstBudget.spent) / Number(worstBudget.limit_amount)) * 100)
    : 0;
  const worstState = worstBudget?.state ?? "normal";
  const worstOver = worstState === "exceeded";
  const worstWarning = worstState === "warning";
  const topCategory = topCategories[0];
  const topCategoryOverBudget =
    topCategory && worstBudget && worstBudget.category === topCategory.category ? worstOver : false;

  const mask = (value: string) => (hideBalance ? "••••••" : value);

  const displayName = profileQuery.data?.display_name || user?.email?.split("@")[0] || "Kintu";

  return (
    <div className="flex-1 w-full px-6 py-8 space-y-6 bg-[#F5F4FA] dark:bg-[#15132A] min-h-screen overflow-x-hidden">
      {/* HEADER */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            ¡Hola, {displayName}! <span aria-hidden>👋</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Mantén tu bienestar financiero y observa tu crecimiento.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to="/notifications"
            aria-label={`Notificaciones${unreadNotifications > 0 ? `: ${unreadNotifications} sin leer` : ""}`}
            className="relative w-10 h-10 rounded-full bg-white dark:bg-card border border-gray-200 dark:border-hairline flex items-center justify-center shadow-sm hover:bg-gray-50 dark:hover:bg-card/70 transition-colors"
          >
            <Bell className="w-4 h-4 text-foreground" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#7C6FE0] text-white text-[10px] font-bold flex items-center justify-center">
                {Math.min(unreadNotifications, 99)}
              </span>
            )}
          </Link>
          <div
            aria-label={`Periodo mostrado: ${monthName(d.month)}`}
            className="flex items-center px-4 py-2.5 rounded-full bg-white dark:bg-card border border-gray-200 dark:border-hairline shadow-sm text-sm font-semibold capitalize"
          >
            {monthName(d.month)}
          </div>
        </div>
      </header>

      {/* ROW 1: Balance / Tasa de Ahorro / Árbol */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#2B1B55] to-[#4C3A8C] text-white min-w-0 p-6 flex flex-col justify-between shadow-sm min-h-[168px]">
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 90% 0%, rgba(124,111,224,0.55), transparent 55%)",
            }}
          />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-white/55 font-bold">
                Balance Neto
              </p>
              <p className="text-[11px] text-white/35 mt-0.5">USD</p>
            </div>
            <button
              onClick={() => setHideBalance((v) => !v)}
              aria-label={hideBalance ? "Mostrar balance" : "Ocultar balance"}
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              {hideBalance ? (
                <EyeOff className="w-4 h-4 text-white/80" />
              ) : (
                <Eye className="w-4 h-4 text-white/80" />
              )}
            </button>
          </div>
          <div className="relative">
            <p className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-none mt-4 break-words">
              {mask(money(d.net))}
            </p>
            {netDelta !== 0 && (
              <span
                className={`mt-3 inline-flex items-center gap-1 text-xs font-bold ${
                  netDelta > 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {netDelta > 0 ? (
                  <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2.5} />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5" strokeWidth={2.5} />
                )}
                {netDelta > 0 ? "+" : ""}
                {netDelta.toFixed(0)}% vs. mes anterior
              </span>
            )}
          </div>
        </div>

        <div className="rounded-3xl bg-white dark:bg-card border border-gray-100 dark:border-hairline min-w-0 p-6 flex flex-col items-center shadow-sm">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold self-start">
            Tasa de Ahorro
          </p>
          <div className="relative w-28 h-28 my-2">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="#EAE5F9" strokeWidth="9" />
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke="#7C6FE0"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={gaugeOffset}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-serif font-bold text-foreground">
                {savingsRate.toFixed(0)}%
              </span>
            </div>
          </div>
          <p className="text-xs font-semibold text-[#7C6FE0] text-center">{savingsMsg}</p>
        </div>

        <div className="rounded-3xl bg-white dark:bg-card border border-gray-100 dark:border-hairline min-w-0 p-5 flex flex-col shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
              El Árbol de Kintu
            </p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#7C6FE0]/10 text-[#4C3A8C] dark:text-[#B9A9F5]">
              Activo
            </span>
          </div>
          <div className="flex-1 flex items-center justify-center py-1 w-full max-w-[130px] mx-auto aspect-square">
            <KintuAvatar
              savingsRate={savingsRate}
              incomes={d.income}
              expenses={d.expense}
              incomeCount={d.incomeCount}
              expenseCount={d.expenseCount}
              size={130}
            />
          </div>
          <KintuLevelBar
            level={treeLevel}
            progressPct={treeProgress}
            className="max-w-[160px] mx-auto w-full"
          />
        </div>
      </div>

      {/* ROW 2: Ingresos / Gastos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-3xl bg-white dark:bg-card border border-gray-100 dark:border-hairline min-w-0 p-6 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
              <ArrowDownRight className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
                Ingresos
              </p>
              <p className="text-lg font-bold text-foreground mt-0.5">
                USD {mask(money(d.income))}
              </p>
              <p className="text-[11px] text-muted-foreground">Este mes</p>
            </div>
          </div>
          {incomeSpark && (
            <svg viewBox="0 0 100 40" className="w-24 h-10 shrink-0">
              <path
                d={incomeSpark}
                fill="none"
                stroke="#16A34A"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </div>

        <div className="rounded-3xl bg-white dark:bg-card border border-gray-100 dark:border-hairline min-w-0 p-6 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-500 shrink-0">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
                Gastos
              </p>
              <p className="text-lg font-bold text-foreground mt-0.5">
                USD {mask(money(d.expense))}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Este mes{" "}
                {expenseDelta !== 0 &&
                  `· ${expenseDelta > 0 ? "+" : ""}${expenseDelta.toFixed(0)}%`}
              </p>
            </div>
          </div>
          {expenseSpark && (
            <svg viewBox="0 0 100 40" className="w-24 h-10 shrink-0">
              <path
                d={expenseSpark}
                fill="none"
                stroke="#F43F5E"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </div>
      </div>

      {/* ROW 3: Distribución / Alertas / Apuntes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ¿Dónde gastaste? */}
        <div className="rounded-3xl bg-white dark:bg-card border border-gray-100 dark:border-hairline min-w-0 p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-foreground">¿Dónde gastaste?</h2>
            <Link
              to="/budgets"
              className="text-[10px] font-bold text-[#4C3A8C] dark:text-[#B9A9F5] uppercase tracking-wider hover:underline"
            >
              Ver detalle →
            </Link>
          </div>
          {d.categories.length === 0 ? (
            <EmptyState text="No hay transacciones aún." />
          ) : (
            <>
              <div className="flex items-center gap-5">
                <div className="relative w-28 h-28 shrink-0">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle
                      cx="50"
                      cy="50"
                      r={RADIUS}
                      fill="none"
                      stroke="#F1EFFB"
                      strokeWidth="14"
                    />
                    {donutSegments.map((seg, i) => (
                      <circle
                        key={i}
                        cx="50"
                        cy="50"
                        r={RADIUS}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="14"
                        strokeDasharray={seg.dasharray}
                        strokeDashoffset={seg.dashoffset}
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[9px] text-muted-foreground">USD</span>
                    <span className="text-base font-bold text-foreground leading-tight">
                      {mask(money(totalCatExpense))}
                    </span>
                    <span className="text-[9px] text-muted-foreground">Total</span>
                  </div>
                </div>
                <ul className="flex-1 space-y-2.5 text-xs min-w-0">
                  {topCategories.map((c) => {
                    const pct = (c.amount / totalCatExpense) * 100;
                    return (
                      <li key={c.category} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: SEGMENT_COLORS[c.category] ?? "#94A3B8" }}
                          />
                          <span className="truncate font-medium text-foreground">
                            {CATEGORY_LABEL[c.category] ?? c.category}
                          </span>
                        </span>
                        <span className="tabular text-muted-foreground shrink-0">
                          {pct.toFixed(0)}%{" "}
                          <span className="text-foreground font-semibold">
                            USD {c.amount.toFixed(0)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {topCategory && (
                <button
                  onClick={() => navigate({ to: "/budgets" })}
                  className="mt-4 w-full flex items-center gap-3 rounded-2xl bg-amber-50 dark:bg-amber-400/10 border border-amber-100 dark:border-amber-400/20 px-4 py-3 text-left hover:bg-amber-100/70 dark:hover:bg-amber-400/15 transition-colors"
                >
                  <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs text-amber-800 dark:text-amber-200 flex-1">
                    Consejo:{" "}
                    {topCategoryOverBudget
                      ? "estás gastando más de lo presupuestado en "
                      : "tu mayor gasto este mes es "}
                    <span className="font-semibold">
                      {(CATEGORY_LABEL[topCategory.category] ?? topCategory.category).toLowerCase()}
                    </span>
                    .
                  </span>
                  <ChevronRight className="w-4 h-4 text-amber-500 shrink-0" />
                </button>
              )}
            </>
          )}
        </div>

        {/* El Hilo de Alertas */}
        <div className="rounded-3xl bg-white dark:bg-card border border-gray-100 dark:border-hairline min-w-0 p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-foreground">Estado de presupuestos</h2>
            <Link
              to="/budgets"
              className="text-[10px] font-bold text-[#4C3A8C] dark:text-[#B9A9F5] uppercase tracking-wider hover:underline"
            >
              Ver todos →
            </Link>
          </div>
          {!worstBudget ? (
            <EmptyState text="Usa el chat para definir presupuestos." />
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-lg bg-gray-50 dark:bg-card/60 rounded-lg p-1.5 shrink-0">
                    {CATEGORY_EMOJI[worstBudget.category] ?? "📦"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">
                      {CATEGORY_LABEL[worstBudget.category] ?? worstBudget.category}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular">
                      USD {Number(worstBudget.spent).toFixed(0)} /{" "}
                      {Number(worstBudget.limit_amount).toFixed(0)}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${
                    worstOver
                      ? "bg-rose-50 text-rose-600"
                      : worstWarning
                        ? "bg-amber-50 text-amber-600"
                        : "bg-emerald-50 text-emerald-600"
                  }`}
                >
                  {worstPct}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden my-3">
                <div
                  className={`h-full rounded-full ${
                    worstOver ? "bg-rose-500" : worstWarning ? "bg-amber-400" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, worstPct)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5 mb-4">
                <AlertTriangle
                  className={`w-3.5 h-3.5 shrink-0 ${
                    worstOver
                      ? "text-rose-500"
                      : worstWarning
                        ? "text-amber-500"
                        : "text-emerald-500"
                  }`}
                />
                {worstOver
                  ? `Excediste el presupuesto en ${(CATEGORY_LABEL[worstBudget.category] ?? worstBudget.category).toLowerCase()}.`
                  : worstWarning
                    ? `Superaste el umbral configurado en ${(CATEGORY_LABEL[worstBudget.category] ?? worstBudget.category).toLowerCase()}.`
                    : `Vas dentro del presupuesto de ${(CATEGORY_LABEL[worstBudget.category] ?? worstBudget.category).toLowerCase()}.`}
              </p>
              <button
                onClick={() => navigate({ to: "/budgets" })}
                className="mt-auto w-full py-2.5 rounded-xl bg-[#2B1B55] text-white text-sm font-semibold hover:bg-[#221546] active:scale-[0.99] transition-all"
              >
                Revisar presupuesto
              </button>
            </>
          )}
        </div>

        {/* Libreta de Apuntes */}
        <div className="rounded-3xl bg-white dark:bg-card border border-gray-100 dark:border-hairline min-w-0 p-6 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-foreground">Libreta de Apuntes</h2>
          </div>
          {d.recent.length === 0 ? (
            <EmptyState text="Sin apuntes todavía." />
          ) : (
            <ul className="space-y-1 flex-1">
              {d.recent.slice(0, 4).map((t) => {
                const isExpense = t.type === "expense";
                return (
                  <li
                    key={t.id}
                    className="py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-card/60 transition-colors rounded-xl px-1"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[t.category] ?? "📦"}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">
                          {t.merchant || t.description || CATEGORY_LABEL[t.category] || t.category}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(t.date).toLocaleDateString("es-EC", {
                            day: "numeric",
                            month: "short",
                            timeZone: "UTC",
                          })}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`tabular text-sm font-bold shrink-0 ${
                        isExpense ? "text-[#6B4226] dark:text-[#E2C2A4]" : "text-emerald-600"
                      }`}
                    >
                      {isExpense ? "−" : "+"}USD {mask(money(Number(t.amount)))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            to="/movements"
            className="mt-4 w-full text-center py-2.5 rounded-xl bg-gray-50 dark:bg-white/5 text-foreground text-sm font-semibold hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            Ver todas las notas
          </Link>
        </div>
      </div>

      {/* BANNER INFERIOR */}
      <div className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-[#4C3A8C] to-[#7C6FE0] px-6 py-6 sm:px-8 sm:py-7 flex items-center justify-between gap-4 shadow-sm">
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 85% 100%, rgba(255,255,255,0.25), transparent 55%)",
          }}
        />
        <div className="relative">
          <p className="text-white font-serif text-lg sm:text-xl font-bold flex items-center gap-2">
            ¡Sigue así, {displayName}! <span aria-hidden>💜</span>
          </p>
          <p className="text-white/80 text-xs sm:text-sm mt-1">
            Pequeñas decisiones hoy, grandes logros mañana.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-8 text-center text-xs text-muted-foreground leading-normal">{text}</div>
  );
}
