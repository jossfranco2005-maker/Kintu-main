/**
 * Enrutamiento determinista para consultas institucionales y educación
 * financiera general.
 *
 * Se ejecuta antes del clasificador con IA para impedir que preguntas
 * que requieren conocimiento aprobado terminen en conversación general.
 */
export function normalizeSupportRoutingText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9¿?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const INSTITUTIONAL_TOPIC_PATTERN =
  /\b(horario|atencion|soporte|correo|email|perfil|datos personales|cuenta|clave|contrasena|comision|tarifa|retiro|deposito|transferencia|asesor|ticket|caso|reclamo|queja)\b/;

const QUESTION_OR_HELP_PATTERN =
  /[¿?]|\b(como|cual|cuando|donde|quien|por que|que hago|cambiar|actualizar|editar|recuperar|bloquear|desbloquear|contactar|hablar|necesito ayuda|necesito saber|quiero saber)\b/;

const EXPLICIT_SUPPORT_PATTERN =
  /\b(ayuda|necesito ayuda|soporte|atencion al cliente|quiero hablar con (una|un) (persona|humano|agente|asesor))\b/;

const INVESTMENT_TOPIC_PATTERN =
  /\b(invertir|inversion|inversiones|bolsa|mercado de valores|accion|acciones|fondo|fondos|bono|bonos)\b/;
const INVESTMENT_EDUCATION_PATTERN =
  /\b(quiero aprender|quiero entender|como funciona|como puedo empezar|como empiezo|como se hace|no se como|que es|que son|cuales son los riesgos|explicame|informacion general)\b/;

export function looksLikeInvestmentEducationRequest(text: string): boolean {
  const normalized = normalizeSupportRoutingText(text);
  return (
    INVESTMENT_TOPIC_PATTERN.test(normalized) &&
    (INVESTMENT_EDUCATION_PATTERN.test(normalized) ||
      /\bquiero invertir\b.*\bno se como\b/.test(normalized))
  );
}

/**
 * Devuelve true solamente cuando hay señales suficientes de que el
 * usuario pregunta por soporte, un procedimiento institucional o educación
 * financiera que debe responderse desde la base aprobada.
 */
export function looksLikeSupportRequest(text: string): boolean {
  const normalized = normalizeSupportRoutingText(text);

  if (!normalized) return false;
  if (EXPLICIT_SUPPORT_PATTERN.test(normalized)) return true;
  if (looksLikeInvestmentEducationRequest(text)) return true;

  return INSTITUTIONAL_TOPIC_PATTERN.test(normalized) && QUESTION_OR_HELP_PATTERN.test(normalized);
}
