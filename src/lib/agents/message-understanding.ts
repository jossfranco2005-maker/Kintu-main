import {
  classifySensitivity,
  requestsPersonalizedInvestmentAdvice,
} from "@/lib/finance/sensitivity";
import { looksLikeSupportRequest } from "@/lib/agents/support-routing";

export type ChatIntent =
  | "transaction"
  | "budget"
  | "support"
  | "summary"
  | "smalltalk"
  | "cancel"
  | "correction"
  | "unknown";

export type SpeechAct =
  | "report"
  | "question"
  | "command"
  | "complaint"
  | "correction"
  | "hypothetical"
  | "cancel"
  | "unknown";

export type MessageUnderstanding = {
  intent: ChatIntent;
  transactionType: "income" | "expense" | null;
  speechAct: SpeechAct;
  occurred: boolean | null;
  negated: boolean;
  future: boolean;
  hypothetical: boolean;
  correction: boolean;
  multipleOperations: boolean;
  confidence: number;
  source: "rules" | "llm" | "fallback";
};

export type UnderstandingAction =
  | "proceed"
  | "clarify"
  | "ignore_negated"
  | "ignore_future"
  | "ignore_hypothetical"
  | "split_multiple"
  | "cancel"
  | "correction_without_draft";

export function normalizeUnderstandingText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const CANCEL_PATTERN =
  /^\s*(?:no\s*,?\s*)?(?:cancelar|cancela(?:lo|la)?|descartar|descarta(?:lo|la)?|olvidalo|dejalo)\s*[.!]?\s*$/i;

const CORRECTION_PATTERN =
  /\b(no (?:fue|eran|era|fueron|son)|quise decir|corrige|corregir|cambia(?:lo|la)?|en realidad|me equivoque|rectifico)\b/i;

const HYPOTHETICAL_PATTERN =
  /\b(ojala|si (?:gano|gasto|recibo|cobro|me pagan|ganara|gastara|recibiera|pagara|cobrara|tuviera)|suponiendo que|imagina que|hipoteticamente|podria gastar|podria recibir|quisiera ganar|me gustaria ganar)\b/i;

const FUTURE_PATTERN =
  /\b(manana|pasado manana|la proxima semana|el proximo mes|voy a (?:gastar|pagar|comprar|recibir|cobrar|ganar)|(?:gastare|pagare|comprare|recibire|cobrare|ganare)|me van a pagar|me pagaran|recibire)\b/i;

const NEGATION_PATTERN =
  /\b(no (?:gaste|pague|compre|recibi|cobre|gane|me cobraron|me pagaron|fue un gasto|fue un ingreso)|nunca (?:gaste|pague|recibi|cobre)|casi (?:gasto|gaste|pago|pague|compro|compre))\b/i;

const INCOME_PATTERN =
  /\b(gane|gano|ganara|ganare|ganancia|me pagan|me pagaran|me pagaron|me pago|me van a pagar|me depositaron|recibi|recibire|recibiera|recibido|cobre|cobrare|cobrara|cobrado|me entro|me entraron|me cayo|me llegaron|vendi|venta|sueldo|salario|ingreso|me consignaron)\b/i;

const EXPENSE_PATTERN =
  /\b(gaste|gasto|gastara|gastare|gastado|pague|pagara|pagare|pagado|compre|comprara|comprare|comprado|me cobraron|me costo|se me fueron|solte|desembolse|compra)\b/i;

const COMPLAINT_PATTERN =
  /\b(me cobraron dos veces|cobro duplicado|cargo duplicado|me debitaron de mas|la transferencia no llego|no me llego la transferencia|desaparecio (?:mi )?dinero|me falta dinero|esa compra no fue mia|ese cargo no fue mio)\b/i;

const SUMMARY_PATTERN =
  /\b(cuanto (?:gaste|llevo gastado|me queda|tengo)|resumen|balance|saldo|mis gastos|mis ingresos|como voy este mes|analiza mis gastos|analiza mis finanzas|dame un insight|que patron ves|en que gasto mas|donde gasto mas|como puedo ahorrar|como ahorrar|consejos? de ahorro|consejos? para ahorrar|ideas? de ahorro|consejo para (?:poder )?ahorrar|quiero ahorrar|metodos? de ahorro|tips? de ahorro)\b/i;

const BUDGET_PATTERN = /\b(presupuesto|limite mensual|tope mensual|alerta al \d+)\b/i;

const HOW_TO_TRANSACTION_PATTERN =
  /\b(como (?:registro|anoto|agrego) (?:un )?(?:gasto|ingreso)|donde (?:registro|anoto) (?:un )?(?:gasto|ingreso))\b/i;

const GREETING_PATTERN =
  /^(hola|buenas|buenos dias|buenas tardes|buenas noches|gracias|ok|dale)[!. ]*$/i;

function hasQuestionShape(text: string): boolean {
  return /[¿?]/.test(text) || /^(como|que|cual|cuando|donde|por que|para que)\b/i.test(text);
}

function detectTransactionType(normalized: string): "income" | "expense" | null {
  const income = INCOME_PATTERN.test(normalized);
  const expense = EXPENSE_PATTERN.test(normalized);

  if (income && !expense) return "income";
  if (expense && !income) return "expense";

  return null;
}

function countLikelyMoneyValues(normalized: string): number {
  const cleaned = normalized
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ");

  return (cleaned.match(/(?:\$|usd\s*)?\b\d+(?:[.,]\d{1,2})?\b/g) ?? []).length;
}

export function detectsMultipleOperations(text: string): boolean {
  const normalized = normalizeUnderstandingText(text);
  const transactionVerbCount = [
    ...normalized.matchAll(
      /\b(gaste|pague|compre|recibi|cobre|gane|me pagaron|me depositaron|me cobraron)\b/g,
    ),
  ].length;
  const moneyCount = countLikelyMoneyValues(normalized);

  return (
    transactionVerbCount >= 2 ||
    (moneyCount >= 2 && /\b(y|ademas|tambien|luego|despues)\b/.test(normalized))
  );
}

export function isDraftCorrectionMessage(text: string): boolean {
  return CORRECTION_PATTERN.test(normalizeUnderstandingText(text));
}

export function isExplicitCancellationMessage(text: string): boolean {
  return CANCEL_PATTERN.test(normalizeUnderstandingText(text));
}

export function analyzeMessageWithRules(text: string): MessageUnderstanding | null {
  const normalized = normalizeUnderstandingText(text);

  if (!normalized) return null;

  const sensitivity = classifySensitivity(text);
  if (
    sensitivity ||
    requestsPersonalizedInvestmentAdvice(text) ||
    COMPLAINT_PATTERN.test(normalized) ||
    looksLikeSupportRequest(text)
  ) {
    return {
      intent: "support",
      transactionType: null,
      speechAct: sensitivity || COMPLAINT_PATTERN.test(normalized) ? "complaint" : "question",
      occurred: null,
      negated: false,
      future: false,
      hypothetical: false,
      correction: false,
      multipleOperations: false,
      confidence: 0.99,
      source: "rules",
    };
  }

  if (isExplicitCancellationMessage(text)) {
    return {
      intent: "cancel",
      transactionType: null,
      speechAct: "cancel",
      occurred: null,
      negated: false,
      future: false,
      hypothetical: false,
      correction: false,
      multipleOperations: false,
      confidence: 1,
      source: "rules",
    };
  }

  if (HOW_TO_TRANSACTION_PATTERN.test(normalized)) {
    return {
      intent: "support",
      transactionType: null,
      speechAct: "question",
      occurred: false,
      negated: false,
      future: false,
      hypothetical: false,
      correction: false,
      multipleOperations: false,
      confidence: 0.98,
      source: "rules",
    };
  }

  if (BUDGET_PATTERN.test(normalized)) {
    return {
      intent: "budget",
      transactionType: null,
      speechAct: hasQuestionShape(normalized) ? "question" : "command",
      occurred: null,
      negated: false,
      future: false,
      hypothetical: false,
      correction: false,
      multipleOperations: false,
      confidence: 0.96,
      source: "rules",
    };
  }

  if (SUMMARY_PATTERN.test(normalized)) {
    return {
      intent: "summary",
      transactionType: null,
      speechAct: "question",
      occurred: null,
      negated: false,
      future: false,
      hypothetical: false,
      correction: false,
      multipleOperations: false,
      confidence: 0.96,
      source: "rules",
    };
  }

  if (isDraftCorrectionMessage(text)) {
    return {
      intent: "correction",
      transactionType: detectTransactionType(normalized),
      speechAct: "correction",
      occurred: null,
      negated: false,
      future: false,
      hypothetical: false,
      correction: true,
      multipleOperations: false,
      confidence: 0.96,
      source: "rules",
    };
  }

  const transactionType = detectTransactionType(normalized);
  if (transactionType) {
    const negated = NEGATION_PATTERN.test(normalized);
    const future = FUTURE_PATTERN.test(normalized);
    const hypothetical = HYPOTHETICAL_PATTERN.test(normalized);
    const question = hasQuestionShape(normalized);
    const multipleOperations = detectsMultipleOperations(text);

    return {
      intent: "transaction",
      transactionType,
      speechAct: hypothetical ? "hypothetical" : question ? "question" : "report",
      occurred: negated || future || hypothetical || question ? false : true,
      negated,
      future,
      hypothetical,
      correction: false,
      multipleOperations,
      confidence: multipleOperations ? 0.98 : question ? 0.82 : 0.93,
      source: "rules",
    };
  }

  if (GREETING_PATTERN.test(normalized)) {
    return {
      intent: "smalltalk",
      transactionType: null,
      speechAct: "unknown",
      occurred: null,
      negated: false,
      future: false,
      hypothetical: false,
      correction: false,
      multipleOperations: false,
      confidence: 0.98,
      source: "rules",
    };
  }

  return null;
}

export function decideUnderstandingAction(
  understanding: MessageUnderstanding,
): UnderstandingAction {
  if (understanding.intent === "cancel") return "cancel";
  if (understanding.intent === "correction") return "correction_without_draft";
  if (understanding.multipleOperations) return "split_multiple";
  if (understanding.negated) return "ignore_negated";
  if (understanding.hypothetical) return "ignore_hypothetical";
  if (understanding.future) return "ignore_future";

  if (understanding.intent === "transaction") {
    if (
      !understanding.transactionType ||
      understanding.occurred !== true ||
      understanding.confidence < 0.6
    ) {
      return "clarify";
    }
  }

  if (understanding.intent === "unknown" || understanding.confidence < 0.5) {
    return "clarify";
  }

  return "proceed";
}

export function fallbackUnderstanding(): MessageUnderstanding {
  return {
    intent: "unknown",
    transactionType: null,
    speechAct: "unknown",
    occurred: null,
    negated: false,
    future: false,
    hypothetical: false,
    correction: false,
    multipleOperations: false,
    confidence: 0.2,
    source: "fallback",
  };
}
