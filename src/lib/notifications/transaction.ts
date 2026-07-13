import { formatMoney } from "@/lib/finance/categorize";

export type TransactionNotificationInput = {
  transactionId: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  merchant?: string | null;
  date: string;
  channel: "chat" | "manual";
};

export type ImportNotificationInput = {
  importKey: string;
  importedCount: number;
  skippedCount: number;
};

function categoryLabel(category: string): string {
  const normalized = category.trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Otros";
}

export function buildTransactionNotification(input: TransactionNotificationInput) {
  const kind = input.type === "income" ? "Ingreso" : "Gasto";
  const action = input.type === "income" ? "un ingreso" : "un gasto";
  const merchant = input.merchant?.trim();
  const place = merchant ? ` en ${merchant}` : "";

  return {
    source: "transaction" as const,
    level: "info" as const,
    title: `${kind} registrado`,
    message: `Se guardó ${action} de ${formatMoney(input.amount)} en ${categoryLabel(input.category)}${place}.`,
    metadata: {
      event: "confirmed",
      transaction_id: input.transactionId,
      transaction_type: input.type,
      amount: input.amount,
      category: input.category,
      merchant: input.merchant ?? null,
      date: input.date,
      channel: input.channel,
    },
    related_transaction_id: input.transactionId,
    event_key: `transaction:${input.transactionId}:confirmed`,
  };
}

export function buildImportNotification(input: ImportNotificationInput) {
  const skippedText =
    input.skippedCount > 0 ? ` Se omitieron ${input.skippedCount} duplicado(s).` : "";

  return {
    source: "import" as const,
    level: "info" as const,
    title: "Importación completada",
    message: `Se agregaron ${input.importedCount} movimiento(s) desde el archivo.${skippedText}`,
    metadata: {
      event: "completed",
      imported_count: input.importedCount,
      skipped_count: input.skippedCount,
    },
    event_key: `import:${input.importKey}`,
  };
}
