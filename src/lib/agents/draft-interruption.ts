import { looksLikeSupportRequest } from "@/lib/agents/support-routing";
import {
  classifySensitivity,
  requestsPersonalizedInvestmentAdvice,
} from "@/lib/finance/sensitivity";

/**
 * Decide si un mensaje debe salir temporalmente del flujo de una
 * transacción pendiente y ser atendido por el agente de soporte.
 *
 * La transacción pendiente no se elimina: queda guardada para que el
 * usuario pueda retomarla o cancelarla después.
 */
export function shouldInterruptTransactionDraft(text: string): boolean {
  return Boolean(
    classifySensitivity(text) ||
    requestsPersonalizedInvestmentAdvice(text) ||
    looksLikeSupportRequest(text),
  );
}
