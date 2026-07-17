import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listBudgets, upsertBudget, deleteBudget } from "@/lib/finance.functions";
import { CATEGORIES } from "@/lib/finance/categorize";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, AlertTriangle, X, Pencil, Trash2 } from "lucide-react";

type BudgetsSearch = {
  highlightCategory?: string;
  editBudgetId?: string;
};

export const Route = createFileRoute("/_authenticated/budgets")({
  component: BudgetsPage,
  validateSearch: (search: Record<string, unknown>): BudgetsSearch => {
    return {
      highlightCategory:
        typeof search.highlightCategory === "string" ? search.highlightCategory : undefined,
      editBudgetId: typeof search.editBudgetId === "string" ? search.editBudgetId : undefined,
    };
  },
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

// Misma paleta que dashboard.tsx, para que las categorías se vean
// consistentes en todo el producto (donut del panel, barras acá).
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

const CUSTOM_OPTION = "__custom__";

type BudgetRow = {
  id: string;
  category: string;
  limit_amount: number;
  alert_threshold: number;
  threshold_percentage: number;
  spent: number;
  percentage: number;
  remaining: number;
  overage: number;
  state: "normal" | "warning" | "exceeded";
};

function labelFor(category: string) {
  return CATEGORY_LABEL[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

function emojiFor(category: string) {
  return CATEGORY_EMOJI[category] || "📦";
}

function BudgetsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listBudgets);
  const upsert = useServerFn(upsertBudget);
  const del = useServerFn(deleteBudget);
  const q = useQuery({ queryKey: ["finance", "budgets"], queryFn: () => list() });
  const { highlightCategory, editBudgetId } = Route.useSearch();

  // "editingId" no-nulo => el mini form está editando un presupuesto
  // existente en vez de crear uno nuevo. La categoría queda bloqueada
  // durante la edición (cambiarla crearía un presupuesto distinto en vez
  // de actualizar el actual).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingWasCustom, setEditingWasCustom] = useState(false);
  const [category, setCategory] = useState("comida");
  const [customCategory, setCustomCategory] = useState("");
  const [useCustomCategory, setUseCustomCategory] = useState(false);
  const [limit, setLimit] = useState("200");
  const [threshold, setThreshold] = useState("80");

  const effectiveCategory = useCustomCategory ? customCategory.trim() : category;
  const isCustomSubmit = editingId ? editingWasCustom : useCustomCategory;

  function startEdit(b: BudgetRow) {
    const known = CATEGORIES.includes(b.category as (typeof CATEGORIES)[number]);
    setEditingId(b.id);
    setEditingCategory(b.category);
    setEditingWasCustom(!known);
    if (known) {
      setUseCustomCategory(false);
      setCategory(b.category);
    } else {
      setUseCustomCategory(true);
      setCustomCategory(b.category);
    }
    setLimit(String(b.limit_amount));
    setThreshold(String(Math.round(b.alert_threshold * 100)));
    document.getElementById("create-budget-form")?.scrollIntoView({ behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setEditingCategory(null);
    setEditingWasCustom(false);
    setUseCustomCategory(false);
    setCategory("comida");
    setCustomCategory("");
    setLimit("200");
    setThreshold("80");
  }

  const mut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          category: effectiveCategory,
          limit_amount: parseFloat(limit),
          alert_threshold: parseFloat(threshold) / 100,
          isCustom: isCustomSubmit,
        },
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(editingId ? "Presupuesto actualizado." : "Presupuesto guardado.");
      const alert = result.alerts[0];
      if (alert) {
        if (alert.level === "exceeded") toast.error(alert.message);
        else toast(alert.message, { icon: "🌾" });
      }
      resetForm();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Presupuesto eliminado.");
      resetForm();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  function handleDelete(id: string, label: string) {
    if (!confirm(`¿Eliminar el presupuesto de ${label}? Esta acción no se puede deshacer.`)) return;
    delMut.mutate(id);
  }

  const budgets = q.data?.budgets || [];

  // Auto-edit or highlight from search params
  useEffect(() => {
    if (editBudgetId && budgets.length > 0) {
      const target = (budgets as BudgetRow[]).find((b) => b.id === editBudgetId);
      if (target && editingId !== editBudgetId) {
        startEdit(target);
      }
    }
  }, [editBudgetId, budgets]);

  useEffect(() => {
    if (highlightCategory) {
      const element = document.getElementById(`budget-card-${highlightCategory}`);
      if (element) {
        const timer = setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [highlightCategory, budgets]);

  const sortedBudgets = [...budgets].sort((a, b) => {
    const pctA = a.spent / a.limit_amount;
    const pctB = b.spent / b.limit_amount;
    return pctB - pctA;
  });

  const primaryBudget = sortedBudgets[0];
  const gridBudgets = sortedBudgets.slice(1);
  const canSubmit = effectiveCategory.length > 0 && parseFloat(limit) > 0;

  return (
    <div className="w-full px-6 py-8 space-y-8 bg-[#F5F4FA] dark:bg-[#15132A] min-h-screen">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4E0F5] dark:border-hairline pb-5">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
            Límites y Presupuestos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Controla tus categorías y cumple tus metas financieras.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            document.getElementById("create-budget-form")?.scrollIntoView({ behavior: "smooth" });
          }}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-[#2B1B55] text-white hover:bg-[#221546] font-semibold text-xs transition-all shadow-sm active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Nuevo Presupuesto
        </button>
      </div>

      {/* TWO COLUMN CONTENT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left column: Create / Edit Tope Form */}
        <div className="lg:col-span-4 min-w-0" id="create-budget-form">
          <div className="rounded-3xl bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-lg font-bold text-foreground flex items-center gap-2">
                {editingId && <Pencil className="w-4 h-4 text-[#7C6FE0]" />}
                {editingId && editingCategory
                  ? `Editando: ${labelFor(editingCategory)}`
                  : "Crear nuevo tope"}
              </h2>
              {editingId && (
                <button
                  onClick={resetForm}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0"
                  aria-label="Cancelar edición"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit) mut.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                  Categoría
                </label>

                {editingId && editingCategory ? (
                  // Categoría bloqueada durante la edición: cambiarla crearía
                  // un presupuesto distinto en vez de actualizar el actual.
                  <div className="w-full min-h-[46px] pl-3.5 pr-3 rounded-xl border border-input bg-muted/30 text-foreground flex items-center gap-2 text-sm font-semibold capitalize">
                    <span className="text-base">{emojiFor(editingCategory)}</span>
                    {labelFor(editingCategory)}
                  </div>
                ) : useCustomCategory ? (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      autoFocus
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      placeholder="Ej. mascotas, suscripciones..."
                      className="w-full min-h-[46px] px-3.5 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/20 focus:border-[#7C6FE0] transition-all text-sm font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setUseCustomCategory(false);
                        setCustomCategory("");
                      }}
                      className="text-[10px] font-bold text-[#4C3A8C] dark:text-[#B9A9F5] hover:underline"
                    >
                      ← Elegir de la lista
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base pointer-events-none">
                      {emojiFor(category)}
                    </span>
                    <select
                      value={category}
                      onChange={(e) => {
                        if (e.target.value === CUSTOM_OPTION) {
                          setUseCustomCategory(true);
                        } else {
                          setCategory(e.target.value);
                        }
                      }}
                      className="w-full min-h-[46px] pl-10 pr-3 rounded-xl border border-input bg-background text-foreground capitalize focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/20 focus:border-[#7C6FE0] transition-all text-sm font-semibold"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c] || c}
                        </option>
                      ))}
                      <option value={CUSTOM_OPTION}>+ Otra categoría...</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                    Tope (USD)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    className="w-full min-h-[46px] px-3.5 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/20 focus:border-[#7C6FE0] transition-all text-sm font-semibold tabular"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                    Aviso al %
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="100"
                    step="5"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="w-full min-h-[46px] px-3.5 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/20 focus:border-[#7C6FE0] transition-all text-sm font-semibold tabular"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={mut.isPending || !canSubmit}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#2B1B55] text-white hover:bg-[#221546] font-semibold text-xs transition-all active:scale-95 shadow-sm disabled:opacity-60"
                >
                  {mut.isPending ? "Guardando..." : editingId ? "Actualizar tope" : "Guardar tope"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="min-h-[44px] px-4 rounded-xl border border-input text-foreground font-semibold text-xs hover:bg-muted/50 transition-all"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {editingId && editingCategory && (
                <button
                  type="button"
                  onClick={() => handleDelete(editingId, labelFor(editingCategory))}
                  disabled={delMut.isPending}
                  className="w-full min-h-[40px] rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold text-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {delMut.isPending ? "Eliminando..." : "Eliminar este presupuesto"}
                </button>
              )}
            </form>
          </div>
        </div>

        {/* Right column: Budgets list */}
        <div className="lg:col-span-8 space-y-6 min-w-0">
          <div className="rounded-3xl bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-[#E4E0F5]/60 pb-3">
              <h2 className="font-serif text-lg font-bold text-foreground">
                Tus presupuestos para este mes
              </h2>
              {budgets.length > 0 && (
                <span className="text-[10px] text-muted-foreground font-semibold">
                  Toca uno para editarlo
                </span>
              )}
            </div>

            {budgets.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground leading-normal">
                Todavía no has definido presupuestos. Agrégalos usando el formulario de la
                izquierda.
              </div>
            ) : (
              <div className="space-y-6">
                {/* PRIMARY HIGHLIGHTED BUDGET */}
                {primaryBudget && (
                  <div
                    id={`budget-card-${primaryBudget.category}`}
                    className={`relative rounded-2xl border p-5 space-y-4 transition-all ${
                      editingId === primaryBudget.id || highlightCategory === primaryBudget.category
                        ? "border-[#7C6FE0] bg-[#7C6FE0]/5 ring-2 ring-[#7C6FE0]/20 shadow-md scale-[1.01]"
                        : "border-[#E4E0F5] dark:border-hairline bg-[#F8F7FD] dark:bg-card/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        handleDelete(primaryBudget.id, labelFor(primaryBudget.category))
                      }
                      className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors z-10"
                      aria-label="Eliminar presupuesto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(primaryBudget)}
                      className="w-full text-left space-y-4 hover:opacity-90 transition-opacity"
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-8">
                        <div className="w-12 h-12 rounded-2xl bg-[#7C6FE0]/10 flex items-center justify-center text-3xl shrink-0">
                          {emojiFor(primaryBudget.category)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-foreground capitalize truncate">
                            {labelFor(primaryBudget.category)}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            USD{" "}
                            <span className="font-mono font-bold text-foreground">
                              {primaryBudget.spent.toFixed(0)}
                            </span>{" "}
                            / {primaryBudget.limit_amount.toFixed(0)}
                          </p>
                        </div>

                        <div className="ml-auto flex items-center gap-2 shrink-0">
                          <span
                            className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                              primaryBudget.state === "exceeded"
                                ? "bg-rose-50 text-rose-600"
                                : primaryBudget.state === "warning"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-[#7C6FE0]/10 text-[#4C3A8C] dark:text-[#B9A9F5]"
                            }`}
                          >
                            {(primaryBudget.percentage * 100).toFixed(0)}%
                          </span>
                          {primaryBudget.state !== "normal" && (
                            <AlertTriangle
                              className={`w-4 h-4 ${
                                primaryBudget.state === "exceeded"
                                  ? "text-coral animate-pulse"
                                  : "text-amber-500"
                              }`}
                              aria-label={
                                primaryBudget.state === "exceeded"
                                  ? "Presupuesto excedido"
                                  : `Umbral del ${primaryBudget.threshold_percentage}% superado`
                              }
                            />
                          )}
                        </div>
                      </div>

                      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300 shadow-sm"
                          style={{
                            width: `${Math.min(100, primaryBudget.percentage * 100)}%`,
                            backgroundColor:
                              primaryBudget.state === "exceeded"
                                ? "#EF4444"
                                : primaryBudget.state === "warning"
                                  ? "#F59E0B"
                                  : SEGMENT_COLORS[primaryBudget.category] || "#7C6FE0",
                          }}
                        />
                      </div>
                    </button>
                  </div>
                )}

                {/* SECONDARY GRID BUDGETS */}
                {gridBudgets.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {gridBudgets.map((b) => {
                      const pct = b.percentage * 100;
                      const over = b.state === "exceeded";
                      const warning = b.state === "warning";
                      const isEditing = editingId === b.id;
                      const isHighlighted = isEditing || highlightCategory === b.category;
                      return (
                        <div
                          id={`budget-card-${b.category}`}
                          key={b.id}
                          className={`relative rounded-2xl border p-4 flex flex-col justify-between min-h-[110px] min-w-0 space-y-3 transition-all ${
                            isHighlighted
                              ? "border-[#7C6FE0] bg-[#7C6FE0]/5 ring-2 ring-[#7C6FE0]/20 shadow-md scale-[1.01]"
                              : "border-[#E4E0F5] dark:border-hairline bg-[#F8F7FD] dark:bg-card/30"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleDelete(b.id, labelFor(b.category))}
                            className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors z-10"
                            aria-label="Eliminar presupuesto"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(b)}
                            className="text-left space-y-3 hover:opacity-90 transition-opacity"
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-6">
                              <span className="text-2xl shrink-0">{emojiFor(b.category)}</span>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-foreground capitalize truncate">
                                  {labelFor(b.category)}
                                </p>
                                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                  USD {b.spent.toFixed(0)}/{b.limit_amount.toFixed(0)}
                                </p>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{
                                    width: `${Math.min(100, pct)}%`,
                                    backgroundColor: over
                                      ? "#EF4444"
                                      : warning
                                        ? "#F59E0B"
                                        : SEGMENT_COLORS[b.category] || "#7C6FE0",
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[9px] text-muted-foreground font-bold">
                                <span>{pct.toFixed(0)}%</span>
                                {b.state !== "normal" && (
                                  <AlertTriangle
                                    className={`w-3 h-3 ${over ? "text-coral" : "text-amber-500"}`}
                                  />
                                )}
                              </div>
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
