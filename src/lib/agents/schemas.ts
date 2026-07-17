// Prompts y esquemas estrictos utilizados por los agentes.
import { z } from "zod";

export const SYSTEM_BASE = `Eres Kintu, un asistente financiero conversacional en español neutro de Ecuador.

Reglas absolutas:
- Sé cálido, breve y directo.
- Si detectas angustia financiera, primero valida la emoción sin diagnosticar.
- Explica alertas como acompañamiento, nunca como vigilancia.
- Está prohibido recomendar inversiones personalizadas.
- No inventes montos, fechas, categorías, comercios ni datos.
- Si falta información, utiliza null para ese campo.
- Pregunta únicamente por los datos faltantes.
- No menciones el árbol ni otros elementos decorativos de la interfaz.
- Para soporte institucional, responde solamente desde artículos aprobados.`;

export const EXPENSE_EXTRACT_PROMPT = `Extrae una transacción concreta del mensaje del usuario.

Debes devolver:
- type: "income" o "expense".
- amount: número positivo o null.
- currency: "USD".
- date: fecha exacta en formato YYYY-MM-DD o null.
- category: una categoría breve. Puede ser comida, transporte, hogar, salud,
  educacion, entretenimiento, servicios, ropa, otros o una categoría personalizada
  escrita por el usuario; null si no aparece.
- merchant: comercio para un gasto; empresa, persona u origen
  para un ingreso; null si no aparece.
- description: descripción breve o null.

Reglas:
- No inventes valores.
- Usa null cuando un dato no esté presente.
- Si el mensaje no describe una transacción concreta,
  devuelve amount=null y los demás campos desconocidos como null.`;

export const MessageUnderstandingSchema = z.object({
  intent: z.enum([
    "transaction",
    "budget",
    "support",
    "summary",
    "smalltalk",
    "cancel",
    "correction",
    "unknown",
  ]),
  transactionType: z.enum(["income", "expense"]).nullable(),
  speechAct: z.enum([
    "report",
    "question",
    "command",
    "complaint",
    "correction",
    "hypothetical",
    "cancel",
    "unknown",
  ]),
  occurred: z.boolean().nullable(),
  negated: z.boolean(),
  future: z.boolean(),
  hypothetical: z.boolean(),
  correction: z.boolean(),
  multipleOperations: z.boolean(),
  confidence: z.number().min(0).max(1),
  budgetAction: z.enum(["create_or_update", "query", "none"]),
  dismissPendingState: z.boolean(),
  currentRequestText: z.string().nullable(),
});

export const ExpenseExtractSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.number().positive().nullable(),
  currency: z.literal("USD"),
  date: z.string().nullable(),
  category: z.string().nullable(),
  merchant: z.string().nullable(),
  description: z.string().nullable(),
});

export const MissingExpenseFieldSchema = z.enum(["amount", "date", "category", "merchant"]);

export const BudgetIntentSchema = z.object({
  category: z.string().nullable(),
  limit_amount: z.number().positive().nullable(),
  alert_threshold: z.number().nullable(),
});

// Usado por el agente de notificaciones (ver agents/notification-agent.ts)
// para decidir, después de cada turno del chat, si vale la pena avisarle
// al usuario algo fuera del hilo de la conversación (bandeja de
// notificaciones), más allá de las alertas de presupuesto y los tickets,
// que ya se generan de forma determinística.
export const NotificationDecisionSchema = z.object({
  should_notify: z.boolean(),
  level: z.enum(["info", "warning", "urgent"]).nullable(),
  title: z.string().nullable(),
  message: z.string().nullable(),
});

export type ExpenseDraft = z.infer<typeof ExpenseExtractSchema>;
export type MissingExpenseField = z.infer<typeof MissingExpenseFieldSchema>;
export type NotificationDecision = z.infer<typeof NotificationDecisionSchema>;
