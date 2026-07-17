import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  importTransactions,
} from "@/lib/movements.functions";
import { CATEGORIES } from "@/lib/finance/categorize";
import { listBudgets } from "@/lib/finance.functions";
import {
  buildMovementExportFilename,
  buildMovementExportRows,
  buildMovementTemplateExamples,
  MOVEMENT_EXPORT_HEADERS,
  MOVEMENT_TEMPLATE_HEADERS,
} from "@/lib/spreadsheets/movements";
import { areMovementsDuplicates } from "@/lib/movements/duplicates";
import {
  Plus,
  Download,
  Upload,
  FileSpreadsheet,
  Edit2,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  AlertCircle,
  HelpCircle,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type MovementsSearch = {
  transactionId?: string;
};

export const Route = createFileRoute("/_authenticated/movements")({
  component: MovementsPage,
  validateSearch: (search: Record<string, unknown>): MovementsSearch => {
    return {
      transactionId: typeof search.transactionId === "string" ? search.transactionId : undefined,
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

const money = (n: number) =>
  n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type MovementStatus = "confirmed" | "pending";
type TransactionInput = {
  type: "income" | "expense";
  amount: number;
  date: string;
  category: string;
  description: string | null;
  merchant: string | null;
  created_at: string | null;
  status: MovementStatus;
};
type PreviewItem = TransactionInput & {
  id: number;
  isDuplicate: boolean;
  selected: boolean;
};
type SpreadsheetCell = string | number | boolean | Date | null | undefined;
type SpreadsheetRow = Record<string, SpreadsheetCell>;
type ParsedImportCandidate = Omit<TransactionInput, "type" | "status"> & {
  type: TransactionInput["type"] | null;
  status: MovementStatus | null;
};

async function loadSpreadsheetLibrary() {
  return import("xlsx");
}

function isValidImportedTransaction(item: ParsedImportCandidate): item is TransactionInput {
  return Boolean(item.type && item.status && item.date && item.amount > 0);
}

function MovementsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTransactions);
  const createFn = useServerFn(createTransaction);
  const updateFn = useServerFn(updateTransaction);
  const deleteFn = useServerFn(deleteTransaction);
  const importFn = useServerFn(importTransactions);
  const budgetsFn = useServerFn(listBudgets);

  // Queries & Mutations
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["finance", "transactions"],
    queryFn: () => listFn(),
  });

  const transactions = useMemo<TransactionRow[]>(
    () => data?.transactions ?? [],
    [data?.transactions],
  );

  const budgetsQuery = useQuery({
    queryKey: ["finance", "budgets"],
    queryFn: () => budgetsFn(),
  });
  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...CATEGORIES,
          ...(budgetsQuery.data?.budgets.map((budget) => budget.category) ?? []),
        ]),
      ),
    [budgetsQuery.data?.budgets],
  );
  const hasDemoData = transactions.some((transaction) => transaction.source === "seed");

  const createMut = useMutation({
    mutationFn: (newTx: TransactionInput) => createFn({ data: newTx }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Movimiento registrado con éxito.");
      setIsFormOpen(false);
      resetForm();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error al registrar movimiento"),
  });

  const updateMut = useMutation({
    mutationFn: (updatedTx: TransactionInput & { id: string }) => updateFn({ data: updatedTx }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Movimiento actualizado con éxito.");
      setIsFormOpen(false);
      resetForm();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error al actualizar movimiento"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Movimiento eliminado con éxito.");
      setIsDeleteOpen(false);
      setTxToDelete(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error al eliminar movimiento"),
  });

  const importMut = useMutation({
    mutationFn: (items: TransactionInput[]) => importFn({ data: items }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(
        `Importación completada: ${res.importedCount} nuevos, ${res.skippedCount} duplicados ignorados.`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error al importar Excel"),
  });

  // State
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense">("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { transactionId } = Route.useSearch();

  const parseISO = (str: string) => {
    if (!str) return new Date(NaN);
    const clean = str.trim();
    // Check if it's date-only YYYY-MM-DD
    const dateOnlyMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      return new Date(
        parseInt(dateOnlyMatch[1], 10),
        parseInt(dateOnlyMatch[2], 10) - 1,
        parseInt(dateOnlyMatch[3], 10),
      );
    }

    let normalized = clean.replace(" ", "T");
    if (!normalized.endsWith("Z") && !normalized.includes("+") && !normalized.includes("-")) {
      normalized += "Z";
    }
    const offsetMatch = normalized.match(/([+-]\d{2})$/);
    if (offsetMatch) {
      normalized += ":00";
    }
    return new Date(normalized);
  };

  const getLocalDatetimeString = (dateInput?: Date | string) => {
    const d = dateInput
      ? typeof dateInput === "string"
        ? parseISO(dateInput)
        : dateInput
      : new Date();
    if (isNaN(d.getTime())) return "";
    const offset = d.getTimezoneOffset();
    const localDate = new Date(d.getTime() - offset * 60 * 1000);
    return localDate.toISOString().slice(0, 16);
  };

  const formatDateTime = (dateStr: string, createdAtStr: string | null) => {
    const dateObj = parseISO(createdAtStr || dateStr);
    if (isNaN(dateObj.getTime())) {
      return dateStr;
    }
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    const hrs = String(dateObj.getHours()).padStart(2, "0");
    const mins = String(dateObj.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${hrs}:${mins}`;
  };

  const formatDateOnly = (dateStr: string) => dateStr;

  const formatTimeOnly = (createdAtStr: string | null, showSeconds = false) => {
    if (!createdAtStr) return "--:--";
    const dateObj = parseISO(createdAtStr);
    if (isNaN(dateObj.getTime())) {
      return "--:--";
    }
    const hrs = String(dateObj.getHours()).padStart(2, "0");
    const mins = String(dateObj.getMinutes()).padStart(2, "0");
    if (showSeconds) {
      const secs = String(dateObj.getSeconds()).padStart(2, "0");
      return `${hrs}:${mins}:${secs}`;
    }
    return `${hrs}:${mins}`;
  };

  // Form State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formId, setFormId] = useState<string | null>(null); // null means Create, string means Edit
  const [formType, setFormType] = useState<"income" | "expense">("expense");
  const [formAmount, setFormAmount] = useState("");
  const [formDateTime, setFormDateTime] = useState(getLocalDatetimeString());
  const [formCategory, setFormCategory] = useState("otros");
  const [formDescription, setFormDescription] = useState("");
  const [formMerchant, setFormMerchant] = useState("");
  const [formStatus, setFormStatus] = useState<MovementStatus>("confirmed");

  // Import Preview State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);

  // La vista previa usa exactamente el mismo criterio que el servidor.
  const checkIsDuplicate = (item: TransactionInput, existingList: TransactionRow[]) =>
    existingList.some((existing) => areMovementsDuplicates(existing, item));

  const handleToggleSelectItem = (index: number) => {
    setPreviewItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, selected: !item.selected } : item)),
    );
  };

  const handleToggleSelectAll = (checked: boolean) => {
    setPreviewItems((prev) => prev.map((item) => ({ ...item, selected: checked })));
  };

  const handleConfirmImport = () => {
    const selectedItems = previewItems
      .filter((item) => item.selected)
      .map(({ id, isDuplicate, selected, ...rest }) => rest);

    if (selectedItems.length === 0) {
      toast.error("No has seleccionado ningún movimiento para importar.");
      return;
    }

    importMut.mutate(selectedItems, {
      onSuccess: () => {
        setIsPreviewOpen(false);
        setPreviewItems([]);
      },
    });
  };

  // Delete State
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [txToDelete, setTxToDelete] = useState<TransactionRow | null>(null);

  const resetForm = () => {
    setFormId(null);
    setFormType("expense");
    setFormAmount("");
    setFormDateTime(getLocalDatetimeString());
    setFormCategory("otros");
    setFormDescription("");
    setFormMerchant("");
    setFormStatus("confirmed");
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const handleOpenEdit = (tx: TransactionRow) => {
    setFormId(tx.id);
    setFormType(tx.type);
    setFormAmount(String(tx.amount));
    setFormDateTime(getLocalDatetimeString(tx.created_at || tx.date));
    setFormCategory(tx.category);
    setFormDescription(tx.description || "");
    setFormMerchant(tx.merchant || "");
    setFormStatus(tx.status === "pending" ? "pending" : "confirmed");
    setIsFormOpen(true);
  };

  const handleOpenDelete = (tx: TransactionRow) => {
    setTxToDelete(tx);
    setIsDeleteOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(formAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast.error("El monto debe ser un número válido mayor a cero.");
      return;
    }

    const dateObj = new Date(formDateTime);
    if (isNaN(dateObj.getTime())) {
      toast.error("Fecha y hora no válidas.");
      return;
    }

    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
    const createdAtStr = dateObj.toISOString();

    const payload = {
      type: formType,
      amount: amountVal,
      date: dateStr,
      category: formCategory,
      description: formDescription.trim() || null,
      merchant: formMerchant.trim() || null,
      created_at: createdAtStr,
      status: formStatus,
    };

    if (formId) {
      updateMut.mutate({ id: formId, ...payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const handleDeleteConfirm = () => {
    if (txToDelete) {
      deleteMut.mutate(txToDelete.id);
    }
  };

  // Filter & Sort Transactions
  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((tx) => {
        // Search filter
        const matchSearch =
          (tx.description || "").toLowerCase().includes(search.toLowerCase()) ||
          (tx.merchant || "").toLowerCase().includes(search.toLowerCase());

        // Type filter
        const matchType = filterType === "all" || tx.type === filterType;

        // Category filter
        const matchCategory = filterCategory === "all" || tx.category === filterCategory;

        // Date range filter
        const matchDateFrom = !filterDateFrom || tx.date >= filterDateFrom;
        const matchDateTo = !filterDateTo || tx.date <= filterDateTo;

        return matchSearch && matchType && matchCategory && matchDateFrom && matchDateTo;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortField === "date") {
          comparison = a.date.localeCompare(b.date);
        } else if (sortField === "amount") {
          comparison = Number(a.amount) - Number(b.amount);
        }
        return sortOrder === "asc" ? comparison : -comparison;
      });
  }, [
    transactions,
    search,
    filterType,
    filterCategory,
    filterDateFrom,
    filterDateTo,
    sortField,
    sortOrder,
  ]);

  // Paginated Transactions
  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTransactions.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTransactions, currentPage]);

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage) || 1;

  // If transactionId is provided in search params, find it and jump to its page
  useEffect(() => {
    if (transactionId && filteredTransactions.length > 0) {
      const idx = filteredTransactions.findIndex((tx) => tx.id === transactionId);
      if (idx !== -1) {
        const page = Math.floor(idx / itemsPerPage) + 1;
        setCurrentPage(page);
      }
    }
  }, [transactionId, filteredTransactions]);

  // Scroll to focused transaction
  useEffect(() => {
    if (transactionId && paginatedTransactions.length > 0) {
      const element = document.getElementById(`transaction-${transactionId}`);
      if (element) {
        const timer = setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [transactionId, paginatedTransactions]);

  const handleSort = (field: "date" | "amount") => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  // Template Excel Download
  const handleDownloadTemplate = async () => {
    const XLSX = await loadSpreadsheetLibrary();

    // La primera hoja queda vacía para que el usuario la complete e importe.
    // Los datos demostrativos viven en una segunda hoja y no se confunden con
    // una exportación real de sus movimientos.
    const templateSheet = XLSX.utils.aoa_to_sheet([[...MOVEMENT_TEMPLATE_HEADERS]]);
    templateSheet["!cols"] = [
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 16 },
      { wch: 12 },
      { wch: 14 },
      { wch: 34 },
      { wch: 26 },
    ];
    templateSheet["!autofilter"] = { ref: "A1:H1" };

    const exampleRows = buildMovementTemplateExamples();
    const examplesSheet = XLSX.utils.json_to_sheet(exampleRows, {
      header: [...MOVEMENT_TEMPLATE_HEADERS],
    });
    examplesSheet["!cols"] = templateSheet["!cols"];
    examplesSheet["!autofilter"] = { ref: `A1:H${exampleRows.length + 1}` };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, templateSheet, "Completar aquí");
    XLSX.utils.book_append_sheet(workbook, examplesSheet, "Ejemplos");
    XLSX.writeFile(workbook, "plantilla_vacia_kintu_movimientos.xlsx");
    toast.success("Plantilla vacía descargada. Los ejemplos están en una segunda hoja.");
  };

  // Import Excel Upload
  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const fileData = event.target?.result;
        const XLSX = await loadSpreadsheetLibrary();
        const workbook = XLSX.read(fileData, { type: "array", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<SpreadsheetRow>(worksheet);

        if (json.length === 0) {
          toast.error("El archivo Excel está vacío.");
          return;
        }

        // Parse and validate columns helper
        const formattedItems: ParsedImportCandidate[] = json.map((row) => {
          const findKey = (keys: string[]) => {
            const found = Object.keys(row).find((k) =>
              keys.includes(
                k
                  .toLowerCase()
                  .trim()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, ""),
              ),
            );
            return found ? row[found] : null;
          };

          const fechaRaw = findKey(["fecha", "date"]);
          const horaRaw = findKey(["hora", "time"]);
          const tipoRaw = findKey(["tipo", "type"]);
          const categoriaRaw = findKey(["categoria", "category"]);
          const montoRaw = findKey(["monto", "amount", "valor"]);
          const estadoRaw = findKey(["estado", "status"]);
          const descripcionRaw = findKey(["descripcion", "description", "detalle"]);
          const comercioRaw = findKey(["comercio", "merchant", "establecimiento", "lugar"]);

          // Parse date safely
          let dateStr = "";
          let createdAtStr = "";
          if (fechaRaw) {
            if (fechaRaw instanceof Date) {
              const y = fechaRaw.getUTCFullYear();
              const m = String(fechaRaw.getUTCMonth() + 1).padStart(2, "0");
              const d = String(fechaRaw.getUTCDate()).padStart(2, "0");
              dateStr = `${y}-${m}-${d}`;
            } else if (typeof fechaRaw === "number") {
              const dateMs = (fechaRaw - 25569) * 86400 * 1000;
              const dateObj = new Date(dateMs);
              const y = dateObj.getUTCFullYear();
              const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
              const d = String(dateObj.getUTCDate()).padStart(2, "0");
              dateStr = `${y}-${m}-${d}`;
            } else {
              // Parse string formatted date
              const clean = String(fechaRaw).trim();
              // YYYY-MM-DD or YYYY/MM/DD or YYYY/M/D
              let match = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
              if (match) {
                dateStr = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
              } else {
                // DD-MM-YYYY or DD/MM/YYYY or D/M/YYYY or D-M-YYYY
                match = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
                if (match) {
                  const first = parseInt(match[1], 10);
                  const second = parseInt(match[2], 10);
                  const year = match[3];
                  let day = first;
                  let month = second;
                  // Handle MM/DD/YYYY if second is > 12
                  if (second > 12) {
                    day = second;
                    month = first;
                  }
                  dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                } else {
                  const parsedMs = Date.parse(clean);
                  if (!isNaN(parsedMs)) {
                    const dateObj = new Date(parsedMs);
                    const y = dateObj.getUTCFullYear();
                    const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
                    const d = String(dateObj.getUTCDate()).padStart(2, "0");
                    dateStr = `${y}-${m}-${d}`;
                  }
                }
              }
            }

            // Parse time safely
            let timeStr = "";

            if (horaRaw) {
              if (horaRaw instanceof Date) {
                const hrs = String(horaRaw.getHours()).padStart(2, "0");
                const mins = String(horaRaw.getMinutes()).padStart(2, "0");
                const secs = String(horaRaw.getSeconds()).padStart(2, "0");
                timeStr = `${hrs}:${mins}:${secs}`;
              } else if (typeof horaRaw === "number") {
                const totalSeconds = Math.round(horaRaw * 86400);
                const hrs = Math.floor(totalSeconds / 3600);
                const mins = Math.floor((totalSeconds % 3600) / 60);
                const secs = totalSeconds % 60;
                timeStr = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
              } else {
                const clean = String(horaRaw).trim();
                const match = clean.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?/i);
                if (match) {
                  let h = parseInt(match[1], 10);
                  const m = match[2];
                  const s = (match[3] || "00").padStart(2, "0");
                  const ampm = match[4];
                  if (ampm) {
                    if (ampm.toLowerCase() === "pm" && h < 12) {
                      h += 12;
                    } else if (ampm.toLowerCase() === "am" && h === 12) {
                      h = 0;
                    }
                  }
                  timeStr = `${String(h).padStart(2, "0")}:${m}:${s}`;
                }
              }
            }

            // Fallbacks for combined columns
            if (!timeStr) {
              if (fechaRaw instanceof Date) {
                const isUtcMidnight =
                  fechaRaw.getUTCHours() === 0 &&
                  fechaRaw.getUTCMinutes() === 0 &&
                  fechaRaw.getUTCSeconds() === 0;
                if (!isUtcMidnight) {
                  const hrs = String(fechaRaw.getHours()).padStart(2, "0");
                  const mins = String(fechaRaw.getMinutes()).padStart(2, "0");
                  const secs = String(fechaRaw.getSeconds()).padStart(2, "0");
                  timeStr = `${hrs}:${mins}:${secs}`;
                }
              } else if (typeof fechaRaw === "string") {
                const clean = fechaRaw.trim();
                const match = clean.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?/i);
                if (match) {
                  let h = parseInt(match[1], 10);
                  const m = match[2];
                  const s = (match[3] || "00").padStart(2, "0");
                  const ampm = match[4];
                  if (ampm) {
                    if (ampm.toLowerCase() === "pm" && h < 12) {
                      h += 12;
                    } else if (ampm.toLowerCase() === "am" && h === 12) {
                      h = 0;
                    }
                  }
                  timeStr = `${String(h).padStart(2, "0")}:${m}:${s}`;
                }
              }
            }

            // La hora es opcional. Si el archivo no la trae, dejamos
            // created_at en null para que la deduplicación use los campos base.
            if (dateStr && timeStr) {
              const [yearText, monthText, dayText] = dateStr.split("-");
              const [hoursText, minutesText, secondsText = "0"] = timeStr.split(":");
              const combinedDateObj = new Date(
                Number(yearText),
                Number(monthText) - 1,
                Number(dayText),
                Number(hoursText),
                Number(minutesText),
                Number(secondsText),
              );
              if (!Number.isNaN(combinedDateObj.getTime())) {
                createdAtStr = combinedDateObj.toISOString();
              }
            }
          }

          // Parse type
          let type: TransactionInput["type"] | null = null;
          const normalizedType = String(tipoRaw || "")
            .trim()
            .toLowerCase();
          if (normalizedType === "ingreso" || normalizedType === "income") {
            type = "income";
          } else if (normalizedType === "gasto" || normalizedType === "expense") {
            type = "expense";
          }

          // Parse amount
          const amount = Number(montoRaw);

          // Parse status
          let status: MovementStatus | null = null;
          const normalizedStatus = String(estadoRaw || "")
            .trim()
            .toLowerCase();
          if (normalizedStatus === "pendiente" || normalizedStatus === "pending") {
            status = "pending";
          } else if (
            normalizedStatus === "confirmado" ||
            normalizedStatus === "confirmed" ||
            normalizedStatus === ""
          ) {
            status = "confirmed";
          }

          return {
            date: dateStr,
            type,
            category: String(categoriaRaw || "otros")
              .trim()
              .toLowerCase(),
            amount: isNaN(amount) ? 0 : Math.abs(amount),
            description: descripcionRaw ? String(descripcionRaw) : null,
            merchant: comercioRaw ? String(comercioRaw) : null,
            created_at: createdAtStr || null,
            status,
          };
        });

        // Keep only valid entries
        const validItems = formattedItems.filter(isValidImportedTransaction);
        const invalidCount = formattedItems.length - validItems.length;

        if (invalidCount > 0) {
          toast.warning(`${invalidCount} fila(s) inválida(s) fueron omitidas.`);
        }

        if (validItems.length === 0) {
          toast.error(
            "No se encontraron registros válidos. Asegúrate de tener al menos las columnas 'Fecha', 'Tipo', 'Monto' e 'Estado'.",
          );
          return;
        }

        // Map items with duplicate status and selection defaults
        const itemsWithDuplicateFlag = validItems.map((item, index) => {
          const isDuplicate = checkIsDuplicate(item, transactions);
          return {
            ...item,
            id: index,
            isDuplicate,
            selected: !isDuplicate, // Unchecked by default if duplicate
          };
        });

        setPreviewItems(itemsWithDuplicateFlag);
        setIsPreviewOpen(true);
      } catch (err) {
        console.error(err);
        toast.error("Error al procesar el archivo Excel.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ""; // Reset file input
  };

  // Export Filtered Data to Excel
  const handleExportExcel = async () => {
    if (filteredTransactions.length === 0) {
      toast.error("No hay movimientos para exportar con los filtros seleccionados.");
      return;
    }

    const exportData = buildMovementExportRows(filteredTransactions);
    const XLSX = await loadSpreadsheetLibrary();
    const worksheet = XLSX.utils.json_to_sheet(exportData, {
      header: [...MOVEMENT_EXPORT_HEADERS],
    });
    worksheet["!cols"] = [
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 16 },
      { wch: 12 },
      { wch: 14 },
      { wch: 34 },
      { wch: 26 },
      { wch: 18 },
    ];
    worksheet["!autofilter"] = { ref: `A1:I${exportData.length + 1}` };

    for (let row = 2; row <= exportData.length + 1; row += 1) {
      const amountCell = worksheet[`E${row}`];
      if (amountCell) amountCell.z = "#,##0.00";
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Movimientos exportados");
    XLSX.writeFile(workbook, buildMovementExportFilename());
    toast.success(`${exportData.length} movimiento(s) exportado(s) a Excel.`);
  };

  return (
    <div className="w-full px-6 py-8 space-y-8 bg-[#F5F4FA] dark:bg-[#15132A] min-h-screen">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4E0F5] dark:border-hairline pb-5">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Mis Movimientos <Receipt className="w-7 h-7 text-[#7C6FE0]" strokeWidth={2.2} />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visualiza, gestiona y mantén al día el registro de tus transacciones financieras.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          {/* Add Manual Movement */}
          <Button
            onClick={handleOpenCreate}
            className="rounded-full bg-[#4C3A8C] text-white hover:bg-[#3D2F73] font-semibold text-xs transition-all shadow-sm active:scale-95 px-4 py-2.5 w-full sm:w-auto shrink-0"
          >
            <Plus className="w-4 h-4 mr-1" />
            Nuevo Movimiento
          </Button>

          {/* Download Template */}
          <Button
            variant="outline"
            onClick={handleDownloadTemplate}
            className="rounded-full border-[#E4E0F5] bg-white text-foreground hover:bg-muted text-xs font-semibold px-4 py-2.5 w-full sm:w-auto shrink-0"
            title="Descargar plantilla Excel para importar datos"
          >
            <Download className="w-4 h-4 mr-1" />
            Plantilla vacía
          </Button>

          {/* Upload Excel */}
          <div className="relative w-full sm:w-auto shrink-0">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportExcel}
              id="upload-excel-file"
              className="hidden"
            />
            <Button
              variant="outline"
              asChild
              className="rounded-full border-[#E4E0F5] bg-white text-foreground hover:bg-muted text-xs font-semibold px-4 py-2.5 cursor-pointer w-full sm:w-auto"
            >
              <label
                htmlFor="upload-excel-file"
                className="w-full flex items-center justify-center cursor-pointer"
              >
                {importMut.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-1" />
                )}
                Importar Excel
              </label>
            </Button>
          </div>

          {/* Export to Excel */}
          <Button
            variant="outline"
            onClick={handleExportExcel}
            className="rounded-full border-[#E4E0F5] bg-white text-foreground hover:bg-muted text-xs font-semibold px-4 py-2.5 w-full sm:w-auto shrink-0"
            title="Exportar movimientos actuales a Excel"
          >
            <FileSpreadsheet className="w-4 h-4 mr-1" />
            Exportar movimientos
          </Button>
        </div>
      </div>

      {/* ERROR STATE */}
      {isError && (
        <div className="rounded-3xl border border-destructive/20 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-destructive">Error al cargar movimientos</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {error instanceof Error
                ? error.message
                : "Ocurrió un problema de conexión al servidor."}
            </p>
          </div>
        </div>
      )}

      {hasDemoData && (
        <div className="rounded-2xl border border-[#7C6FE0]/20 bg-[#7C6FE0]/8 px-4 py-3 text-xs text-[#4C3A8C] dark:text-[#B9A9F5]">
          <span className="font-bold">Datos de demostración:</span> los movimientos marcados como
          “Demo” son ficticios y sí participan en el dashboard y los presupuestos para que el flujo
          sea coherente de extremo a extremo.
        </div>
      )}

      {/* FILTERS PANEL */}
      <div className="rounded-3xl bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-foreground font-semibold text-sm border-b border-[#E4E0F5]/40 pb-2">
          <Filter className="w-4 h-4 text-[#7C6FE0] dark:text-[#B9A9F5]" />
          <span>Filtrar y Buscar</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          {/* Text Search */}
          <div className="space-y-1.5 col-span-1 md:col-span-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Búsqueda
            </label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por desc. o comercio..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9 h-10 text-xs rounded-xl"
              />
            </div>
          </div>

          {/* Type Filter */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Tipo
            </label>
            <select
              value={filterType}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "all" || value === "income" || value === "expense") {
                  setFilterType(value);
                }
                setCurrentPage(1);
              }}
              className="w-full h-10 px-3 rounded-xl border border-input bg-background text-foreground text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/20 focus:border-[#7C6FE0]"
            >
              <option value="all">Todos</option>
              <option value="income">Ingresos</option>
              <option value="expense">Gastos</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Categoría
            </label>
            <select
              value={filterCategory}
              onChange={(e) => {
                setFilterCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-10 px-3 rounded-xl border border-input bg-background text-foreground text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/20 focus:border-[#7C6FE0] capitalize"
            >
              <option value="all">Todas</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_EMOJI[c]} {CATEGORY_LABEL[c] || c}
                </option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Desde
            </label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                setCurrentPage(1);
              }}
              className="h-10 text-xs rounded-xl font-semibold"
            />
          </div>

          {/* Date To */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Hasta
            </label>
            <Input
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                setFilterDateTo(e.target.value);
                setCurrentPage(1);
              }}
              className="h-10 text-xs rounded-xl font-semibold"
            />
          </div>
        </div>
      </div>

      {/* MOVEMENTS TABLE & DATA */}
      <div className="rounded-3xl bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 text-[#7C6FE0] dark:text-[#B9A9F5] animate-spin" />
            <p className="text-xs text-muted-foreground">Cargando tus movimientos...</p>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center justify-center">
            <HelpCircle className="w-12 h-12 text-[#4C3A8C]/30 dark:text-[#B9A9F5]/30 mb-3" />
            <h3 className="text-sm font-bold text-foreground">No se encontraron movimientos</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              No hay registros que coincidan con la búsqueda o filtros actuales. Registra un nuevo
              movimiento o importa desde Excel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40 border-b border-[#E4E0F5]/40">
                <TableRow>
                  <TableHead className="w-28 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <button
                      onClick={() => handleSort("date")}
                      className="flex items-center gap-1.5 hover:text-foreground font-bold"
                    >
                      Fecha
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-20 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Hora
                  </TableHead>
                  <TableHead className="w-24 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Tipo
                  </TableHead>
                  <TableHead className="w-24 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Estado
                  </TableHead>
                  <TableHead className="w-40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Categoría
                  </TableHead>
                  <TableHead className="w-32 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Comercio
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Descripción
                  </TableHead>
                  <TableHead className="w-32 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">
                    <button
                      onClick={() => handleSort("amount")}
                      className="flex items-center gap-1.5 hover:text-foreground font-bold ml-auto"
                    >
                      Monto
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-24 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">
                    Acciones
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-[#E4E0F5]/20">
                {paginatedTransactions.map((tx) => (
                  <TableRow
                    id={`transaction-${tx.id}`}
                    key={tx.id}
                    className={`hover:bg-muted/10 transition-colors ${
                      transactionId === tx.id
                        ? "bg-[#7C6FE0]/15 hover:bg-[#7C6FE0]/20 ring-2 ring-[#7C6FE0]/25 shadow-sm"
                        : ""
                    }`}
                  >
                    {/* Fecha */}
                    <TableCell className="text-xs font-semibold text-foreground tabular whitespace-nowrap">
                      {formatDateOnly(tx.date)}
                    </TableCell>
                    {/* Hora */}
                    <TableCell className="text-xs font-medium text-muted-foreground tabular whitespace-nowrap">
                      {formatTimeOnly(tx.created_at)}
                    </TableCell>

                    {/* Tipo */}
                    <TableCell>
                      {tx.type === "income" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#7C6FE0]/10 text-[#4C3A8C] dark:bg-[#7C6FE0]/15 dark:text-[#B9A9F5]">
                          <ArrowDownLeft className="w-3 h-3" /> Ingreso
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-coral/10 text-coral dark:bg-coral/15 dark:text-coral">
                          <ArrowUpRight className="w-3 h-3" /> Gasto
                        </span>
                      )}
                    </TableCell>

                    {/* Estado */}
                    <TableCell>
                      {tx.status === "confirmed" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#7C6FE0]/10 text-[#4C3A8C] dark:bg-[#7C6FE0]/15 dark:text-[#B9A9F5]">
                          Confirmado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F6C76B]/15 text-[#8A6D1F] dark:bg-[#F6C76B]/10 dark:text-[#F6C76B]">
                          Pendiente
                        </span>
                      )}
                    </TableCell>

                    {/* Categoría */}
                    <TableCell className="text-xs text-foreground font-medium capitalize">
                      <span className="mr-1.5">{CATEGORY_EMOJI[tx.category] || "📦"}</span>
                      {CATEGORY_LABEL[tx.category] || tx.category}
                    </TableCell>

                    {/* Comercio */}
                    <TableCell className="text-xs text-foreground font-medium max-w-[120px] truncate">
                      {tx.merchant || <span className="text-muted-foreground/60 italic">-</span>}
                    </TableCell>

                    {/* Descripción */}
                    <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate">
                          {tx.description || (
                            <span className="text-muted-foreground/40 italic">Sin descripción</span>
                          )}
                        </span>
                        {tx.source === "seed" && (
                          <span className="shrink-0 rounded-full bg-[#7C6FE0]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4C3A8C] dark:text-[#B9A9F5]">
                            Demo
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Monto */}
                    <TableCell className="text-right text-xs font-bold font-mono">
                      <span
                        className={
                          tx.type === "income" ? "text-[#7C6FE0] dark:text-[#B9A9F5]" : "text-coral"
                        }
                      >
                        {tx.type === "income" ? "+" : "-"}USD {money(tx.amount)}
                      </span>
                    </TableCell>

                    {/* Acciones */}
                    <TableCell>
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(tx)}
                          className="w-8 h-8 rounded-lg hover:bg-muted/80 hover:text-foreground text-muted-foreground transition-all"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDelete(tx)}
                          className="w-8 h-8 rounded-lg hover:bg-coral/10 hover:text-coral text-muted-foreground transition-all"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* PAGINATION PANEL */}
            <div className="flex flex-col sm:flex-row items-center justify-between border-t border-[#E4E0F5]/40 px-6 py-4 gap-4 bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Mostrando del{" "}
                <span className="font-semibold">
                  {Math.min(filteredTransactions.length, (currentPage - 1) * itemsPerPage + 1)}
                </span>{" "}
                al{" "}
                <span className="font-semibold">
                  {Math.min(filteredTransactions.length, currentPage * itemsPerPage)}
                </span>{" "}
                de <span className="font-semibold">{filteredTransactions.length}</span> movimientos.
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((c) => Math.max(1, c - 1))}
                  className="w-8 h-8 rounded-lg border-[#E4E0F5] bg-white hover:bg-muted text-foreground"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const pageNum = idx + 1;
                  return (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-xs font-semibold ${
                        currentPage === pageNum
                          ? "bg-[#4C3A8C] text-white hover:bg-[#3D2F73]"
                          : "border-[#E4E0F5] bg-white hover:bg-muted text-foreground"
                      }`}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="icon"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((c) => Math.min(totalPages, c + 1))}
                  className="w-8 h-8 rounded-lg border-[#E4E0F5] bg-white hover:bg-muted text-foreground"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CRUD DIALOG FORM */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-3xl p-6 bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline">
          <form onSubmit={handleSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-serif text-lg font-bold text-foreground">
                {formId ? "Editar Movimiento" : "Nuevo Movimiento"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Llena el formulario con los detalles del movimiento de dinero.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Type Switch Button Group */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Tipo
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted/60 border border-muted-foreground/10">
                  <button
                    type="button"
                    onClick={() => setFormType("expense")}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      formType === "expense"
                        ? "bg-coral text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Gasto
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormType("income")}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      formType === "income"
                        ? "bg-[#7C6FE0] text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Ingreso
                  </button>
                </div>
              </div>

              {/* Amount and Date */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Monto (USD)
                  </label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="25.50"
                    required
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="h-10 text-xs rounded-xl font-semibold tabular"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Fecha y Hora
                  </label>
                  <Input
                    type="datetime-local"
                    required
                    value={formDateTime}
                    onChange={(e) => setFormDateTime(e.target.value)}
                    className="h-10 text-xs rounded-xl font-semibold"
                  />
                </div>
              </div>

              {/* Category & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Categoría
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-input bg-background text-foreground text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/20 focus:border-[#7C6FE0] capitalize"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_EMOJI[c]} {CATEGORY_LABEL[c] || c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Estado
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "confirmed" || value === "pending") {
                        setFormStatus(value);
                      }
                    }}
                    className="w-full h-10 px-3 rounded-xl border border-input bg-background text-foreground text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C6FE0]/20 focus:border-[#7C6FE0]"
                  >
                    <option value="confirmed">Confirmado</option>
                    <option value="pending">Pendiente</option>
                  </select>
                </div>
              </div>

              {/* Merchant / Comercio */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Comercio / Establecimiento
                </label>
                <Input
                  placeholder="ej. Uber, Supermaxi, Cliente"
                  value={formMerchant}
                  onChange={(e) => setFormMerchant(e.target.value)}
                  className="h-10 text-xs rounded-xl font-medium"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Descripción
                </label>
                <Input
                  placeholder="ej. Pago del almuerzo mensual o regalo"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="h-10 text-xs rounded-xl font-medium"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsFormOpen(false)}
                className="h-10 text-xs rounded-xl font-semibold border-[#E4E0F5]"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMut.isPending || updateMut.isPending}
                className="h-10 text-xs rounded-xl font-semibold bg-[#4C3A8C] text-white hover:bg-[#3D2F73] px-4"
              >
                {createMut.isPending || updateMut.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                ) : null}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CONFIRM DELETE DIALOG */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-[400px] rounded-3xl p-6 bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg font-bold text-foreground">
              ¿Eliminar Movimiento?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Esta acción no se puede deshacer. ¿Seguro que quieres borrar esta transacción de{" "}
              <span className="font-bold text-foreground">
                USD {txToDelete ? money(txToDelete.amount) : "0.00"}
              </span>{" "}
              registrada el {txToDelete?.date}?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              onClick={() => setIsDeleteOpen(false)}
              className="h-10 text-xs rounded-xl font-semibold border-[#E4E0F5]"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDeleteConfirm}
              disabled={deleteMut.isPending}
              className="h-10 text-xs rounded-xl font-semibold bg-coral hover:opacity-90 text-white px-4"
            >
              {deleteMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EXCEL IMPORT PREVIEW DIALOG */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="w-[90vw] max-w-[1300px] rounded-3xl p-6 bg-white dark:bg-card border border-[#E4E0F5] dark:border-hairline">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg font-bold text-foreground">
              Confirmar Importación de Excel
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Hemos analizado el archivo Excel. Selecciona los registros que deseas importar. Los
              duplicados detectados están desmarcados y advertidos con una alerta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 w-full min-w-0">
            <div className="border border-[#E4E0F5] dark:border-hairline rounded-2xl overflow-hidden w-full">
              <div className="max-h-[350px] overflow-auto">
                <table className="w-full min-w-[1350px] caption-bottom text-sm border-collapse">
                  <TableHeader className="sticky top-0 z-20">
                    <TableRow className="hover:bg-transparent border-b border-[#E4E0F5] dark:border-hairline">
                      <TableHead className="w-12 pl-4 text-left bg-slate-100 dark:bg-card sticky top-0 z-20">
                        <Checkbox
                          checked={
                            previewItems.length > 0 && previewItems.every((item) => item.selected)
                          }
                          onCheckedChange={(checked) => handleToggleSelectAll(!!checked)}
                          aria-label="Seleccionar todos"
                        />
                      </TableHead>
                      <TableHead className="w-28 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Fecha
                      </TableHead>
                      <TableHead className="w-24 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Hora
                      </TableHead>
                      <TableHead className="w-24 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Tipo
                      </TableHead>
                      <TableHead className="w-28 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Categoría
                      </TableHead>
                      <TableHead className="w-28 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Estado
                      </TableHead>
                      <TableHead className="w-44 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Comercio
                      </TableHead>
                      <TableHead className="w-28 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Monto
                      </TableHead>
                      <TableHead className="w-32 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Alerta
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap bg-slate-100 dark:bg-card sticky top-0 z-20">
                        Descripción
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-[#E4E0F5]/20">
                    {previewItems.map((item, idx) => (
                      <TableRow
                        key={item.id}
                        className={`transition-colors ${
                          item.isDuplicate
                            ? "bg-coral/5 dark:bg-coral/5 hover:bg-coral/10 dark:hover:bg-coral/10"
                            : "hover:bg-muted/10"
                        }`}
                      >
                        {/* Checkbox */}
                        <TableCell className="pl-4 text-left">
                          <Checkbox
                            checked={item.selected}
                            onCheckedChange={() => handleToggleSelectItem(idx)}
                            aria-label={`Seleccionar registro ${idx + 1}`}
                          />
                        </TableCell>

                        {/* Fecha */}
                        <TableCell className="text-xs font-medium text-foreground tabular whitespace-nowrap">
                          {formatDateOnly(item.date)}
                        </TableCell>

                        {/* Hora */}
                        <TableCell className="text-xs font-medium text-foreground tabular whitespace-nowrap">
                          {formatTimeOnly(item.created_at, true)}
                        </TableCell>

                        {/* Tipo */}
                        <TableCell className="text-xs font-semibold whitespace-nowrap">
                          {item.type === "income" ? (
                            <span className="text-[#7C6FE0] dark:text-[#B9A9F5] whitespace-nowrap">Ingreso</span>
                          ) : (
                            <span className="text-coral whitespace-nowrap">Gasto</span>
                          )}
                        </TableCell>

                        {/* Categoría */}
                        <TableCell className="text-xs capitalize whitespace-nowrap">
                          <span className="mr-1">{CATEGORY_EMOJI[item.category] || "📦"}</span>
                          {CATEGORY_LABEL[item.category] || item.category}
                        </TableCell>

                        {/* Estado */}
                        <TableCell className="text-xs capitalize whitespace-nowrap">
                          {item.status === "confirmed" ? "Confirmado" : "Pendiente"}
                        </TableCell>

                        {/* Comercio */}
                        <TableCell className="text-xs max-w-[150px] truncate font-medium text-foreground whitespace-nowrap">
                          {item.merchant || (
                            <span className="text-muted-foreground/60 italic">-</span>
                          )}
                        </TableCell>

                        {/* Monto */}
                        <TableCell className="text-right text-xs font-bold font-mono whitespace-nowrap">
                          <span
                            className={item.type === "income" ? "text-[#7C6FE0]" : "text-coral"}
                          >
                            {item.type === "income" ? "+" : "-"}USD {money(item.amount)}
                          </span>
                        </TableCell>

                        {/* Alerta Duplicado */}
                        <TableCell className="text-center whitespace-nowrap">
                          {item.isDuplicate ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-coral/10 text-coral dark:bg-coral/15 dark:text-coral whitespace-nowrap">
                              <AlertCircle className="w-3.5 h-3.5 text-coral animate-pulse" />
                              Duplicado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#7C6FE0]/10 text-[#4C3A8C] dark:bg-[#7C6FE0]/15 dark:text-[#B9A9F5] whitespace-nowrap">
                              Nuevo
                            </span>
                          )}
                        </TableCell>

                        {/* Descripción */}
                        <TableCell className="text-xs max-w-[120px] truncate text-muted-foreground whitespace-nowrap">
                          {item.description || (
                            <span className="text-muted-foreground/45 italic">Sin descripción</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </div>

            {/* Preview Statistics Panel */}
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <div>
                Total en Excel:{" "}
                <span className="font-semibold text-foreground">{previewItems.length}</span>
              </div>
              <div className="flex items-center gap-4">
                <div>
                  Seleccionados para agregar:{" "}
                  <span className="font-semibold text-[#7C6FE0] dark:text-[#B9A9F5]">
                    {previewItems.filter((i) => i.selected).length}
                  </span>
                </div>
                <div>
                  Duplicados detectados:{" "}
                  <span className="font-semibold text-coral">
                    {previewItems.filter((i) => i.isDuplicate).length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-[#E4E0F5]/40">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsPreviewOpen(false);
                setPreviewItems([]);
              }}
              className="h-10 text-xs rounded-xl font-semibold border-[#E4E0F5]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmImport}
              disabled={importMut.isPending}
              className="h-10 text-xs rounded-xl font-semibold bg-[#4C3A8C] text-white hover:bg-[#3D2F73] px-6"
            >
              {importMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Confirmar e Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
