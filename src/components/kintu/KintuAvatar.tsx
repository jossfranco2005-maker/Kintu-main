// Avatar de Kintu — mascota SVG programada, sin imágenes externas.
// La cantidad de hojas y el brillo de las mejillas responden a la tasa
// de ahorro. Además, el conteo de hojas es estado propio: cada ingreso
// nuevo agrega una hoja (con animación "pop"), cada gasto nuevo marchita
// y quita una hoja (tono seco, sin rojo). El personaje también salta al
// recibir un ingreso y decae levemente al registrar un gasto.
import { useEffect, useId, useMemo, useRef, useState } from "react";

type KintuAvatarProps = {
  savingsRate: number; // 0-100 — solo afecta mejillas/ánimo, no el conteo de hojas
  incomes?: number; // total acumulado — fallback si no hay incomeCount
  expenses?: number; // total acumulado — fallback si no hay expenseCount
  incomeCount?: number; // cantidad de transacciones de ingreso este período
  expenseCount?: number; // cantidad de transacciones de gasto este período
  size?: number;
  className?: string;
};

const GOLDEN_ANGLE = (137.50776 * Math.PI) / 180;
const MIN_LEAVES = 5; // núcleo — nunca baja de acá
const MAX_LEAVES = 11;
const NUM_SLOTS = MAX_LEAVES;
const WITHER_COLOR = "#B08D5E"; // tono seco, no rojo

function seeded(i: number) {
  return Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
}

// Slots fijos: la posición de la hoja #i nunca cambia sin importar
// cuántas estén activas ese mes — así sumar/quitar una no reordena todo.
const LEAF_SLOTS = (() => {
  const R = 30;
  const arr: { x: number; y: number; r: number; rot: number; tone: number }[] = [];
  for (let i = 0; i < NUM_SLOTS; i++) {
    const theta = i * GOLDEN_ANGLE;
    const r = R * Math.sqrt(i / (NUM_SLOTS - 1));
    arr.push({
      x: 100 + r * Math.cos(theta),
      y: 40 + r * Math.sin(theta) * 0.7,
      r: 11 + seeded(i) * 6,
      rot: (theta * 180) / Math.PI,
      tone: seeded(i + 40),
    });
  }
  return arr;
})();

export function KintuAvatar({
  savingsRate,
  incomes = 0,
  expenses = 0,
  incomeCount,
  expenseCount,
  size = 160,
  className = "",
}: KintuAvatarProps) {
  const rate = Math.max(0, Math.min(100, savingsRate));
  const blush = 0.35 + (rate / 100) * 0.35;
  const usingCounts = incomeCount !== undefined && expenseCount !== undefined;

  const [leafCount, setLeafCount] = useState(() =>
    Math.round(MIN_LEAVES + (rate / 100) * (MAX_LEAVES - MIN_LEAVES)),
  );
  const leaves = useMemo(() => LEAF_SLOTS.slice(0, leafCount), [leafCount]);

  const [celebrate, setCelebrate] = useState(false);
  const [sad, setSad] = useState(false);
  const [newLeafFrom, setNewLeafFrom] = useState(0);
  const [witheringSet, setWitheringSet] = useState<Set<number>>(new Set());
  const prevIncomes = useRef(incomes);
  const prevExpenses = useRef(expenses);
  const prevIncomeCount = useRef(incomeCount ?? 0);
  const prevExpenseCount = useRef(expenseCount ?? 0);

  // Generar IDs únicos para los gradientes de este avatar específico
  const uniqueId = useId().replace(/:/g, "-");
  const bodyGradId = `kintuBody-${uniqueId}`;
  const leafGradId = `kintuLeaf-${uniqueId}`;

  // --- Ingreso(s): agrega tantas hojas como transacciones nuevas haya ---
  useEffect(() => {
    let delta = 0;
    if (usingCounts) {
      delta = (incomeCount ?? 0) - prevIncomeCount.current;
      prevIncomeCount.current = incomeCount ?? 0;
    } else if (incomes > prevIncomes.current) {
      delta = 1;
    }
    prevIncomes.current = incomes;
    if (delta <= 0) return;

    setLeafCount((c) => {
      const room = MAX_LEAVES - c;
      const toAdd = Math.min(delta, room);
      if (toAdd <= 0) return c;
      setNewLeafFrom(c);
      return c + toAdd;
    });
    setCelebrate(true);
    const t = setTimeout(() => setCelebrate(false), 950 + Math.min(delta, 6) * 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomes, incomeCount]);

  // --- Gasto(s): marchita tantas hojas como transacciones nuevas haya ---
  useEffect(() => {
    let delta = 0;
    if (usingCounts) {
      delta = (expenseCount ?? 0) - prevExpenseCount.current;
      prevExpenseCount.current = expenseCount ?? 0;
    } else if (expenses > prevExpenses.current) {
      delta = 1;
    }
    prevExpenses.current = expenses;
    if (delta <= 0) return;

    setSad(true);
    const t1 = setTimeout(() => setSad(false), 1000);

    setLeafCount((c) => {
      const available = c - MIN_LEAVES;
      const toWither = Math.min(delta, Math.max(0, available));
      if (toWither <= 0) return c;
      const idxs: number[] = [];
      for (let k = 0; k < toWither; k++) idxs.push(c - 1 - k);
      setWitheringSet(new Set(idxs));
      const t2 = setTimeout(
        () => {
          setWitheringSet(new Set());
          setLeafCount((cur) => Math.max(MIN_LEAVES, cur - toWither));
        },
        650 + toWither * 80,
      );
      return c; // el conteo real baja recién cuando termina la animación
    });

    return () => clearTimeout(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, expenseCount]);

  return (
    <div
      className={`kintu-avatar-wrap ${celebrate ? "kintu-jump" : ""} ${sad ? "kintu-droop" : ""}`}
      style={{
        width: size,
        height: size,
        maxWidth: "100%",
        maxHeight: "100%",
        display: "inline-block",
      }}
    >
      <svg
        viewBox="0 0 200 200"
        width="100%"
        height="100%"
        className={className}
        role="img"
        aria-label="Avatar del árbol de Kintu"
      >
        <defs>
          <radialGradient id={bodyGradId} cx="40%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#E4C79A" />
            <stop offset="100%" stopColor="#C9A06B" />
          </radialGradient>
          <linearGradient id={leafGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7BCB80" />
            <stop offset="100%" stopColor="#4E9E5A" />
          </linearGradient>
        </defs>

        {/* sombra en el piso */}
        <ellipse cx="100" cy="184" rx="46" ry="7" fill="#4C3A8C" opacity="0.10" />

        {/* pies */}
        <ellipse cx="80" cy="174" rx="11" ry="15" fill="#B98A5E" />
        <ellipse cx="120" cy="174" rx="11" ry="15" fill="#B98A5E" />
        <ellipse cx="80" cy="180" rx="13" ry="6" fill="#A67A4E" />
        <ellipse cx="120" cy="180" rx="13" ry="6" fill="#A67A4E" />

        {/* brazos — se levantan más al celebrar un ingreso */}
        <ellipse
          cx="42"
          cy="118"
          rx="13"
          ry="8.5"
          fill="#D8B481"
          transform={celebrate ? "rotate(-55 42 118) translate(-4 -10)" : "rotate(-30 42 118)"}
        />
        <ellipse
          cx="158"
          cy="118"
          rx="13"
          ry="8.5"
          fill="#D8B481"
          transform={celebrate ? "rotate(55 158 118) translate(4 -10)" : "rotate(30 158 118)"}
        />

        {/* cuerpo */}
        <ellipse cx="100" cy="128" rx="60" ry="54" fill={`url(#${bodyGradId})`} />
        <ellipse cx="88" cy="110" rx="22" ry="16" fill="#F1DEB8" opacity="0.45" />

        {/* motas del cuerpo */}
        <ellipse cx="66" cy="118" rx="6" ry="4" fill="#B98A5E" opacity="0.45" />
        <ellipse cx="132" cy="150" rx="5.5" ry="4" fill="#B98A5E" opacity="0.45" />
        <ellipse cx="122" cy="105" rx="4.5" ry="3.2" fill="#B98A5E" opacity="0.45" />

        {/* mejillas */}
        <ellipse cx="72" cy="140" rx="9" ry="6" fill="#F2A8A0" opacity={blush} />
        <ellipse cx="128" cy="140" rx="9" ry="6" fill="#F2A8A0" opacity={blush} />

        {/* ojos — felices cerrados normalmente, apenados al registrar un gasto */}
        {sad ? (
          <>
            <path
              d="M 77 118 Q 84 123 91 119"
              stroke="#3B2A1A"
              strokeWidth="4.2"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M 109 119 Q 116 123 123 118"
              stroke="#3B2A1A"
              strokeWidth="4.2"
              strokeLinecap="round"
              fill="none"
            />
          </>
        ) : (
          <>
            <path
              d="M 76 120 Q 84 111 92 120"
              stroke="#3B2A1A"
              strokeWidth="4.2"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M 108 120 Q 116 111 124 120"
              stroke="#3B2A1A"
              strokeWidth="4.2"
              strokeLinecap="round"
              fill="none"
            />
          </>
        )}

        {/* sonrisa — se invierte brevemente al registrar un gasto */}
        <path
          d={sad ? "M 90 152 Q 100 146 110 152" : "M 88 148 Q 100 158 112 148"}
          stroke="#3B2A1A"
          strokeWidth="4.2"
          strokeLinecap="round"
          fill="none"
        />

        {/* corona de hojas — slots fijos. Cada hoja nueva hace "pop"; la
            que se marchita cambia de tono seco y cae con un giro. */}
        <g>
          {leaves.map((l, i) => {
            const isNew = celebrate && i >= newLeafFrom;
            const isWithering = witheringSet.has(i);
            return (
              <g
                key={i}
                className={isNew ? "kintu-leaf-pop" : isWithering ? "kintu-leaf-wither" : ""}
                style={
                  isNew
                    ? ({
                        transformBox: "fill-box",
                        transformOrigin: "center",
                        animationDelay: `${(i - newLeafFrom) * 0.08}s`,
                      } as React.CSSProperties)
                    : isWithering
                      ? ({
                          transformBox: "fill-box",
                          transformOrigin: "center",
                          animationDelay: `${(leaves.length - 1 - i) * 0.08}s`,
                        } as React.CSSProperties)
                      : undefined
                }
              >
                <ellipse
                  cx={l.x}
                  cy={l.y}
                  rx={l.r}
                  ry={l.r * 1.3}
                  fill={isWithering ? WITHER_COLOR : `url(#${leafGradId})`}
                  opacity={0.85 + l.tone * 0.15}
                  transform={`rotate(${l.rot} ${l.x} ${l.y})`}
                />
              </g>
            );
          })}
          {/* frutitos violetas y dorados, marca Kintu */}
          <circle cx="72" cy="42" r="4" fill="#7C6FE0" />
          <circle cx="128" cy="44" r="3.5" fill="#7C6FE0" />
          <circle cx="100" cy="26" r="3.5" fill="#F6C76B" />
        </g>

        {celebrate && (
          <>
            <circle
              className="kintu-sparkle"
              cx="60"
              cy="50"
              r="2.5"
              fill="#F6C76B"
              style={{ animationDelay: "0s" }}
            />
            <circle
              className="kintu-sparkle"
              cx="100"
              cy="18"
              r="2.5"
              fill="#7C6FE0"
              style={{ animationDelay: "0.1s" }}
            />
            <circle
              className="kintu-sparkle"
              cx="140"
              cy="50"
              r="2.5"
              fill="#F6C76B"
              style={{ animationDelay: "0.2s" }}
            />
          </>
        )}
      </svg>

      <style>{`
        @keyframes kintuJump {
          0% { transform: translateY(0) rotate(0deg); }
          30% { transform: translateY(-14px) rotate(-4deg); }
          55% { transform: translateY(0) rotate(3deg); }
          75% { transform: translateY(-6px) rotate(-1deg); }
          100% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes kintuDroop {
          0% { transform: translateY(0) rotate(0deg); }
          40% { transform: translateY(3px) rotate(-1.5deg); }
          100% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes kintuLeafPop {
          0% { transform: scale(0.3); opacity: 0; }
          60% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes kintuLeafWither {
          0% { transform: translate(0,0) rotate(0deg) scale(1); opacity: 1; }
          30% { transform: translate(2px,3px) rotate(8deg) scale(0.94); opacity: 1; }
          100% { transform: translate(-5px,50px) rotate(55deg) scale(0.7); opacity: 0; }
        }
        @keyframes kintuSparkle {
          0% { transform: translateY(0) scale(0.4); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: translateY(-24px) scale(1); opacity: 0; }
        }
        .kintu-avatar-wrap.kintu-jump { animation: kintuJump 0.9s ease-out; transform-origin: 50% 90%; }
        .kintu-avatar-wrap.kintu-droop { animation: kintuDroop 1s ease-in-out; transform-origin: 50% 90%; }
        .kintu-leaf-pop { animation: kintuLeafPop 0.5s ease-out backwards; }
        .kintu-leaf-wither { animation: kintuLeafWither 0.65s ease-in forwards backwards; }
        .kintu-sparkle { animation: kintuSparkle 0.9s ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .kintu-avatar-wrap.kintu-jump,
          .kintu-avatar-wrap.kintu-droop,
          .kintu-leaf-pop,
          .kintu-leaf-wither,
          .kintu-sparkle { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// Nivel y barra de progreso. Vive en el mismo archivo que el avatar a
// propósito, para que un solo import alcance en dashboard.tsx y chat.tsx.
export function deriveKintuLevel(savingsRatePct: number) {
  const clamped = Math.max(0, Math.min(100, savingsRatePct));
  const level = Math.min(5, Math.floor(clamped / 20) + 1);
  const progressPct = clamped >= 100 ? 100 : ((clamped % 20) / 20) * 100;
  return { level, progressPct };
}

export function KintuLevelBar({
  level,
  progressPct,
  className = "",
}: {
  level: number;
  progressPct: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, progressPct));
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), 100);
    return () => clearTimeout(t);
  }, [pct]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold text-[#4C3A8C] dark:text-[#B9A9F5]">
          Nivel {level}
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#EAE5F9] dark:bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#7C6FE0] transition-[width] duration-1000 ease-out"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
