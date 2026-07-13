// Heurística liviana y standalone, usada únicamente para decidir si vale
// la pena invocar al agente de notificaciones después de un turno del chat.
// No reemplaza ni duplica la clasificación real del orquestador (esa sigue
// siendo la fuente de verdad para la respuesta al usuario) — acá solo nos
// alcanza con una aproximación rápida y sin costo de modelo, así el
// wrapper no depende de internals de agents/orchestrator.ts.
export type NotificationIntent = "expense" | "budget" | "support" | "summary" | "smalltalk";

export function classifyIntentForNotifications(text: string): NotificationIntent {
  if (/\bpresupuesto|l[ií]mite|alerta al\b/i.test(text)) return "budget";
  if (/\bcu[aá]nto (gast[eé]|llevo|me queda)|resumen|balance|saldo\b/i.test(text)) {
    return "summary";
  }
  if (/\bproblema|reclamo|no reconozco|fraude|ayuda|c[oó]mo (hago|puedo)\b/i.test(text)) {
    return "support";
  }
  if (/\bgast[eé]|pagu[eé]|compr[eé]|me cobraron|recib[íi]|cobr[eé]|ingres[eé]\b/i.test(text)) {
    return "expense";
  }
  return "smalltalk";
}
