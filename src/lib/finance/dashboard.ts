export type DashboardSeriesPoint = {
  date: string;
  amount: number;
};

export type DashboardTransactionLike = {
  type: string;
  amount: number | string;
  date: string;
};

/**
 * Builds a deterministic daily series from confirmed transactions.
 * The function never invents missing values: it only aggregates real rows.
 */
export function buildDailySeries(
  transactions: DashboardTransactionLike[],
  type: "income" | "expense",
): DashboardSeriesPoint[] {
  const daily: Record<string, number> = {};

  for (const transaction of transactions) {
    if (transaction.type !== type) continue;

    const date = String(transaction.date).slice(0, 10);
    const amount = Number(transaction.amount);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    daily[date] = (daily[date] || 0) + amount;
  }

  return Object.entries(daily)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
