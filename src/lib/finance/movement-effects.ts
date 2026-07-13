export type MovementStatus = "confirmed" | "pending";

export type MovementSnapshot = {
  type: "income" | "expense";
  amount: number;
  date: string;
  category: string;
  status: MovementStatus;
};

export type MovementChange = {
  before: MovementSnapshot | null;
  after: MovementSnapshot | null;
};

export type BudgetBucket = {
  category: string;
  month: string;
};

function bucketId(bucket: BudgetBucket): string {
  return `${bucket.month}::${bucket.category}`;
}

export function budgetBucketForMovement(movement: MovementSnapshot | null): BudgetBucket | null {
  if (!movement || movement.type !== "expense" || movement.status !== "confirmed") {
    return null;
  }

  return {
    category: movement.category,
    month: `${movement.date.slice(0, 7)}-01`,
  };
}

export function collectAffectedBudgetBuckets(changes: MovementChange[]): BudgetBucket[] {
  const buckets = new Map<string, BudgetBucket>();

  for (const change of changes) {
    for (const movement of [change.before, change.after]) {
      const bucket = budgetBucketForMovement(movement);
      if (bucket) buckets.set(bucketId(bucket), bucket);
    }
  }

  return [...buckets.values()];
}

export function movementContribution(
  movement: MovementSnapshot | null,
  bucket: BudgetBucket,
): number {
  const movementBucket = budgetBucketForMovement(movement);

  if (!movementBucket || bucketId(movementBucket) !== bucketId(bucket)) {
    return 0;
  }

  return movement?.amount ?? 0;
}

/**
 * La base ya contiene el estado posterior a la mutación. Esta función
 * reconstruye el total anterior revirtiendo únicamente el lote de cambios
 * que acaba de ejecutarse.
 */
export function previousSpentFromCurrent(
  currentSpent: number,
  changes: MovementChange[],
  bucket: BudgetBucket,
): number {
  const afterContribution = changes.reduce(
    (sum, change) => sum + movementContribution(change.after, bucket),
    0,
  );
  const beforeContribution = changes.reduce(
    (sum, change) => sum + movementContribution(change.before, bucket),
    0,
  );

  return Math.max(0, currentSpent - afterContribution + beforeContribution);
}
