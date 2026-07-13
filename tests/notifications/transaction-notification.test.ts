import { describe, expect, it } from "vitest";

import {
  buildImportNotification,
  buildTransactionNotification,
} from "@/lib/notifications/transaction";

describe("transaction notifications", () => {
  it("builds an idempotent expense confirmation", () => {
    const notification = buildTransactionNotification({
      transactionId: "11111111-1111-1111-1111-111111111111",
      type: "expense",
      amount: 20,
      category: "comida",
      merchant: "KFC",
      date: "2026-07-12",
      channel: "chat",
    });

    expect(notification.title).toBe("Gasto registrado");
    expect(notification.message).toContain("USD 20.00");
    expect(notification.message).toContain("KFC");
    expect(notification.event_key).toBe(
      "transaction:11111111-1111-1111-1111-111111111111:confirmed",
    );
  });

  it("builds an income confirmation without inventing a merchant", () => {
    const notification = buildTransactionNotification({
      transactionId: "22222222-2222-2222-2222-222222222222",
      type: "income",
      amount: 100,
      category: "otros",
      date: "2026-07-12",
      channel: "manual",
    });

    expect(notification.title).toBe("Ingreso registrado");
    expect(notification.message).toBe("Se guardó un ingreso de USD 100.00 en Otros.");
    expect(notification.metadata.merchant).toBeNull();
  });

  it("summarizes an import in a single notification", () => {
    const notification = buildImportNotification({
      importKey: "batch-1",
      importedCount: 3,
      skippedCount: 2,
    });

    expect(notification.source).toBe("import");
    expect(notification.message).toContain("3 movimiento(s)");
    expect(notification.message).toContain("2 duplicado(s)");
    expect(notification.event_key).toBe("import:batch-1");
  });
});
