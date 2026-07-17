// Clasificadores deterministas ejecutados antes de cualquier llamada al modelo.
// Las acciones sensibles siempre se escalan a revisión humana.

export type SensitivityHit = {
  category:
    | "fraude"
    | "reclamo"
    | "regulatorio"
    | "humano"
    | "cargo_desconocido"
    | "operacion_sensible"
    | "acceso_cuenta";
  priority: "high" | "medium" | "low";
  reason: string;
};

const RULES: Array<{ re: RegExp; hit: SensitivityHit }> = [
  {
    re: /\b(fraude|estafa|clonaron|clonacion|hackearon|suplantaron)\b/i,
    hit: {
      category: "fraude",
      priority: "high",
      reason: "Indicador de fraude o suplantación detectado",
    },
  },
  {
    re: /\b(me cobraron dos veces|cobro duplicado|cargo duplicado|me debitaron de mas|me cobraron de mas|la transferencia no llego|no me llego la transferencia|desaparecio (?:mi )?dinero|me falta dinero)\b/i,
    hit: {
      category: "reclamo",
      priority: "high",
      reason: "Cobro, débito o transferencia con posible incidencia",
    },
  },
  {
    re: /\b(no reconozco|no hice|no autorice|cargo desconocido|no fui yo|movimiento desconocido)\b/i,
    hit: {
      category: "cargo_desconocido",
      priority: "high",
      reason: "Movimiento o cargo no reconocido",
    },
  },
  {
    re: /\b(no puedo entrar|perdi acceso|cuenta bloqueada|bloquearon mi cuenta|robaron mi cuenta)\b/i,
    hit: {
      category: "acceso_cuenta",
      priority: "high",
      reason: "Problema sensible de acceso a la cuenta",
    },
  },
  {
    re: /\b(?:quiero|necesito|prefiero|pasame|comunicame|ponme)\b.{0,35}\b(?:persona|humano|agente|asesor|alguien|soporte humano|equipo de soporte)\b|\b(?:atencion humana|abrir un caso|crear un ticket)\b/i,
    hit: {
      category: "humano",
      priority: "medium",
      reason: "Solicitud explícita de atención humana",
    },
  },
  {
    re: /\b(reclamo formal|queja formal|denuncia|superintendencia|regulador|regulatorio)\b/i,
    hit: {
      category: "regulatorio",
      priority: "high",
      reason: "Asunto regulatorio o reclamo formal",
    },
  },
  {
    re: /\b(?:compra|vende|transfiere|retira|ejecuta|invierte|haz)\b.{0,45}\b(?:acciones|fondos|dinero|inversion|portafolio|operacion)\b|\bejecuta\s+(?:esta\s+|la\s+)?inversion\b|\binvierte\s+este\s+dinero\s+por\s+mi\b/i,
    hit: {
      category: "operacion_sensible",
      priority: "high",
      reason: "Solicitud de ejecución de una operación financiera sensible",
    },
  },
];

function normalizeSensitivityText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function classifySensitivity(text: string): SensitivityHit | null {
  const normalized = normalizeSensitivityText(text);

  for (const rule of RULES) {
    if (rule.re.test(normalized)) return rule.hit;
  }

  return null;
}

export function requestsPersonalizedInvestmentAdvice(text: string): boolean {
  const normalized = normalizeSensitivityText(text);

  return Boolean(
    /\b(?:que|cual)\s+(?:accion|inversion|fondo|activo|cripto)\s+(?:compro|elijo|me recomiendas|me conviene)\b/.test(
      normalized,
    ) ||
    /\b(?:donde|en que)\s+(?:deberia\s+)?(?:invertir|invierto)\s+(?:mi\s+)?(?:dinero|sueldo|ahorro|ahorros)?\b/.test(
      normalized,
    ) ||
    /\b(?:recomiendame|dime)\s+(?:una\s+)?(?:inversion|accion|activo|fondo)\b/.test(normalized) ||
    /\b(?:tesla|bitcoin|acciones|cripto)\s+o\s+(?:tesla|bitcoin|acciones|cripto)\b/.test(
      normalized,
    ) ||
    /\btengo\s+(?:usd\s*)?\d+(?:[.,]\d+)?\s*(?:dolares)?[, ]+.*\b(?:que|cual|donde|en que)\b.*\b(?:compro|invierto|invertir)\b/.test(
      normalized,
    ) ||
    /\b(?:que|cual)\s+inversion\s+me\s+conviene\b/.test(normalized) ||
    /\bque\s+debo\s+(?:comprar|vender)\b/.test(normalized),
  );
}

const DISTRESS_RE =
  /\b(no me alcanza|no tengo|ahogado|deuda(s)?|estresad[oa]|angustia|no s[eé] qu[eé] hacer|preocupad[oa])\b/i;

export function detectsDistress(text: string): boolean {
  return DISTRESS_RE.test(text);
}
